import json
import urllib.parse

from matjip.http import HttpClient
from matjip.pipeline import run_search
from matjip.report import render_json, render_text
from matjip.sources import GooglePlacesSource, KakaoLocalSource, NaverSearchSource, SearchQuery

GOOGLE = {
    "places": [
        {"id": "g1", "displayName": {"text": "오븐집"}, "location": {"latitude": 37.5440, "longitude": 127.0550},
         "rating": 4.7, "userRatingCount": 2500,
         "reviews": [{"rating": 5, "originalText": {"text": "소금빵 인생 맛집, 웨이팅 1시간"}}]},
        {"id": "g2", "displayName": {"text": "조용한빵집"}, "location": {"latitude": 37.5470, "longitude": 127.0600},
         "rating": 4.5, "userRatingCount": 600,
         "reviews": [{"rating": 5, "originalText": {"text": "소금빵 고소하고 맛있어요. 웨이팅 없이 바로 샀어요"}}]},
        {"id": "g3", "displayName": {"text": "그냥빵집"}, "location": {"latitude": 37.5500, "longitude": 127.0650},
         "rating": 4.0, "userRatingCount": 300,
         "reviews": [{"rating": 3, "originalText": {"text": "소금빵 평범해요"}}]},
    ]
}
KAKAO = {
    "documents": [
        {"id": "1", "place_name": "오븐집", "category_group_code": "FD6", "x": "127.05501", "y": "37.54401",
         "road_address_name": "서울 성동구 1", "place_url": "http://place.map.kakao.com/1"},
        {"id": "2", "place_name": "조용한빵집", "category_group_code": "CE7", "x": "127.06", "y": "37.547",
         "road_address_name": "서울 성동구 2", "place_url": "http://place.map.kakao.com/2"},
    ],
    "meta": {"is_end": True},
}
BLOGS = {
    "성수동 오븐집": ["소금빵 겉바속촉 최고", "오픈런 했어요", "줄 서서 50분 기다렸어요", "매장이 좁고 시끄러워요", "소금빵 버터 풍미"],
    "성수동 조용한빵집": ["소금빵 맛있어요", "한산하고 조용해요", "인테리어 아늑하고 예뻐요", "대기 없이 들어갔어요"],
    "성수동 그냥빵집": ["소금빵 그냥 그래요", "매장이 좁아요", "웨이팅 없어요"],
}


def transport(method, url, headers, body):
    if url.startswith("https://places.googleapis.com"):
        return 200, json.dumps(GOOGLE).encode()
    if url.startswith("https://dapi.kakao.com"):
        return 200, json.dumps(KAKAO).encode()
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["query"][0]
    if "/local.json" in url:
        return 200, json.dumps({"items": []}).encode()
    if q.endswith(" 웨이팅"):
        name = q[: -len(" 웨이팅")]
        n = 300 if "오븐집" in name else 20
        return 200, json.dumps({"total": n, "items": []}).encode()
    items = [{"title": "", "description": t, "link": f"{q}/{i}"} for i, t in enumerate(BLOGS.get(q, []))]
    return 200, json.dumps({"total": 600 if "오븐집" in q else 200, "items": items}).encode()


def test_end_to_end_with_fake_apis():
    http = HttpClient(transport)
    naver = NaverSearchSource("id", "secret", http)
    res = run_search(
        SearchQuery(food="소금빵", area="성수동"),
        [GooglePlacesSource("k", http, max_pages=1), KakaoLocalSource("k", http), naver],
        naver=naver,
    )
    assert len(res.scored) == 3  # 구글 3곳 + 카카오 2곳 → 병합 후 3곳
    oven = next(sp for sp in res.scored if sp.place.name == "오븐집")
    assert oven.place.sources == {"google", "kakao"}
    assert oven.place.urls["kakao"].endswith("/1")
    assert oven.waiting_level == "김"
    assert res.categories["any_taste"][0].place.name == "오븐집"
    assert res.categories["low_taste"][0].place.name == "조용한빵집"
    assert res.categories["low_both"][0].place.name == "조용한빵집"
    assert "naver_blog" in res.sources_used
    assert "오븐집" in render_text(res)
    json.loads(render_json(res))
    assert any("후보가 3곳뿐" in w for w in res.warnings)


def test_one_failing_source_does_not_abort():
    def broken(method, url, headers, body):
        if url.startswith("https://dapi.kakao.com"):
            return 401, b'{"msg":"bad key"}'
        return transport(method, url, headers, body)

    http = HttpClient(broken, retries=0)
    res = run_search(
        SearchQuery(food="소금빵", area="성수동"),
        [GooglePlacesSource("k", http, max_pages=1), KakaoLocalSource("bad", http)],
    )
    assert any("kakao 검색 실패" in w for w in res.warnings)
    assert len(res.scored) == 3
