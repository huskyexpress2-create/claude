import pytest

from matjip.models import ReviewText
from matjip.text_analysis import analyze_texts, dish_terms_for, split_clauses


def one(text, source="manual", dish=("소금빵",)):
    return analyze_texts([ReviewText(source, text)], list(dish))


@pytest.mark.parametrize(
    "text, taste, mood",
    [
        ("소금빵이 진짜 겉바속촉 맛있어요", (1, 0), (0, 0)),
        ("분위기는 좋은데 맛은 별로였어요", (0, 1), (1, 0)),  # 대조절 분리
        ("맛있지 않았어요. 인테리어는 예뻐요", (0, 1), (1, 0)),  # 장형 부정
        ("안 좋았어요 빵이", (0, 1), (0, 0)),  # 단형 부정
        ("나쁘지 않은 맛", (1, 0), (0, 0)),  # 부정의 부정
        ("뷰 맛집! 커피는 그냥 그래요", (0, 1), (1, 0)),  # '뷰 맛집'은 분위기
        ("진짜 맛있다", (1, 0), (0, 0)),  # '진짜'의 '짜'는 짜다가 아님
        ("너무 짜고 느끼해요", (0, 1), (0, 0)),
        ("매장이 좁고 시끄러워요", (0, 0), (0, 1)),
        ("케이크가 너무 예뻐요", (0, 0), (0, 0)),  # 음식 외형 칭찬은 맛이 아님
        ("비추천합니다 맛이 없어요", (0, 1), (0, 0)),
    ],
)
def test_aspect_polarity(text, taste, mood):
    a = one(text)
    assert (a.taste.positive, a.taste.negative) == taste
    assert (a.mood.positive, a.mood.negative) == mood


@pytest.mark.parametrize(
    "text, long_, short, minutes",
    [
        ("웨이팅 1시간 했어요 그래도 맛은 최고", 1, 0, [60.0]),
        ("줄 서서 40분 기다렸어요", 1, 0, [40.0]),
        ("오픈런 필수입니다", 1, 0, []),
        ("웨이팅 없이 바로 입장했어요", 0, 1, []),
        ("평일엔 웨이팅 거의 없어요", 0, 1, []),
        ("10분 정도 웨이팅 있었어요", 0, 1, []),  # 15분 이하는 짧음
        ("웨이팅 있었는데 금방 빠져요", 0, 0, []),  # 길다·짧다 상쇄
        ("맛있어요", 0, 0, []),
    ],
)
def test_waiting(text, long_, short, minutes):
    w = one(text).waiting
    assert (w.long_weight, w.short_weight) == (long_, short)
    assert w.minutes_mentioned == minutes


def test_waiting_query_texts_excluded_from_rate_but_count_for_direction():
    texts = [
        ReviewText("naver_blog", "소금빵 맛있어요"),
        ReviewText("naver_blog_waiting", "웨이팅 2시간 했어요"),
    ]
    a = analyze_texts(texts, ["소금빵"])
    assert a.waiting.total_weight == pytest.approx(0.6)  # 일반 글 1개만
    assert a.waiting.long_weight == 0
    assert a.waiting.dir_long == pytest.approx(0.6)
    assert a.taste.total_weight == pytest.approx(0.6)


def test_sponsored_text_is_downweighted():
    a = analyze_texts([ReviewText("naver_blog", "소금빵 맛있어요", sponsored=True)], ["소금빵"])
    assert a.taste.positive == pytest.approx(0.6 * 0.3)


def test_dish_mentions_and_terms():
    a = analyze_texts(
        [ReviewText("manual", "소금빵 최고"), ReviewText("manual", "커피 맛있어요")], dish_terms_for("소금빵")
    )
    assert a.dish_mentions == 1
    assert dish_terms_for("평양 냉면") == ["평양", "냉면", "평양냉면"]


def test_split_clauses():
    assert split_clauses("분위기는 좋은데 맛은 별로, 다시 안 가요!") == ["분위기는 좋", "맛은 별로", "다시 안 가요"]
