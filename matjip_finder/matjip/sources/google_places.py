"""Google Places API (New) Text Search.

- 공식 API이며 평점(rating), 평점 수(userRatingCount), 리뷰 최대 5건을 준다.
- 리뷰 필드를 요청하면 상위 과금 SKU가 적용된다. 비용은 Google Cloud 콘솔에서 확인할 것.
- 한국 매장은 카카오·네이버보다 구글 리뷰 수가 적고 외국인 관광객 비중이 높은 편이라,
  scoring 단계에서 플랫폼 가중치를 조금 낮춘다(config.PLATFORM_WEIGHTS).
"""

from __future__ import annotations

from ..http import HttpClient
from ..models import Place, PlatformRating, ReviewText
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
        "places.reviews",
        "places.googleMapsUri",
        "places.primaryTypeDisplayName",
        "places.reservable",
        "nextPageToken",
    ]
)


class GooglePlacesSource:
    name = "google"

    def __init__(self, api_key: str, http: HttpClient, max_pages: int = 3):
        self.api_key = api_key
        self.http = http
        self.max_pages = max_pages

    def discover(self, query: SearchQuery) -> list[Place]:
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
        headers = {"X-Goog-Api-Key": self.api_key, "X-Goog-FieldMask": FIELD_MASK}

        places: list[Place] = []
        for _ in range(self.max_pages):
            data = self.http.post_json(ENDPOINT, headers=headers, json_body=body)
            places.extend(parse_place(p) for p in data.get("places", []))
            token = data.get("nextPageToken")
            if not token:
                break
            body = {**body, "pageToken": token}
        return places


def parse_place(p: dict) -> Place:
    loc = p.get("location") or {}
    place = Place(
        name=(p.get("displayName") or {}).get("text", ""),
        address=p.get("formattedAddress", ""),
        lat=loc.get("latitude"),
        lng=loc.get("longitude"),
        category=(p.get("primaryTypeDisplayName") or {}).get("text", ""),
        reservable=p.get("reservable"),
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
    for r in p.get("reviews") or []:
        # originalText가 원문(대개 한국어), text는 languageCode로 번역됐을 수 있다.
        text = (r.get("originalText") or r.get("text") or {}).get("text", "")
        if text:
            place.texts.append(
                ReviewText(
                    source="google_review",
                    text=text,
                    rating=r.get("rating"),
                    date=r.get("publishTime"),
                )
            )
    return place
