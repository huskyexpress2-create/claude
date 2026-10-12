import json

import pytest

from matjip.browser.keywords import classify_keyword, split_votes
from matjip.browser.observations import (
    PlaceObservation,
    SiteObservation,
    load_places,
    load_results,
    save_results,
    to_place,
)
from matjip.browser.plan import write_plan
from matjip.cli import main
from matjip.config import ScoringConfig
from matjip.models import LiveWaiting, Place, PlatformRating, ReviewText, TextAnalysis
from matjip.scoring import estimate_waiting, live_teams_to_index, tag_to_minutes, wait_tag_minutes
from matjip.sources import SearchQuery


@pytest.mark.parametrize(
    "kw, kind",
    [
        ("음식이 맛있어요", "taste"),
        ('"디저트가 맛있어요"', "taste"),
        ("재료가 신선해요", "taste"),
        ("맛", "taste"),  # 카카오 추천 포인트
        ("인테리어가 멋져요", "mood"),
        ("차분한 분위기예요", "mood"),
        ("분위기", "mood"),
        ("뷰가 좋아요", "mood"),
        ("음식이 빨리 나와요", None),
        ("매장이 청결해요", None),
        ("가성비가 좋아요", None),
        ("친절해요", None),
    ],
)
def test_classify_keyword(kw, kind):
    assert classify_keyword(kw) == kind


def test_split_votes():
    assert split_votes({"음식이 맛있어요": 224, "인테리어가 멋져요": 40, "친절해요": 94}) == (224, 40)


def _results(tmp_path, places, query=None):
    path = tmp_path / "r.json"
    path.write_text(
        json.dumps(
            {"version": 1, "query": query or {"food": "소금빵", "area": "성수동"},
             "collected_at": "2026-10-12T19:30:00+09:00", "collector": "claude", "places": places},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def test_load_results_validates_loosely(tmp_path):
    path = _results(tmp_path, [
        {"name": "오븐집", "observations": [
            {"site": "naver", "rating": "4.52", "review_count": "1,234",
             "keywords": {"음식이 맛있어요": 224, "bad": "x", "": 3},
             "wait_tags": {"바로 입장": 7, "30분 이상": -1},
             "reviews": ["맛있어요", 3, "  "], "live_waiting_teams": None},
            {"site": "kakao", "rating": 9.9},  # 범위 밖 별점은 버리고, 남는 값이 없으면 관측값 자체를 버림
            {"rating": 4.0},  # site 없음
        ]},
        {"name": "", "observations": []},
        "garbage",
    ])
    meta, places = load_results(path)
    assert meta["collector"] == "claude"
    (po,) = places
    (o,) = po.observations
    assert o.rating == 4.52 and o.review_count == 1234
    assert o.keywords == {"음식이 맛있어요": 224}
    assert o.wait_tags == {"바로 입장": 7}
    assert o.reviews == ["맛있어요"]


def test_load_results_rejects_non_results_file(tmp_path):
    p = tmp_path / "x.json"
    p.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError):
        load_results(p)


def test_to_place_maps_everything():
    po = PlaceObservation(name="오븐집", observations=[
        SiteObservation(site="naver", url="https://m.place.naver.com/restaurant/1/home", rating=4.5, review_count=200,
                        keywords={"음식이 맛있어요": 150, "인테리어가 멋져요": 20}, wait_tags={"바로 입장": 3, "1시간 이상": 2},
                        reviews=["소금빵 최고"]),
        SiteObservation(site="kakao", rating=4.1, rating_count=80, keywords={"맛": 30, "분위기": 5}),
        SiteObservation(site="tabling", live_waiting_teams=6, observed_at="2026-10-12T19:30"),
    ])
    p = to_place(po)
    assert p.urls["naver_place"].endswith("/home")
    assert {(r.platform, r.rating, r.count) for r in p.ratings} == {("naver", 4.5, 200), ("kakao", 4.1, 80)}
    assert (p.vote_stats["naver"].taste, p.vote_stats["naver"].mood, p.vote_stats["naver"].total) == (150, 20, 200)
    assert p.vote_stats["kakao"].total == 35  # 리뷰 수가 없으면 키워드 합을 분모로
    assert p.wait_tags == {"바로 입장": 3, "1시간 이상": 2}
    assert p.texts[0].source == "naver_place_review"
    assert p.live_waiting == LiveWaiting(6, "tabling", "2026-10-12T19:30")


def test_save_and_reload_roundtrip(tmp_path):
    po = PlaceObservation(name="빵집", observations=[SiteObservation(site="naver", rating=4.2, review_count=10)])
    path = tmp_path / "out.json"
    save_results(path, "소금빵", "성수동", "playwright", [po])
    places, warnings = load_places(path, "소금빵", "성수동")
    assert places[0].rating_for("naver").rating == 4.2 and not warnings
    _, warnings = load_places(path, "크로플", "성수동")
    assert any("메뉴" in w for w in warnings)


# ---- 웨이팅 신호 ---------------------------------------------------------------------
def test_tag_minutes():
    assert tag_to_minutes("바로 입장") == 0
    assert tag_to_minutes("2시간 이상") == 140
    assert tag_to_minutes("15분 이내") == pytest.approx(9.0)  # 목록에 없는 형식도 해석
    assert tag_to_minutes("모름") is None
    assert wait_tag_minutes({"바로 입장": 8, "1시간 이상": 2, "이상한값": 5}) == (16.0, 10)


def _wait(place):
    return estimate_waiting(place, TextAnalysis(), None, ScoringConfig())


def test_wait_tags_drive_level_and_confidence():
    mostly_none = Place(name="a", wait_tags={"바로 입장": 18, "10분 이내": 2})
    we = _wait(mostly_none)
    assert we.level == "거의 없음" and we.confidence == "높음"
    long_ = Place(name="b", wait_tags={"1시간 이상": 6, "30분 이상": 4})
    we = _wait(long_)
    assert we.level == "김" and we.confidence == "중간"


def test_live_waiting_dominates():
    p = Place(name="a", wait_tags={"바로 입장": 3}, live_waiting=LiveWaiting(12, "catchtable", "2026-10-12T19:30"))
    we = _wait(p)
    assert we.level == "김" and we.confidence == "높음"
    assert any("실시간 대기 12팀" in b for b in we.basis)
    assert live_teams_to_index(0) < 0.2


# ---- 계획 파일 / CLI ------------------------------------------------------------------
def test_write_plan(tmp_path):
    p = Place(name="오븐집", address="서울 성동구 1")
    p.urls["kakao"] = "http://place.map.kakao.com/1"
    tasks, prompt = write_plan(tmp_path / "b", SearchQuery("소금빵", "성수동"), [p], 8, ["--top", "1"])
    data = json.loads(tasks.read_text(encoding="utf-8"))
    assert data["candidates"][0]["known_urls"]["kakao"].endswith("/1")
    text = prompt.read_text(encoding="utf-8")
    assert "로그인하지 않은" in text and "CAPTCHA" in text
    assert "--browser-results" in text and "--top 1" in text


def test_write_plan_without_candidates(tmp_path):
    _, prompt = write_plan(tmp_path, SearchQuery("소금빵", "성수동"), [], 5, [])
    assert "네이버 지도에서 '성수동 소금빵'" in prompt.read_text(encoding="utf-8")


def test_cli_browser_plan_and_results(tmp_path, monkeypatch, capsys):
    for k in ["GOOGLE_MAPS_API_KEY", "KAKAO_REST_API_KEY", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"]:
        monkeypatch.delenv(k, raising=False)
    assert main(["소금빵", "--area", "성수동", "--browser-plan", str(tmp_path / "plan")]) == 0
    assert (tmp_path / "plan" / "prompt.md").exists()

    def obs(name, rating, n, kw_taste, kw_mood, tags):
        return {"name": name, "observations": [{
            "site": "naver", "rating": rating, "review_count": n,
            "keywords": {"음식이 맛있어요": kw_taste, "인테리어가 멋져요": kw_mood},
            "wait_tags": tags, "reviews": [f"{name} 소금빵 맛있어요"]}]}

    path = _results(tmp_path, [
        obs("줄서는집", 4.7, 900, 700, 50, {"1시간 이상": 10, "30분 이상": 5}),
        obs("한산한집", 4.5, 400, 250, 150, {"바로 입장": 20}),
        obs("평범한집", 4.0, 300, 80, 20, {"바로 입장": 9, "10분 이내": 1}),
        obs("분위기집", 4.2, 300, 100, 200, {"바로 입장": 12}),
        obs("그냥집", 3.9, 200, 50, 10, {"바로 입장": 5}),
    ])
    capsys.readouterr()
    assert main(["소금빵", "--area", "성수동", "--browser-results", str(path), "--format", "json", "--top", "1"]) == 0
    data = json.loads(capsys.readouterr().out)
    cats = {k: [p["name"] for p in v["places"]] for k, v in data["categories"].items()}
    assert cats["any_taste"] == ["줄서는집"]
    assert cats["low_taste"] == ["한산한집"]
    assert data["categories"]["any_taste"]["places"][0]["waiting"]["level"] == "김"


def test_cli_rejects_bad_results_file(tmp_path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    assert main(["소금빵", "--area", "성수동", "--browser-results", str(bad)]) == 2


def test_naver_api_is_opt_in(monkeypatch, capsys):
    monkeypatch.setenv("NAVER_CLIENT_ID", "x")
    monkeypatch.setenv("NAVER_CLIENT_SECRET", "y")
    for k in ["GOOGLE_MAPS_API_KEY", "KAKAO_REST_API_KEY"]:
        monkeypatch.delenv(k, raising=False)
    # auto에서는 네이버 키가 있어도 쓰지 않는다 → 소스 없음
    assert main(["소금빵", "--area", "성수동"]) == 2


def test_claude_analyzer_skips_naver_api_texts():
    from matjip.llm_analyzer import llm_texts

    p = Place(name="x", texts=[ReviewText("naver_blog", "a"), ReviewText("google_review", "b"),
                               ReviewText("naver_place_review", "c")])
    assert [t.text for t in llm_texts(p)] == ["b", "c"]
    assert PlatformRating  # import used
