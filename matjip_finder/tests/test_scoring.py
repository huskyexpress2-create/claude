import pytest

from matjip.config import ScoringConfig
from matjip.models import Place, PlatformRating, ReviewText, TextAnalysis
from matjip.scoring import (
    categorize,
    estimate_waiting,
    is_low_wait,
    minutes_to_index,
    percentile_ranks,
    rating_signal,
    score_places,
)
from matjip.text_analysis import analyze_place


def place(name, kakao=None, google=None, texts=(), **kw):
    p = Place(name=name, **kw)
    p.sources.add("test")
    if kakao:
        p.ratings.append(PlatformRating("kakao", kakao[0], kakao[1]))
    if google:
        p.ratings.append(PlatformRating("google", google[0], google[1]))
    p.texts = [ReviewText("manual", t) for t in texts]
    return p


def test_percentile_ranks_ties():
    assert percentile_ranks({"a": 1, "b": 2, "c": 2}) == {"a": 0.5 / 3, "b": 2 / 3, "c": 2 / 3}


def test_few_perfect_reviews_do_not_beat_many_good_reviews():
    ps = [
        place("신상", kakao=(5.0, 4)),
        place("동네빵집", kakao=(4.5, 420)),
        place("평범", kakao=(4.0, 300)),
    ]
    r = rating_signal(ps, ScoringConfig())
    assert r[1] > r[0] > r[2]


def test_platform_scale_differences_are_normalized_by_percentile():
    # 같은 순서라면 플랫폼 원점수 차이(구글이 카카오보다 후함)는 결과에 영향이 없어야 한다.
    ps = [place("A", kakao=(4.2, 500), google=(4.7, 500)), place("B", kakao=(3.8, 500), google=(4.4, 500))]
    r = rating_signal(ps, ScoringConfig())
    assert r[0] == pytest.approx(0.75)
    assert r[1] == pytest.approx(0.25)


@pytest.mark.parametrize("m, level", [(0, "거의 없음"), (10, "짧음"), (25, "보통"), (60, "김")])
def test_minutes_to_level(m, level):
    p = Place(name="x", waiting_minutes=m)
    we = estimate_waiting(p, TextAnalysis(), None, ScoringConfig())
    assert we.level == level and we.confidence == "높음"


def test_minutes_to_index_boundaries():
    assert minutes_to_index(15) == pytest.approx(0.4)
    assert minutes_to_index(40) == pytest.approx(0.65)
    assert minutes_to_index(500) == 1.0


def test_waiting_without_evidence_is_unknown():
    p = Place(name="x")
    we = estimate_waiting(p, TextAnalysis(), 0.9, ScoringConfig())
    assert we.level == "판단불가"


def _scored(ps, food="소금빵", **kw):
    return score_places(ps, [analyze_place(p, food) for p in ps], food, **kw)


def test_categories_respect_low_wait_and_both_good():
    ps = [
        place(
            "줄서는집", kakao=(4.7, 2000),
            texts=["소금빵 진짜 맛있어요", "웨이팅 1시간 했어요", "오픈런 필수", "줄 서서 50분 기다렸어요", "매장이 좁고 시끄러워요"],
        ),
        place(
            "한산한집", kakao=(4.5, 500),
            texts=["소금빵 맛있어요", "웨이팅 없이 바로 입장", "한산해요", "인테리어 아늑하고 예뻐요", "분위기 좋아요"],
        ),
        place(
            "분위기만", kakao=(4.0, 500),
            texts=["소금빵 별로예요", "대기 없이 들어갔어요", "뷰 맛집 분위기 최고", "인테리어 세련됐어요", "자리 넉넉해요"],
        ),
    ]
    scored = _scored(ps)
    cats = categorize(scored, top=3)
    names = {k: [sp.place.name for sp in v] for k, v in cats.items()}
    assert names["any_taste"][0] == "줄서는집"
    assert "줄서는집" not in names["low_taste"]
    assert names["low_taste"][0] == "한산한집"
    # 맛 점수가 낮은 '분위기만'은 맛+분위기 순위에 들어가지 않는다.
    assert "분위기만" not in names["any_both"]
    assert names["low_both"] == ["한산한집"]
    by_name = {sp.place.name: sp for sp in scored}
    assert by_name["줄서는집"].waiting_level == "김"
    assert is_low_wait(by_name["한산한집"])


def test_irrelevant_place_is_excluded_by_dish_filter():
    texts = ["파스타 맛있어요"] * 10
    ps = [place("파스타집", kakao=(4.5, 100), texts=texts), place("빵집", kakao=(4.0, 100), texts=["소금빵 맛있어요"])]
    names = [sp.place.name for sp in _scored(ps) if sp.taste_score is not None]
    assert names == ["빵집"]
    names = [sp.place.name for sp in _scored(ps, dish_filter=False) if sp.taste_score is not None]
    assert set(names) == {"파스타집", "빵집"}


def test_generic_food_word_skips_dish_filter():
    ps = [place("케이크집", kakao=(4.5, 100), texts=["케이크 맛있어요"] * 10)]
    assert _scored(ps, food="디저트")[0].taste_score is not None


def test_place_without_evidence_is_excluded():
    scored = _scored([place("빈집", kakao=(5.0, 1))])
    assert scored[0].taste_score is None
    assert "근거 부족" in scored[0].notes[0]
