"""검색 → 병합 → (네이버 블로그 보강) → (브라우저 수집) → 텍스트 분석 → 점수 → 카테고리."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Optional, Protocol

from .config import ScoringConfig
from .merge import merge_places, name_similarity
from .models import Place, ScoredPlace
from .scoring import categorize, score_places
from .sources import NaverSearchSource, SearchQuery
from .text_analysis import analyze_place


@dataclass
class SearchResult:
    query: SearchQuery
    categories: dict[str, list[ScoredPlace]]
    scored: list[ScoredPlace]
    sources_used: list[str]
    warnings: list[str] = field(default_factory=list)
    google_used: bool = False  # Google Maps 콘텐츠가 들어갔으면 출처·약관 안내를 붙인다


class BrowserDriver(Protocol):
    """브라우저로 공개 페이지를 읽어 Place(관측값)를 돌려준다. targets가 비면 스스로 후보를 찾는다."""

    name: str

    def collect(self, query: SearchQuery, targets: list[Place], limit: int) -> tuple[list[Place], list[str]]:
        ...


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def collect_candidates(
    query: SearchQuery,
    discovery_sources: list,
    extra_places: Optional[list[Place]] = None,
    max_candidates: int = 30,
    naver: Optional[NaverSearchSource] = None,
) -> tuple[list[Place], list[str], list[str]]:
    """API·수동 입력·브라우저 결과 파일에서 후보를 모아 병합한다. (places, sources_used, warnings)"""
    warnings: list[str] = []
    groups: list[list[Place]] = []
    used: list[str] = []
    for src in discovery_sources:
        try:
            found = src.discover(query)
        except Exception as e:  # 한 소스가 실패해도 나머지로 계속한다
            warnings.append(f"{src.name} 검색 실패: {e}")
            continue
        _log(f"[{src.name}] 후보 {len(found)}곳")
        groups.append(found)
        used.append(src.name)
    if extra_places:
        groups.append(extra_places)
        used.append("browser_results")

    places = merge_places(groups)
    # 여러 소스에 동시에 잡힌 곳, 평점 수가 많은 곳을 우선 보강한다(API 호출량 절약).
    places.sort(key=lambda p: (len(p.sources), p.total_rating_count), reverse=True)
    if len(places) > max_candidates:
        warnings.append(f"후보 {len(places)}곳 중 상위 {max_candidates}곳만 분석")
        places = places[:max_candidates]

    if naver is not None:
        for p in places:
            try:
                naver.enrich(p, query.area)
            except Exception as e:
                warnings.append(f"네이버 블로그 보강 실패({p.name}): {e}")
        used.append("naver_blog")
    return places, used, warnings


def select_browser_targets(
    places: list[Place], query: SearchQuery, n: int, cfg: Optional[ScoringConfig] = None, dish_filter: bool = True
) -> list[Place]:
    """브라우저로 자세히 볼 상위 n곳. API 데이터로 1차 점수를 매겨 맛 점수 순으로 고르고,
    점수를 못 매긴 곳(평점·리뷰가 없는 카카오 단독 후보 등)은 뒤에 채운다."""
    if n <= 0 or not places:
        return []
    analyses = [analyze_place(p, query.food) for p in places]
    scored = score_places(places, analyses, query.food, cfg, dish_filter=dish_filter)
    ranked = sorted(
        (sp for sp in scored if sp.taste_score is not None), key=lambda sp: sp.taste_score or 0, reverse=True
    )
    picked = [sp.place for sp in ranked[:n]]
    # 메뉴 무관으로 제외된 곳은 채우지 않는다. 근거 부족으로 제외된 곳만 원래 순서대로 채운다.
    for sp in scored:
        if len(picked) >= n:
            break
        if sp.taste_score is None and sp.place not in picked and any("근거 부족" in note for note in sp.notes):
            picked.append(sp.place)
    return picked


def run_search(
    query: SearchQuery,
    discovery_sources: list,
    naver: Optional[NaverSearchSource] = None,
    analyzer=None,
    max_candidates: int = 30,
    top: int = 3,
    cfg: Optional[ScoringConfig] = None,
    dish_filter: bool = True,
    browser_places: Optional[list[Place]] = None,
    browser_driver: Optional[BrowserDriver] = None,
    browser_max: int = 8,
    google_reference=None,
) -> SearchResult:
    cfg = cfg or ScoringConfig()
    places, used, warnings = collect_candidates(
        query, discovery_sources, extra_places=browser_places, max_candidates=max_candidates, naver=naver
    )

    if browser_driver is not None:
        targets = select_browser_targets(places, query, browser_max, cfg, dish_filter)
        _log(f"[{browser_driver.name}] 브라우저로 {len(targets) or '직접 찾은'}곳 확인 시작 (최대 {browser_max}곳)")
        observed, bw = browser_driver.collect(query, targets, browser_max)
        warnings.extend(bw)
        if observed:
            places = merge_places([places, observed])
            used.append(f"browser:{browser_driver.name}")

    analyses = [analyze_place(p, query.food) for p in places]
    if analyzer is not None:
        _log(f"[claude] {sum(1 for p in places if p.texts)}곳 리뷰 분석 중…")
        notes = analyzer.refine(places, analyses, query.food)
        warnings.extend(f"{p.name}: {n}" for p, n in zip(places, notes, strict=True) if n)

    scored = score_places(places, analyses, query.food, cfg, dish_filter=dish_filter)
    n_ranked = sum(1 for sp in scored if sp.taste_score is not None)
    if 0 < n_ranked < 5:
        warnings.append(
            f"순위 후보가 {n_ranked}곳뿐이라 점수(후보군 내 백분위)의 해상도가 낮습니다. "
            "'맛+분위기'의 '둘 다 중간 이상' 기준도 거칠게 적용됩니다."
        )
    categories = categorize(scored, top=top, cfg=cfg)
    google_used = "google" in used
    if google_reference is not None:
        google_used = annotate_google(categories, google_reference, query.area, warnings) or google_used
        if google_used:
            used.append("google_reference")
    return SearchResult(
        query=query,
        categories=categories,
        scored=scored,
        sources_used=used,
        warnings=warnings,
        google_used=google_used,
    )


def annotate_google(categories: dict[str, list[ScoredPlace]], source, area: str, warnings: list[str]) -> bool:
    """최종 추천된 가게마다 Google Maps 평점을 '참고'로 붙인다(점수에는 쓰지 않음). 하나라도 붙으면 True."""
    done: set[int] = set()
    attached = False
    for picks in categories.values():
        for sp in picks:
            if id(sp) in done:
                continue
            done.add(id(sp))
            try:
                refs = source.reference_lookup(sp.place, area)
            except Exception as e:
                warnings.append(f"Google Maps 참고 조회 실패: {e}")
                return attached
            best = max(refs, key=lambda r: name_similarity(r.name, sp.place.name), default=None)
            if best is not None and name_similarity(best.name, sp.place.name) >= 0.85:
                sp.google_ref = best
                attached = True
    return attached
