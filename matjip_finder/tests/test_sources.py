import json

from matjip.http import HttpClient
from matjip.sources import (
    GooglePlacesSource,
    KakaoLocalSource,
    NaverSearchSource,
    SearchQuery,
    load_manual_csv,
    parse_naver_coord,
)
from matjip.sources.naver_search import looks_sponsored


class FakeTransport:
    """URL 접두어 → 응답 목록(호출 순서대로). 받은 요청을 기록한다."""

    def __init__(self, routes):
        self.routes = {k: list(v) for k, v in routes.items()}
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, json.loads(body) if body else None))
        for prefix, responses in self.routes.items():
            if url.startswith(prefix):
                return 200, json.dumps(responses.pop(0)).encode()
        return 404, b"{}"


Q = SearchQuery(food="소금빵", area="성수동")


def test_google_places_parse_and_pagination():
    page1 = {
        "places": [
            {
                "id": "g1",
                "displayName": {"text": "빵집"},
                "formattedAddress": "서울 성동구",
                "location": {"latitude": 37.5, "longitude": 127.0},
                "rating": 4.6,
                "userRatingCount": 1234,
                "googleMapsUri": "https://maps.google.com/?cid=1",
                "reviews": [
                    {"rating": 5, "text": {"text": "translated"}, "originalText": {"text": "소금빵 맛있어요"}}
                ],
            }
        ],
        "nextPageToken": "tok",
    }
    page2 = {"places": [{"id": "g2", "displayName": {"text": "카페"}}]}
    t = FakeTransport({"https://places.googleapis.com": [page1, page2]})
    places = GooglePlacesSource("KEY", HttpClient(t)).discover(Q)
    assert [p.name for p in places] == ["빵집", "카페"]
    assert places[0].rating_for("google").count == 1234
    assert places[0].texts == []  # 약관상 리뷰 본문은 받지도 분석하지도 않는다
    _, _, headers, body = t.calls[0]
    assert headers["X-Goog-Api-Key"] == "KEY"
    assert "places.reviews" not in headers["X-Goog-FieldMask"]
    assert body["textQuery"] == "성수동 소금빵"
    assert t.calls[1][3]["pageToken"] == "tok"


def test_kakao_filters_non_food_and_stops_at_end():
    docs = [
        {"id": "1", "place_name": "빵집", "category_group_code": "FD6", "x": "127.05", "y": "37.54",
         "road_address_name": "서울 성동구 1", "place_url": "http://place.map.kakao.com/1"},
        {"id": "2", "place_name": "주차장", "category_group_code": "PK6", "x": "127.0", "y": "37.5"},
        {"id": "3", "place_name": "카페", "category_group_code": "CE7", "x": "127.0", "y": "37.5"},
    ]
    t = FakeTransport({"https://dapi.kakao.com": [{"documents": docs, "meta": {"is_end": True}}]})
    places = KakaoLocalSource("KEY", HttpClient(t)).discover(Q)
    assert [p.name for p in places] == ["빵집", "카페"]
    assert places[0].lat == 37.54 and places[0].lng == 127.05
    assert len(t.calls) == 1
    assert t.calls[0][2]["Authorization"] == "KakaoAK KEY"


def test_naver_coord_formats():
    assert parse_naver_coord("1270473700", "375410200") == (37.54102, 127.04737)
    assert parse_naver_coord("311277", "552097") == (None, None)  # 과거 KATECH 형식은 쓰지 않음
    assert parse_naver_coord(None, None) == (None, None)


def test_naver_local_and_blog_enrich():
    local = {"items": [{"title": "<b>빵집</b> 성수", "mapx": "1270473700", "mapy": "375410200",
                        "roadAddress": "서울 성동구 1", "link": ""}]}
    blog = {"total": 200, "items": [
        {"title": "성수 <b>빵집</b>", "description": "소금빵 맛있어요 &amp; 촉촉", "link": "u1", "postdate": "20260101"},
        {"title": "체험단 후기", "description": "소정의 원고료를 받아 작성", "link": "u2"},
    ]}
    wait = {"total": 40, "items": [{"title": "웨이팅", "description": "웨이팅 1시간", "link": "u3"},
                                   {"title": "중복", "description": "같은 글", "link": "u1"}]}
    t = FakeTransport({
        "https://openapi.naver.com/v1/search/local": [local],
        "https://openapi.naver.com/v1/search/blog": [blog, wait],
    })
    src = NaverSearchSource("ID", "SECRET", HttpClient(t))
    (p,) = src.discover(Q)
    assert p.name == "빵집 성수" and p.lat == 37.54102
    src.enrich(p, "성수동")
    assert (p.blog_total, p.blog_waiting_total) == (200, 40)
    assert [t_.source for t_ in p.texts] == ["naver_blog", "naver_blog", "naver_blog_waiting"]
    assert p.texts[0].text == "성수 빵집. 소금빵 맛있어요 & 촉촉"
    assert p.texts[1].sponsored and not p.texts[0].sponsored


def test_sponsored_disclaimer_not_flagged():
    assert looks_sponsored("업체로부터 제품을 제공받아 작성")
    assert not looks_sponsored("내돈내산 후기, 광고 아님")


def test_manual_csv(tmp_path):
    f = tmp_path / "m.csv"
    f.write_text(
        "name,kakao_rating,kakao_count,diningcode_rating,taste_votes,keyword_review_total,waiting_minutes,reservable,awards,reviews\n"
        "빵집,4.5,\"1,203\",88,900,1000,30,예,블루리본 1|미쉐린,맛있어요|웨이팅 길어요\n",
        encoding="utf-8",
    )
    (p,) = load_manual_csv(f)
    assert p.rating_for("kakao").count == 1203
    assert p.rating_for("diningcode").scale == 100.0
    vs = p.vote_stats["manual"]
    assert (vs.taste, vs.mood, vs.total) == (900, 0, 1000)
    assert p.waiting_minutes == 30 and p.reservable is True
    assert p.awards == ["블루리본 1", "미쉐린"]
    assert [t.text for t in p.texts] == ["맛있어요", "웨이팅 길어요"]
