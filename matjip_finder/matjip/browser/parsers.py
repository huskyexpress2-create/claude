"""네이버 플레이스·카카오맵 페이지의 '화면에 보이는 텍스트'(innerText)를 해석한다.

클래스 이름은 수시로 바뀌므로 쓰지 않고, 화면 낭독용 라벨("별점", "이 키워드를 선택한 인원" 등)을
기준으로 읽는다. 근거: 2025~2026년 실제 페이지 렌더링·접근성 스냅샷 (README '브라우저 모드' 참고).
확인하지 못한 부분(2026-07 이후 네이버 별점 표기 등)은 값을 못 찾으면 None으로 두고 추측하지 않는다.
"""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from .observations import SiteObservation

# ---- 공통 -------------------------------------------------------------------------------
BLOCK_MARKERS = [
    "과도한 요청", "비정상적인 접근", "비정상적인 요청", "자동입력 방지", "자동 입력 방지", "로봇이 아닙니다",
    "보안 문자", "보안 확인", "서비스 이용이 제한", "접근이 제한", "자동화된 접근", "too many requests", "captcha",
]
SOFT_FAIL_MARKERS = ["일시적인 오류가 발생했습니다", "일시적 오류로 정보를 불러오지 못했습니다", "일시적인 네트워크 오류"]


def _norm(s: str) -> str:
    # 가운뎃점 변형("・" U+30FB, "·" U+00B7)과 공백을 통일한다.
    return re.sub(r"[ \t ]+", " ", s.replace("・", "·").replace("\r", ""))


def detect_block(status: Optional[int], text: str) -> Optional[str]:
    """차단·CAPTCHA로 보이면 이유를, 아니면 None. 이 신호가 나오면 수집을 즉시 멈춘다."""
    if status in (403, 429):
        return f"HTTP {status}"
    low = re.sub(r"\s+", "", text).lower()
    for m in BLOCK_MARKERS:
        if re.sub(r"\s+", "", m).lower() in low:
            return f"차단 문구 '{m}'"
    return None


def is_soft_failure(text: str) -> bool:
    return any(m in text for m in SOFT_FAIL_MARKERS)


def _int(s: str) -> int:
    return int(s.replace(",", ""))


# ---- 네이버 플레이스 -----------------------------------------------------------------------
NAVER_ID_RE = re.compile(r"/(?:restaurant|place|cafe|bakery)/(\d{5,})")
NAVER_WAIT_TAGS = r"바로 입장|\d+\s*분\s*이내|\d+\s*분\s*이상|\d+\s*시간\s*이내|\d+\s*시간\s*이상"
_WAIT_RE = re.compile(rf"대기\s*시간\s*({NAVER_WAIT_TAGS})")
_KEYWORD_RE = re.compile(r'^"([^"\n]{2,30})"\n이 키워드를 선택한 인원\n([\d,]+)$', re.M)
_PARTICIPANTS_RE = re.compile(r"([\d,]+)회\s*([\d,]+)명\s*참여")
_VISIT_CHIP_RE = re.compile(r"^(?:아침에|점심에|저녁에|밤에)\s*방문|대기\s*시간|예약\s*(?:없이|후)\s*이용|포장·배달\s*이용")
# 2026-07 이후 리뷰 카드에 붙는 별점 줄의 정확한 표기는 확인되지 않아 넓게 거른다: "별점", "5", "★★★★★", "평균 별점 4.2"
_RATING_LINE_RE = re.compile(
    r"^(?:평균\s*)?(?:별점|평점)?(?:\s*평균)?\s*(?:[★☆]+\s*)?(?:[0-5](?:\.\d{1,2})?\s*(?:점|/\s*5)?)?$"
)
_PROFILE_RE = re.compile(r"^리뷰\s*[\d,]+\s*사진\s*[\d,]+")
_UI_LINES = {"개의 리뷰가 더 있습니다", "펼쳐보기", "더보기", "반응 남기기", "팔로우", "번역", "번역 보기"}


def naver_list_url(query: str) -> str:
    return f"https://m.place.naver.com/restaurant/list?query={quote(query)}"


def naver_review_url(place_id: str) -> str:
    return f"https://m.place.naver.com/restaurant/{place_id}/review/visitor"


def extract_naver_place_links(links: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """목록 페이지의 (href, 링크 텍스트) → [(장소 id, 표시 이름)], 중복 제거·순서 유지. 광고 항목은 뺀다."""
    out: dict[str, str] = {}
    for href, label in links:
        m = NAVER_ID_RE.search(href or "")
        if not m:
            continue
        first = next((ln.strip() for ln in (label or "").splitlines() if ln.strip()), "")
        if not first or "광고" in (label or ""):
            continue
        out.setdefault(m.group(1), first)
    return list(out.items())


def _naver_header(lines: list[str]) -> list[str]:
    # 탭 줄("홈")까지가 가게 머리말. 리뷰 카드의 별점·리뷰어 평균을 가게 별점으로 오인하지 않도록 범위를 좁힌다.
    for i, ln in enumerate(lines):
        if ln == "홈":
            return lines[:i]
    return lines[:20]


def parse_naver_review_page(text: str, url: str = "") -> tuple[str, SiteObservation]:
    """m.place.naver.com/restaurant/{id}/review/visitor 의 innerText → (가게 이름, 관측값)."""
    text = _norm(text)
    lines = [ln.strip() for ln in text.split("\n")]
    header = _naver_header(lines)
    head = "\n".join(header)

    name = ""
    if "이전 페이지" in header:
        i = header.index("이전 페이지")
        name = header[i + 1] if i + 1 < len(header) else ""

    obs = SiteObservation(site="naver", url=url)
    m = re.search(r"(?:^|\n)별점\n([0-5](?:\.\d{1,2})?)(?=방문자|블로그|\n|$)", head)
    if m:
        obs.rating = float(m.group(1))
    m = re.search(r"방문자\s*리뷰\s*([\d,]+)", head)
    if m:
        obs.review_count = _int(m.group(1))
    m = re.search(r"블로그\s*리뷰\s*([\d,]+)", head)
    if m:
        obs.blog_review_count = _int(m.group(1))

    obs.keywords = {kw.strip(): _int(n) for kw, n in _KEYWORD_RE.findall(text)}
    m = _PARTICIPANTS_RE.search(text)
    if m:
        obs.keyword_participants = _int(m.group(2))

    for ln in lines:
        if "대기" in ln:
            for tag in _WAIT_RE.findall(ln):
                tag = re.sub(r"\s+", " ", tag).strip()
                tag = re.sub(r"(\d+)\s*(분|시간)\s*(이내|이상)", r"\1\2 \3", tag)
                obs.wait_tags[tag] = obs.wait_tags.get(tag, 0) + 1

    obs.reviews = _naver_review_bodies(lines, set(obs.keywords))
    return name, obs


def _naver_review_bodies(lines: list[str], keywords: set[str]) -> list[str]:
    """리뷰 카드에서 본문만 뽑는다. 카드 구조: 닉네임 / '리뷰 N사진 M' / 팔로우 / 방문 정보 / 본문… /
    키워드(+N) / 반응 남기기 / 방문일 …. 닉네임·프로필 줄은 개인 정보라 버린다."""
    bodies = []
    i = 0
    while i < len(lines):
        if lines[i] == "팔로우" and i >= 1 and _PROFILE_RE.match(lines[i - 1]):
            j = i + 1
            chunk = []
            while j < len(lines) and lines[j] != "반응 남기기" and lines[j] != "팔로우":
                chunk.append(lines[j])
                j += 1
            body = []
            for ln in chunk:
                if not ln or ln in _UI_LINES or _VISIT_CHIP_RE.search(ln) or _RATING_LINE_RE.match(ln):
                    continue
                base = re.sub(r"\+\d+$", "", ln)
                if base in keywords or (base != ln and len(base) <= 20):
                    continue  # '음식이 맛있어요+3' 같은 키워드 칩
                body.append(ln)
            if body:
                bodies.append(" ".join(body))
            i = j
        else:
            i += 1
    return bodies


# ---- 카카오맵 ------------------------------------------------------------------------------
KAKAO_ID_RE = re.compile(r"(?:place\.map\.kakao\.com/(?:m/)?|[?&](?:itemId|id)=|/link/map/)(\d{5,})")
KAKAO_STRENGTHS = ("맛", "가성비", "친절", "분위기", "주차", "가격", "전문성")
_KAKAO_STRENGTH_RE = re.compile(rf"^({'|'.join(KAKAO_STRENGTHS)})\n?\s*([\d,]+)\s*명$", re.M)
_KAKAO_DATE_RE = re.compile(r"^\d{4}\.\d{2}\.\d{2}\.$")
_KAKAO_STOP = ("이 지역 친구공유 랭킹", "트렌드 랭킹", "블로그 리뷰\n등록된 상품 개수")


def normalize_kakao_url(url: str) -> Optional[str]:
    m = KAKAO_ID_RE.search(url or "")
    return f"https://place.map.kakao.com/{m.group(1)}" if m else None


def parse_kakao_place_page(text: str, url: str = "") -> tuple[str, SiteObservation]:
    """place.map.kakao.com/{id} 의 innerText → (가게 이름, 관측값).
    아래쪽 '친구공유 랭킹'에는 다른 가게의 별점·후기 수가 있어 그 앞에서 자른다."""
    text = _norm(text)
    for stop in _KAKAO_STOP:
        k = text.find(stop)
        if k != -1:
            text = text[:k]
    lines = [ln.strip() for ln in text.split("\n")]

    name = ""
    if "장소명" in lines:
        i = lines.index("장소명")
        name = lines[i + 1] if i + 1 < len(lines) else ""
    # 머리말: '장소명'부터 탭 줄('홈')까지
    start = lines.index("장소명") if "장소명" in lines else 0
    end = next((i for i in range(start, len(lines)) if lines[i] == "홈"), min(len(lines), start + 25))
    head = "\n".join(lines[start:end])

    obs = SiteObservation(site="kakao", url=url)
    m = re.search(r"(?:^|\n)별점\n([0-5](?:\.\d)?)", head)
    if m:
        obs.rating = float(m.group(1))
    m = re.search(r"(?:^|\n)후기\s*([\d,]+)", head)
    if m:
        obs.review_count = obs.rating_count = _int(m.group(1))
    m = re.search(r"(?:^|\n)블로그\s*([\d,]+)", head)
    if m:
        obs.blog_review_count = _int(m.group(1))

    obs.keywords = {k: _int(n) for k, n in _KAKAO_STRENGTH_RE.findall("\n".join(lines))}
    obs.reviews = _kakao_review_bodies(lines)
    return name, obs


def _kakao_review_bodies(lines: list[str]) -> list[str]:
    """후기 카드: 리뷰어 정보… / 별점 / 점수 / 날짜 'YYYY.MM.DD.' / 본문 / (위치기반) / 좋아요 개수,"""
    bodies = []
    for i, ln in enumerate(lines):
        if not _KAKAO_DATE_RE.match(ln):
            continue
        body = []
        for nxt in lines[i + 1:]:
            if nxt in ("위치기반", "좋아요 개수,", "리뷰어 이름,", "후기 더보기") or _KAKAO_DATE_RE.match(nxt):
                break
            if nxt:
                body.append(nxt)
        text = re.sub(r"\.{3}더보기$|더보기$", "", " ".join(body)).strip()
        if text:
            bodies.append(text)
    return bodies
