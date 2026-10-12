"""카카오 로컬 API 키워드 장소 검색.

공식 API는 장소명·주소·좌표·카테고리·place_url만 주고 **별점/리뷰는 주지 않는다.**
카카오맵 별점은 공식 API가 없으므로 이 프로그램은 수집하지 않는다(약관상 크롤링 금지).
필요하면 카카오맵에서 직접 확인한 값을 수동 CSV(`kakao_rating`, `kakao_count`)로 넣는다.
"""

from __future__ import annotations

from ..http import HttpClient
from ..models import Place
from .base import SearchQuery

ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json"
# FD6: 음식점, CE7: 카페. 베이커리·디저트 가게는 둘 중 어디로든 분류될 수 있어 둘 다 허용한다.
FOOD_GROUPS = {"FD6", "CE7"}


class KakaoLocalSource:
    name = "kakao"

    def __init__(self, rest_api_key: str, http: HttpClient, max_pages: int = 3):
        self.key = rest_api_key
        self.http = http
        self.max_pages = max_pages  # 15건 x 최대 3페이지 = 45건 (API의 pageable 상한)

    def discover(self, query: SearchQuery) -> list[Place]:
        params: dict = {"query": query.text, "size": 15, "sort": "accuracy"}
        if query.lat is not None and query.lng is not None:
            params.update(x=query.lng, y=query.lat, radius=min(query.radius_m, 20000))
        headers = {"Authorization": f"KakaoAK {self.key}"}

        places: list[Place] = []
        for page in range(1, self.max_pages + 1):
            data = self.http.get_json(ENDPOINT, params={**params, "page": page}, headers=headers)
            for d in data.get("documents", []):
                if d.get("category_group_code") not in FOOD_GROUPS:
                    continue
                places.append(parse_document(d))
            if (data.get("meta") or {}).get("is_end", True):
                break
        return places


def parse_document(d: dict) -> Place:
    place = Place(
        name=d.get("place_name", ""),
        address=d.get("road_address_name") or d.get("address_name", ""),
        lat=float(d["y"]) if d.get("y") else None,
        lng=float(d["x"]) if d.get("x") else None,
        category=d.get("category_name", ""),
    )
    place.sources.add("kakao")
    if d.get("id"):
        place.ids["kakao"] = str(d["id"])
    if d.get("place_url"):
        place.urls["kakao"] = d["place_url"]
    return place
