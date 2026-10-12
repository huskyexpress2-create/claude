"""파이프라인 전체에서 쓰는 데이터 구조."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# 플랫폼별 기본 만점. 수동 CSV에서 `<platform>_scale` 컬럼으로 덮어쓸 수 있다.
DEFAULT_SCALES = {
    "diningcode": 100.0,
}


@dataclass
class PlatformRating:
    platform: str
    rating: float
    count: int = 0
    scale: float = 5.0
    url: Optional[str] = None

    @property
    def normalized(self) -> float:
        """0~1 범위로 환산한 평점."""
        return self.rating / self.scale if self.scale else 0.0


@dataclass
class ReviewText:
    source: str  # "google_review" | "naver_blog" | "naver_blog_waiting" | "manual"
    text: str
    rating: Optional[float] = None
    date: Optional[str] = None
    url: Optional[str] = None
    sponsored: bool = False


@dataclass
class Place:
    name: str
    address: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    category: str = ""
    ids: dict[str, str] = field(default_factory=dict)
    urls: dict[str, str] = field(default_factory=dict)
    ratings: list[PlatformRating] = field(default_factory=list)
    texts: list[ReviewText] = field(default_factory=list)
    # 네이버 블로그 검색 결과 총 건수: "<지역> <가게명>" / "<지역> <가게명> 웨이팅"
    blog_total: Optional[int] = None
    blog_waiting_total: Optional[int] = None
    # 네이버 키워드 리뷰 등 투표형 지표 (수동 입력): taste_votes, mood_votes, keyword_review_total
    keyword_votes: dict[str, int] = field(default_factory=dict)
    waiting_minutes: Optional[float] = None  # 사용자가 직접 확인한 평균 웨이팅(분)
    reservable: Optional[bool] = None
    awards: list[str] = field(default_factory=list)
    sources: set[str] = field(default_factory=set)

    @property
    def total_rating_count(self) -> int:
        return sum(r.count for r in self.ratings)

    def rating_for(self, platform: str) -> Optional[PlatformRating]:
        for r in self.ratings:
            if r.platform == platform:
                return r
        return None


@dataclass
class AspectResult:
    """한 장소의 리뷰 텍스트에서 뽑은 측면(맛/분위기) 분석 결과."""

    positive: float = 0.0  # 가중 긍정 텍스트 수
    negative: float = 0.0  # 가중 부정 텍스트 수
    total_weight: float = 0.0  # 분석 대상 텍스트 가중치 합
    llm_score: Optional[float] = None  # LLM 분석기 사용 시 0~1 점수
    evidence: list[str] = field(default_factory=list)

    @property
    def mentions(self) -> float:
        return self.positive + self.negative


@dataclass
class WaitingResult:
    long_weight: float = 0.0  # 일반 글 중 "웨이팅 길다" 근거 가중치 (언급 비율 계산용)
    short_weight: float = 0.0  # 일반 글 중 "웨이팅 없다/짧다" 근거 가중치
    total_weight: float = 0.0  # 일반 글 가중치 합 (웨이팅 검색어로 모은 글 제외)
    dir_long: float = 0.0  # 웨이팅 검색 글까지 포함한 "길다" 가중치 (방향 판단용)
    dir_short: float = 0.0  # 웨이팅 검색 글까지 포함한 "짧다" 가중치
    minutes_mentioned: list[float] = field(default_factory=list)
    llm_level: Optional[str] = None  # none | short | moderate | long | unknown
    evidence: list[str] = field(default_factory=list)


@dataclass
class TextAnalysis:
    taste: AspectResult = field(default_factory=AspectResult)
    mood: AspectResult = field(default_factory=AspectResult)
    waiting: WaitingResult = field(default_factory=WaitingResult)
    dish_mentions: int = 0
    n_texts: int = 0


@dataclass
class ScoredPlace:
    place: Place
    analysis: TextAnalysis
    rating_score: Optional[float] = None  # 0~100, 후보군 내 백분위
    taste_score: Optional[float] = None  # 0~100
    mood_score: Optional[float] = None  # 0~100
    combined_score: Optional[float] = None  # 맛+분위기, 0~100
    waiting_index: Optional[float] = None  # 0(없음) ~ 1(김)
    waiting_level: str = "판단불가"
    waiting_confidence: str = "낮음"
    confidence: str = "낮음"  # 전체 근거량 기반 신뢰도
    dish_relevance: Optional[float] = None
    notes: list[str] = field(default_factory=list)
