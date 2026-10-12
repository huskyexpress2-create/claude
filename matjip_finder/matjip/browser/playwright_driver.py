"""Playwright 드라이버: 이 PC에서 브라우저를 띄워 네이버 플레이스·카카오맵 공개 페이지를 읽는다.

안전장치 (코드로 강제):
- 로그인 정보가 없는 새 브라우저 컨텍스트(쿠키·캐시 공유 없음). 기본은 창을 띄운다.
- 화면 텍스트(innerText)와 링크 주소만 읽는다. 내부 API 호출·토큰 재사용·자동화 흔적 숨기기(stealth)는 하지 않는다.
- 페이지 이동 사이 5~8초 무작위 대기. 가게 수 상한(CLI에서 최대 15곳).
- HTTP 403/429, CAPTCHA·'비정상적인 접근' 문구가 보이면 즉시 전체 수집을 멈추고 그때까지 결과만 쓴다.
네이버·카카오 약관은 자동화된 수집을 금지합니다. 사용 책임은 사용자에게 있습니다.
"""

from __future__ import annotations

import random
import sys
import time
from dataclasses import dataclass
from typing import Callable, Optional, Protocol

from ..merge import name_similarity
from ..models import Place
from ..sources import SearchQuery
from .observations import PlaceObservation, now_iso, save_results, to_place
from .parsers import (
    detect_block,
    extract_naver_place_links,
    is_soft_failure,
    naver_list_url,
    naver_review_url,
    normalize_kakao_url,
    parse_kakao_place_page,
    parse_naver_review_page,
)

MATCH_THRESHOLD = 0.85  # 목록의 가게 이름과 후보 이름이 이 이상 비슷해야 같은 가게로 본다


class PlaywrightUnavailable(RuntimeError):
    pass


class Blocked(RuntimeError):
    pass


@dataclass
class PageResult:
    status: Optional[int]
    text: str
    links: list[tuple[str, str]]


class PageReader(Protocol):
    def read(self, url: str, wait_selector: Optional[str] = None, want_links: bool = False) -> PageResult:
        ...


class PlaywrightPageReader:
    """실제 브라우저. 테스트에서는 가짜 PageReader를 쓴다."""

    def __init__(self, headless: bool):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise PlaywrightUnavailable(
                "Playwright가 설치되어 있지 않습니다. 다음을 실행하세요:\n"
                "  pip install playwright\n  python -m playwright install chromium"
            ) from e
        self._pw = sync_playwright().start()
        try:
            self._browser = self._pw.chromium.launch(headless=headless)
        except Exception as e:  # 브라우저 바이너리 미설치 등
            self._pw.stop()
            raise PlaywrightUnavailable(f"브라우저를 띄우지 못했습니다: {e}\n  python -m playwright install chromium") from e
        self._context = self._browser.new_context(locale="ko-KR", timezone_id="Asia/Seoul")
        self._page = self._context.new_page()

    def read(self, url: str, wait_selector: Optional[str] = None, want_links: bool = False) -> PageResult:
        page = self._page
        resp = page.goto(url, wait_until="domcontentloaded", timeout=30000)
        status = resp.status if resp is not None else None
        if wait_selector:
            try:
                page.wait_for_selector(wait_selector, timeout=10000)
            except Exception:
                pass  # 못 찾아도 지금 화면을 그대로 읽고 파서가 판단한다
        else:
            page.wait_for_timeout(2500)
        text = page.locator("body").inner_text(timeout=10000)
        links: list[tuple[str, str]] = []
        if want_links:
            for a in page.locator("a[href]").all()[:300]:
                try:
                    links.append((a.get_attribute("href") or "", a.inner_text(timeout=1000)))
                except Exception:
                    continue
        return PageResult(status, text, links)

    def close(self) -> None:
        for closer in (self._context.close, self._browser.close, self._pw.stop):
            try:
                closer()
            except Exception:
                pass


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


class BrowserCollector:
    """사이트 순회 로직. PageReader와 대기 함수를 주입받아 테스트 가능하게 둔다."""

    def __init__(
        self,
        reader: PageReader,
        sites: list[str],
        delay: tuple[float, float] = (5.0, 8.0),
        sleep: Callable[[float], None] = time.sleep,
        rng: Optional[random.Random] = None,
    ):
        self.reader = reader
        self.sites = [s for s in sites if s in ("naver", "kakao")]
        self.delay = delay
        self.sleep = sleep
        self.rng = rng or random.Random()
        self._loads = 0
        self.warnings: list[str] = []
        self._naver_fail_streak = 0
        self._discovered: set[int] = set()  # 목록에서 직접 찾은 후보(이름에 업종이 붙어 있을 수 있음)

    # 모든 페이지 이동은 여기를 지난다: 대기 → 열기 → 차단 검사
    def _open(self, url: str, **kw) -> PageResult:
        if self._loads:
            self.sleep(self.rng.uniform(*self.delay))
        self._loads += 1
        _log(f"[browser] {url}")
        res = self.reader.read(url, **kw)
        reason = detect_block(res.status, res.text)
        if reason:
            raise Blocked(f"{url} 에서 차단 신호({reason})가 보여 브라우저 수집을 멈췄습니다")
        return res

    def _naver_ids(self, query_text: str) -> list[tuple[str, str]]:
        res = self._open(naver_list_url(query_text), want_links=True)
        return extract_naver_place_links(res.links)

    def _match(self, name: str, candidates: list[tuple[str, str]]) -> Optional[str]:
        best, best_sim = None, 0.0
        for pid, label in candidates:
            sim = name_similarity(name, label)
            if sim > best_sim:
                best, best_sim = pid, sim
        return best if best_sim >= MATCH_THRESHOLD else None

    def _naver(self, po: PlaceObservation, pool: list[tuple[str, str]], area: str) -> None:
        if self._naver_fail_streak >= 2:
            return
        pid = self._match(po.name, pool)
        if pid is None:
            pid = self._match(po.name, self._naver_ids(f"{area} {po.name}"))
        if pid is None:
            self.warnings.append(f"네이버에서 '{po.name}'을(를) 찾지 못했습니다")
            return
        url = naver_review_url(pid)
        res = self._open(url)
        name, obs = parse_naver_review_page(res.text, url)
        if obs.is_empty() or (is_soft_failure(res.text) and not obs.review_count):
            self._naver_fail_streak += 1
            self.warnings.append(f"네이버 '{po.name}' 페이지를 해석하지 못했습니다 (구조 변경 또는 일시 오류)")
            if self._naver_fail_streak >= 2:
                self.warnings.append("네이버 페이지 해석이 연속 실패해 네이버 수집을 중단했습니다")
            return
        self._naver_fail_streak = 0
        if name and name_similarity(name, po.name) < MATCH_THRESHOLD:
            self.warnings.append(f"네이버 페이지 이름 '{name}'이(가) 후보 '{po.name}'와 달라 건너뜀")
            return
        obs.observed_at = now_iso()
        po.observations.append(obs)
        if id(po) in self._discovered and name:
            po.name = name  # 목록 링크 텍스트("가게명 업종") 대신 가게 페이지의 정식 이름

    def _kakao(self, po: PlaceObservation, kakao_url: Optional[str]) -> None:
        url = normalize_kakao_url(kakao_url or "")
        if not url:
            return
        res = self._open(url, wait_selector="h3.tit_place")
        name, obs = parse_kakao_place_page(res.text, url)
        if obs.is_empty():
            # 후기가 하나도 없는 가게도 있다. 이름까지 못 읽었으면 화면이 안 그려진 것으로 본다.
            if not name:
                self.warnings.append(f"카카오 '{po.name}' 페이지를 해석하지 못했습니다")
            return
        if name and name_similarity(name, po.name) < MATCH_THRESHOLD:
            self.warnings.append(f"카카오 페이지 이름 '{name}'이(가) 후보 '{po.name}'와 달라 건너뜀")
            return
        obs.observed_at = now_iso()
        po.observations.append(obs)

    def run(self, query: SearchQuery, targets: list[Place], limit: int) -> list[PlaceObservation]:
        results: list[PlaceObservation] = []
        try:
            pool: list[tuple[str, str]] = []
            if "naver" in self.sites:
                # '지역 메뉴' 목록 한 번으로 여러 후보의 네이버 id를 찾는다(페이지 이동 수 절약).
                pool = self._naver_ids(f"{query.area} {query.food}")
            discovering = not targets
            if discovering:
                if not pool:
                    self.warnings.append("API 후보가 없고 네이버 목록도 비어 있어 브라우저로 볼 가게가 없습니다")
                    return results
                targets = [Place(name=label) for _, label in pool[:limit]]
            discovered = {id(t) for t in targets} if discovering else set()
            for t in targets[:limit]:
                po = PlaceObservation(name=t.name, address=t.address)
                if id(t) in discovered:
                    self._discovered.add(id(po))
                results.append(po)
                if "naver" in self.sites:
                    self._naver(po, pool, query.area)
                if "kakao" in self.sites:
                    self._kakao(po, t.urls.get("kakao"))
        except Blocked as e:
            self.warnings.append(str(e))
        except Exception as e:  # 브라우저 오류 등: 지금까지 결과는 살린다
            self.warnings.append(f"브라우저 수집 중 오류로 중단: {e}")
        return [po for po in results if po.observations]


class PlaywrightDriver:
    name = "playwright"

    def __init__(self, sites: list[str], headless: bool = False, reader_factory=None, sleep=time.sleep):
        self.sites = sites
        self.headless = headless
        self._sleep = sleep
        self._reader_factory = reader_factory or (lambda: PlaywrightPageReader(headless))
        if reader_factory is None:
            try:
                import playwright  # noqa: F401
            except ImportError as e:
                raise PlaywrightUnavailable(
                    "Playwright가 설치되어 있지 않습니다. 다음을 실행하세요:\n"
                    "  pip install playwright\n  python -m playwright install chromium"
                ) from e
        self._observed: list[PlaceObservation] = []

    def collect(self, query: SearchQuery, targets: list[Place], limit: int) -> tuple[list[Place], list[str]]:
        reader = self._reader_factory()
        try:
            collector = BrowserCollector(reader, self.sites, sleep=self._sleep)
            self._observed = collector.run(query, targets, limit)
            warnings = collector.warnings
        finally:
            close = getattr(reader, "close", None)
            if close:
                close()
        stamp = now_iso()
        return [to_place(po, stamp) for po in self._observed], warnings

    def save(self, path: str, query: SearchQuery) -> None:
        save_results(path, query.food, query.area, "playwright", self._observed)
