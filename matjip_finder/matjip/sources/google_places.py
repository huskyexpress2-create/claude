"""Google Places API (New) Text Search.

Google Maps Platform 약관(2026-08-26 수정본) 때문에 쓰임새를 두 가지로 나눈다.
- 참고 표시(기본, `reference_lookup`): 최종 추천된 가게마다 Google 검색을 한 번 해서 평점·평점 수·지도 링크를
  "Google Maps" 표기와 함께 따로 보여 준다. 점수에는 쓰지 않는다.
- 점수 반영(`--google-scoring`, `GooglePlacesSource.discover`): 후보 발굴과 종합 점수에 Google 평점을 섞는다.
  약관 3.2.3(c)(g)(검색 결과 변경·파생 콘텐츠 생성 금지)와 충돌할 소지가 있어 사용자가 직접 켜야 한다.
어느 쪽이든 리뷰 본문(places.reviews)은 요청하지 않는다. 3.2.3(a)(c)상 리뷰를 AI에 넣거나 분석·저장할 수 없고,
리뷰 필드는 더 비싼 SKU를 쓴다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..http import HttpClient
from ..models import Place, PlatformRating
from .base import SearchQuery

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.rating",
        "places.userRatingCount",
        "places.googleMapsUri",
        "places.primaryTypeDisplayName",
        "nextPageToken",
    ]
)
REF_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri"
GOOGLE_TERMS_NOTICE = (
    "Google Maps 콘텐츠가 포함됩니다: https://maps.google.com/help/terms_maps/ · https://policies.google.com/privacy"
)


@dataclass
class GoogleRef:
    """Google Maps 참고 정보 (표시 전용, 저장·가공하지 않음)."""

    name: str
    rating: Optional[float]
    count: int
    uri: str
    address: str = ""


class GooglePlacesSource:
    name = "google"

    def __init__(self, api_key: str, http: HttpClient, max_pages: int = 3):
        self.api_key = api_key
        self.http = http
        self.max_pages = max_pages

    def _headers(self, mask: str) -> dict[str, str]:
        return {"X-Goog-Api-Key": self.api_key, "X-Goog-FieldMask": mask}

    def discover(self, query: SearchQuery) -> list[Place]:
        """--google-scoring 전용: 후보 발굴 + 평점을 점수에 반영."""
        body: dict = {
            "textQuery": query.text,
            "languageCode": "ko",
            "regionCode": "KR",
            "pageSize": 20,
        }
        if query.lat is not None and query.lng is not None:
            body["locationBias"] = {
                "circle": {
                    "center": {"latitude": query.lat, "longitude": query.lng},
                    "radius": float(min(query.radius_m, 50000)),
                }
            }
        places: list[Place] = []
        for _ in range(self.max_pages):
            data = self.http.post_json(ENDPOINT, headers=self._headers(FIELD_MASK), json_body=body)
            places.extend(parse_place(p) for p in data.get("places", []))
            token = data.get("nextPageToken")
            if not token:
                break
            body = {**body, "pageToken": token}
        return places

    def reference_lookup(self, place: Place, area: str) -> list[GoogleRef]:
        """가게 하나를 Google에서 찾아 후보 최대 3개를 돌려준다(표시 전용)."""
        body: dict = {
            "textQuery": f"{place.name} {area}".strip(),
            "languageCode": "ko",
            "regionCode": "KR",
            "pageSize": 3,
        }
        if place.lat is not None and place.lng is not None:
            body["locationBias"] = {
                "circle": {"center": {"latitude": place.lat, "longitude": place.lng}, "radius": 300.0}
            }
        data = self.http.post_json(ENDPOINT, headers=self._headers(REF_FIELD_MASK), json_body=body)
        refs = []
        for p in data.get("places", []):
            refs.append(
                GoogleRef(
                    name=(p.get("displayName") or {}).get("text", ""),
                    rating=p.get("rating"),
                    count=int(p.get("userRatingCount") or 0),
                    uri=p.get("googleMapsUri", ""),
                    address=p.get("formattedAddress", ""),
                )
            )
        return refs


def parse_place(p: dict) -> Place:
    loc = p.get("location") or {}
    place = Place(
        name=(p.get("displayName") or {}).get("text", ""),
        address=p.get("formattedAddress", ""),
        lat=loc.get("latitude"),
        lng=loc.get("longitude"),
        category=(p.get("primaryTypeDisplayName") or {}).get("text", ""),
    )
    place.sources.add("google")
    if p.get("id"):
        place.ids["google"] = p["id"]
    if p.get("googleMapsUri"):
        place.urls["google"] = p["googleMapsUri"]
    if p.get("rating") is not None:
        place.ratings.append(
            PlatformRating(
                platform="google",
                rating=float(p["rating"]),
                count=int(p.get("userRatingCount") or 0),
                url=p.get("googleMapsUri"),
            )
        )
    return place
