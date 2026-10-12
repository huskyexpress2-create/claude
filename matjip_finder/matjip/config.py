"""점수 계산 가중치·임계값. 근거가 약한 값(휴리스틱)은 주석에 그렇다고 적어 둔다."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ScoringConfig:
    # 베이지안 평균의 가상 리뷰 수. 리뷰 3개짜리 5.0점이 리뷰 2,000개짜리 4.6점을 이기지 못하게 한다.
    prior_reviews: float = 15.0
    # 평균만 쓰면 리뷰가 적은 곳의 불확실성이 무시된다. 평균 - z*표준오차(보수적 추정)로 순위를 매긴다.
    # rating_sd: 개별 평점의 표준편차(5점 만점 기준 약 0.8점 → 0~1 환산 0.16, 판단값)
    rating_sd: float = 0.16
    rating_lcb_z: float = 1.0
    # 플랫폼 신뢰 가중치 (판단값). 구글은 국내 리뷰 수가 적고 관광객 비중이 높아 조금 낮춘다.
    platform_weights: dict[str, float] = field(
        default_factory=lambda: {
            "kakao": 1.0,
            "naver": 1.0,
            "google": 0.8,
            "catchtable": 1.0,
            "diningcode": 0.8,
        }
    )
    default_platform_weight: float = 0.8

    # 맛 점수 = 평점 신호 / 리뷰 텍스트 맛 신호 / 네이버 '음식이 맛있어요' 비율의 가중 평균
    # 평점은 맛만이 아니라 서비스·가격·웨이팅까지 섞인 '전반 만족도'라서 단독으로 쓰지 않는다.
    taste_weights: dict[str, float] = field(
        default_factory=lambda: {"rating": 0.45, "text": 0.35, "votes": 0.20}
    )
    mood_weights: dict[str, float] = field(default_factory=lambda: {"text": 0.6, "votes": 0.4})
    award_bonus: float = 4.0  # 블루리본·미쉐린 등 1건당 맛 점수 가산 (판단값)
    award_bonus_cap: float = 8.0

    # 측면 긍정률 베이지안 평활: 가상 텍스트 수
    aspect_prior: float = 3.0
    # 언급 빈도(salience) 반영 비율과 기준 빈도. 분위기는 원래 언급이 드물어 기준을 낮게 잡는다.
    salience_weight: float = 0.3
    taste_salience_ref: float = 0.5
    mood_salience_ref: float = 0.3

    # 맛+분위기 = 가중 기하평균. 한쪽만 뛰어난 곳이 상위에 오르지 않도록 산술평균 대신 쓴다.
    combined_taste_weight: float = 0.55
    # '둘 다 좋은 곳'이므로 맛·분위기 각각 이 점수(후보군 백분위) 미만이면 맛+분위기 순위에서 뺀다.
    both_min_score: float = 40.0

    # ---- 웨이팅 추정 (모두 보정되지 않은 휴리스틱 임계값) ----
    # 일반 리뷰 중 '웨이팅 길다' 언급 비율이 이 값 이상이면 텍스트 신호 최대치
    wait_rate_saturation: float = 0.25
    # 언급 비율 계산 시 분모에 더하는 가상 글 수. 리뷰 5개 중 1개 언급이 20%로 과대평가되는 것을 막는다.
    wait_rate_prior: float = 5.0
    # 블로그 '가게명+웨이팅' 건수 / '가게명' 건수 → (ratio - floor) / span 로 0~1 변환
    wait_blog_floor: float = 0.08
    wait_blog_span: float = 0.35
    wait_component_weights: dict[str, float] = field(
        default_factory=lambda: {
            "rate": 0.35, "direction": 0.25, "blog": 0.25, "popularity": 0.15, "minutes": 0.4,
        }
    )
    # 0~1 웨이팅 지수 → 등급 경계
    wait_level_bounds: tuple[float, float, float] = (0.2, 0.4, 0.65)
    low_wait_levels: tuple[str, ...] = ("거의 없음", "짧음")
    low_wait_min_confidence: tuple[str, ...] = ("높음", "중간")

    # 순위에 넣기 위한 최소 근거: 평점 수 합 또는 리뷰 텍스트 수
    min_rating_count: int = 5
    min_texts: int = 3
    # 텍스트가 이만큼 있는데 요청 메뉴 언급이 0이면 관련 없는 가게로 보고 뺀다
    relevance_min_texts: int = 10
