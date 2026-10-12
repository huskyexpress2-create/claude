"""브라우저 모드 파서·수집기 테스트.

fixtures/*.txt 는 2025~2026년 실제 네이버 플레이스·카카오맵 화면의 라벨·줄 구조를 그대로 따르되,
가게 이름·리뷰·닉네임은 지어낸 값이다 (실제 개인 정보 없음).
"""

import random
from pathlib import Path

import pytest

from matjip.browser.parsers import (
    detect_block,
    extract_naver_place_links,
    normalize_kakao_url,
    parse_kakao_place_page,
    parse_naver_review_page,
)
from matjip.browser.playwright_driver import BrowserCollector, PageResult, PlaywrightDriver
from matjip.models import Place
from matjip.sources import SearchQuery

FIX = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


# ---- 네이버 ------------------------------------------------------------------------------
def test_naver_legacy_rating_page():
    name, o = parse_naver_review_page(fixture("naver_review_legacy_rating.txt"), "u")
    assert name == "구름소금빵 성수점"
    assert (o.rating, o.review_count, o.blog_review_count) == (4.61, 1284, 312)
    assert o.keyword_participants == 1037
    assert o.keywords["빵이 맛있어요"] == 812 and len(o.keywords) == 5
    assert o.wait_tags == {"바로 입장": 5, "10분 이내": 2, "30분 이내": 1, "1시간 이상": 1}
    assert len(o.reviews) == 9  # 10개 중 키워드만 남긴 리뷰 1개는 본문이 없다
    assert "오픈런 했는데도 1시간 기다렸어요 그래도 맛은 인정" in o.reviews
    # 닉네임·프로필 줄은 본문에 들어가지 않는다
    assert not any("빵순이일기" in r or "리뷰 88" in r for r in o.reviews)


def test_naver_2026_page_without_rating():
    name, o = parse_naver_review_page(fixture("naver_review_2026_norating.txt"))
    assert name == "달빛마라탕 성수역점"
    assert o.rating is None  # 사장님이 평균 별점을 숨기면 None (0이 아님)
    assert (o.review_count, o.blog_review_count) == (157, 4)
    assert o.keywords["음식이 맛있어요"] == 98
    assert o.wait_tags["바로 입장"] == 6
    assert "맛있어요!!" in o.reviews


@pytest.mark.parametrize("value, expected", [("4.61", 4.61), ("4.3", 4.3), ("5", 5.0)])
def test_naver_rating_formats(value, expected):
    text = f"이전 페이지\n가게\n가게베이커리\n별점\n{value}방문자 리뷰 10블로그 리뷰 2\n홈\n"
    assert parse_naver_review_page(text)[1].rating == expected


def test_naver_reviewer_rating_is_not_place_rating():
    # 평균을 숨긴 가게에서, 리뷰 카드 안의 별점이 가게 별점으로 잡히면 안 된다.
    text = (
        "이전 페이지\n가게\n가게카페\n방문자 리뷰 10블로그 리뷰 2\n홈\n리뷰\n"
        "닉네임\n리뷰 3사진 1\n팔로우\n점심에 방문예약 없이 이용대기 시간 30분 이상일상혼자\n별점\n5\n맛있어요\n반응 남기기\n"
    )
    _, o = parse_naver_review_page(text)
    assert o.rating is None
    assert o.reviews == ["맛있어요"]
    assert o.wait_tags == {"30분 이상": 1}


def test_naver_list_links():
    links = [
        ("https://m.place.naver.com/restaurant/1234567/home", "구름소금빵 성수점\n베이커리\n리뷰 999+"),
        ("/restaurant/1234567/review/visitor", "리뷰 999+"),  # 같은 id 중복
        ("https://m.place.naver.com/restaurant/7654321/home", "광고\n어딘가빵집"),
        ("https://m.place.naver.com/place/2222222", "달빛마라탕"),
        ("https://example.com/x", "외부 링크"),
    ]
    assert extract_naver_place_links(links) == [("1234567", "구름소금빵 성수점"), ("2222222", "달빛마라탕")]


# ---- 카카오 ------------------------------------------------------------------------------
def test_kakao_place_page():
    name, o = parse_kakao_place_page(fixture("kakao_place_home.txt"), "u")
    assert name == "달무리소금빵 성수점"
    assert (o.rating, o.review_count, o.blog_review_count) == (4.3, 1284, 612)
    assert o.keywords == {"맛": 412, "분위기": 205, "친절": 190, "가성비": 88, "주차": 12}
    assert len(o.reviews) == 3 and o.reviews[1] == "맛은 좋은데 주말엔 줄이 길어요."
    assert not any("더보기" in r for r in o.reviews)


def test_kakao_ranking_section_does_not_leak():
    # 후기 없는 가게: 아래 '친구공유 랭킹'의 다른 가게 별점(4.2)·후기 수(1530)를 잡으면 안 된다.
    name, o = parse_kakao_place_page(fixture("kakao_place_no_reviews.txt"))
    assert name == "가상디저트랩"
    assert o.rating is None and o.review_count is None
    assert o.blog_review_count == 7


@pytest.mark.parametrize(
    "url, expected",
    [
        ("http://place.map.kakao.com/12345678", "https://place.map.kakao.com/12345678"),
        ("https://place.map.kakao.com/m/12345678#review", "https://place.map.kakao.com/12345678"),
        ("https://map.kakao.com/?itemId=12345678", "https://place.map.kakao.com/12345678"),
        ("https://map.kakao.com/link/map/12345678", "https://place.map.kakao.com/12345678"),
        ("https://example.com", None),
    ],
)
def test_normalize_kakao_url(url, expected):
    assert normalize_kakao_url(url) == expected


# ---- 차단 감지 ----------------------------------------------------------------------------
@pytest.mark.parametrize(
    "status, text, blocked",
    [
        (429, "", True),
        (403, "아무거나", True),
        (200, "서비스 이용이 제한되었습니다", True),
        (200, "자동 입력 방지 문자를 입력하세요", True),
        (200, "보안문자를 입력해 주세요", True),
        (200, fixture("naver_review_legacy_rating.txt"), False),
        (200, fixture("kakao_place_home.txt"), False),
    ],
)
def test_detect_block(status, text, blocked):
    assert (detect_block(status, text) is not None) == blocked


# ---- 수집기 (가짜 브라우저) -------------------------------------------------------------------
class FakeReader:
    def __init__(self, pages):
        self.pages = pages  # url 접두어 → PageResult
        self.visited = []

    def read(self, url, wait_selector=None, want_links=False):
        self.visited.append(url)
        for prefix, res in self.pages.items():
            if url.startswith(prefix):
                return res
        return PageResult(404, "", [])


LIST = "https://m.place.naver.com/restaurant/list"
NAVER_REVIEW = "https://m.place.naver.com/restaurant/1111111/review/visitor"
KAKAO = "https://place.map.kakao.com/2222222"


def _pages(review_status=200):
    return {
        LIST: PageResult(200, "목록", [("https://m.place.naver.com/restaurant/1111111/home", "구름소금빵 성수점\n베이커리")]),
        NAVER_REVIEW: PageResult(review_status, fixture("naver_review_legacy_rating.txt"), []),
        KAKAO: PageResult(200, fixture("kakao_place_home.txt").replace("달무리소금빵", "구름소금빵"), []),
    }


def _collector(reader, sleeps):
    return BrowserCollector(reader, ["naver", "kakao"], sleep=sleeps.append, rng=random.Random(0))


def test_collector_paces_and_collects():
    reader, sleeps = FakeReader(_pages()), []
    target = Place(name="구름소금빵 성수점")
    target.urls["kakao"] = "http://place.map.kakao.com/2222222"
    out = _collector(reader, sleeps).run(SearchQuery("소금빵", "성수동"), [target], 5)
    assert [o.site for o in out[0].observations] == ["naver", "kakao"]
    assert reader.visited == [reader.visited[0], NAVER_REVIEW, KAKAO]
    assert "%EC%84%B1%EC%88%98%EB%8F%99" in reader.visited[0]  # '성수동 소금빵' 목록 한 번으로 id를 찾음
    assert len(sleeps) == 2 and all(5 <= s <= 8 for s in sleeps)  # 첫 페이지 외에는 매번 5~8초 대기


def test_collector_stops_on_block_and_keeps_partial():
    pages = _pages(review_status=429)
    reader, sleeps = FakeReader(pages), []
    a = Place(name="구름소금빵 성수점")
    b = Place(name="다른집")
    col = _collector(reader, sleeps)
    out = col.run(SearchQuery("소금빵", "성수동"), [a, b], 5)
    assert out == []
    assert any("차단 신호" in w and "HTTP 429" in w for w in col.warnings)
    assert reader.visited[-1] == NAVER_REVIEW  # 차단 뒤로는 더 열지 않음


def test_collector_skips_wrong_place():
    pages = _pages()
    pages[KAKAO] = PageResult(200, fixture("kakao_place_home.txt"), [])  # 다른 가게 페이지
    target = Place(name="구름소금빵 성수점")
    target.urls["kakao"] = "https://place.map.kakao.com/2222222"
    col = _collector(FakeReader(pages), [])
    out = col.run(SearchQuery("소금빵", "성수동"), [target], 5)
    assert [o.site for o in out[0].observations] == ["naver"]
    assert any("달라 건너뜀" in w for w in col.warnings)


def test_collector_discovers_when_no_targets():
    pages = _pages()
    # 실제 목록 링크는 이름과 업종이 한 줄로 붙어 나온다
    pages[LIST] = PageResult(200, "목록", [("/restaurant/1111111/home", "구름소금빵 성수점 베이커리")])
    col = _collector(FakeReader(pages), [])
    out = col.run(SearchQuery("소금빵", "성수동"), [], 3)
    assert out[0].name == "구름소금빵 성수점"  # 가게 페이지의 정식 이름으로 바뀜


def test_driver_with_fake_reader(tmp_path):
    driver = PlaywrightDriver(["naver"], reader_factory=lambda: FakeReader(_pages()), sleep=lambda s: None)
    driver_places, warnings = driver.collect(SearchQuery("소금빵", "성수동"), [Place(name="구름소금빵 성수점")], 3)
    (p,) = driver_places
    assert p.rating_for("naver").rating == 4.61 and p.wait_tags["바로 입장"] == 5
    path = tmp_path / "saved.json"
    driver.save(str(path), SearchQuery("소금빵", "성수동"))
    assert "구름소금빵" in path.read_text(encoding="utf-8")
