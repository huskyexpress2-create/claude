"""네이버 검색 API (지역 + 블로그).

- 지역 검색: 한 번에 최대 5건만 준다. 별점·방문자 리뷰·키워드 리뷰는 주지 않는다.
  (네이버 플레이스 별점은 2026년 재도입됐지만 공식 API가 없고, 노출 여부를 사업자가 고른다.)
- 블로그 검색: 게시물 총 건수(total)와 제목·요약문(snippet)을 준다.
  이 프로그램은 블로그 요약문을 맛/분위기/웨이팅 텍스트 분석 재료로,
  "<지역> <가게명> 웨이팅" 건수 비율을 웨이팅 보조 지표로 쓴다.
  블로그에는 체험단·협찬 글이 섞이고, 요약문은 본문 일부일 뿐이라 협찬 표기를 놓칠 수 있다.
"""

from __future__ import annotations

import re

from ..http import HttpClient
from ..models import Place, ReviewText
from .base import SearchQuery, clean_html

LOCAL_ENDPOINT = "https://openapi.naver.com/v1/search/local.json"
BLOG_ENDPOINT = "https://openapi.naver.com/v1/search/blog.json"

SPONSORED_RE = re.compile(r"체험단|협찬|원고료|제공받|소정의|서포터즈|업체로부터|광고")
NOT_SPONSORED_RE = re.compile(r"내돈내산|(?:광고|협찬)\s*(?:아님|아닌|아니|[xX])")


def looks_sponsored(text: str) -> bool:
    return bool(SPONSORED_RE.search(text)) and not NOT_SPONSORED_RE.search(text)


def parse_naver_coord(mapx: str, mapy: str) -> tuple[float | None, float | None]:
    """mapx/mapy를 (lat, lng)로 변환한다.

    현재 응답은 WGS84 경위도에 1e7을 곱한 정수 문자열(예: "1270473700")이다.
    과거 응답은 KATECH(TM128) 좌표였는데, 그 형식이면 변환하지 않고 None을 돌려준다
    (이름·주소로만 병합한다).
    """
    try:
        x, y = float(mapx), float(mapy)
    except (TypeError, ValueError):
        return None, None
    if x > 1e8 and y > 1e7:
        lng, lat = x / 1e7, y / 1e7
        if 124 <= lng <= 132 and 33 <= lat <= 39:
            return lat, lng
    return None, None


class NaverSearchSource:
    name = "naver"

    def __init__(self, client_id: str, client_secret: str, http: HttpClient):
        self.http = http
        self.headers = {
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret,
        }

    # ---- 후보 발굴 -------------------------------------------------------
    def discover(self, query: SearchQuery) -> list[Place]:
        # sort=comment: 블로그·카페 리뷰 수 순. 최대 5건이라 발굴보다는 인기 신호에 가깝다.
        data = self.http.get_json(
            LOCAL_ENDPOINT,
            params={"query": query.text, "display": 5, "start": 1, "sort": "comment"},
            headers=self.headers,
        )
        places = []
        for item in data.get("items", []):
            lat, lng = parse_naver_coord(item.get("mapx"), item.get("mapy"))
            p = Place(
                name=clean_html(item.get("title", "")),
                address=item.get("roadAddress") or item.get("address", ""),
                lat=lat,
                lng=lng,
                category=item.get("category", ""),
            )
            p.sources.add("naver")
            if item.get("link"):
                p.urls["naver"] = item["link"]
            places.append(p)
        return places

    # ---- 장소별 보강 -----------------------------------------------------
    def blog_search(self, q: str, display: int) -> tuple[int, list[ReviewText]]:
        data = self.http.get_json(
            BLOG_ENDPOINT,
            params={"query": q, "display": max(1, min(display, 100)), "start": 1, "sort": "sim"},
            headers=self.headers,
        )
        texts = []
        for item in data.get("items", []):
            title = clean_html(item.get("title", ""))
            desc = clean_html(item.get("description", ""))
            body = f"{title}. {desc}".strip(". ")
            texts.append(
                ReviewText(
                    source="naver_blog",
                    text=body,
                    date=item.get("postdate"),
                    url=item.get("link"),
                    sponsored=looks_sponsored(body),
                )
            )
        return int(data.get("total") or 0), texts

    def enrich(self, place: Place, area: str, n_texts: int = 30) -> None:
        base_q = f"{area} {place.name}".strip()
        total, texts = self.blog_search(base_q, n_texts)
        wait_total, wait_texts = self.blog_search(f"{base_q} 웨이팅", 10)
        for t in wait_texts:
            t.source = "naver_blog_waiting"
        seen = {t.url for t in place.texts if t.url}
        for t in texts + wait_texts:
            if t.url and t.url in seen:
                continue
            seen.add(t.url)
            place.texts.append(t)
        place.blog_total = total
        place.blog_waiting_total = wait_total
