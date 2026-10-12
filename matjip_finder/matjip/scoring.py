"""후보 장소들의 맛·분위기·웨이팅 점수를 계산하고 4개 카테고리로 순위를 매긴다.

점수는 '이번 검색 후보군 안에서의 상대 위치'(백분위)를 기본으로 한다.
플랫폼마다 평점 분포가 달라서(예: 같은 가게라도 구글 4.5 / 카카오 3.9) 원점수를 그대로
평균하면 안 되기 때문이다. 따라서 "후보군 전체가 별로인 동네"에서도 1등은 나온다.
웨이팅만은 절대 기준(등급)으로 판정한다.
"""

from __future__ import annotations

import math
import re
import statistics
from dataclasses import dataclass
from typing import Callable, Optional, Sequence, TypeVar

from .config import ScoringConfig
from .models import AspectResult, Place, ScoredPlace, TextAnalysis

K = TypeVar("K")

GENERIC_FOOD_WORDS = {
    "디저트", "카페", "맛집", "음식", "빵", "베이커리", "브런치", "한식", "양식", "중식", "일식",
    "식당", "레스토랑", "술집", "이자카야", "커피", "점심", "저녁", "데이트",
}
_LLM_WAIT_INDEX = {"none": 0.05, "short": 0.28, "moderate": 0.5, "long": 0.85}
_CONF_RANK = {"높음": 2, "중간": 1, "낮음": 0}


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def percentile_ranks(values: dict[K, float]) -> dict[K, float]:
    """동점은 평균 순위. 결과는 (0,1) 구간: (순위-0.5)/n."""
    if not values:
        return {}
    items = sorted(values.items(), key=lambda kv: kv[1])
    n = len(items)
    out: dict[K, float] = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and items[j + 1][1] == items[i][1]:
            j += 1
        avg_rank = (i + j) / 2 + 1
        for k in range(i, j + 1):
            out[items[k][0]] = (avg_rank - 0.5) / n
        i = j + 1
    return out


def bayesian_mean(mean: float, count: int, prior_mean: float, prior_n: float) -> float:
    return (count * mean + prior_n * prior_mean) / (count + prior_n)


def weighted_mean(parts: dict[str, Optional[float]], weights: dict[str, float]) -> Optional[float]:
    num = den = 0.0
    for k, v in parts.items():
        if v is None:
            continue
        w = weights.get(k, 0.0)
        num += w * v
        den += w
    return num / den if den > 0 else None


# ---- 평점 신호 ----------------------------------------------------------------
def rating_signal(places: Sequence[Place], cfg: ScoringConfig) -> list[Optional[float]]:
    """플랫폼별로 베이지안 평균의 보수적 하한 → 플랫폼 내 백분위 → 신뢰 가중 평균 (0~1)."""
    platforms = sorted({r.platform for p in places for r in p.ratings})
    num = [0.0] * len(places)
    den = [0.0] * len(places)
    for plat in platforms:
        entries = {i: r for i, p in enumerate(places) if (r := p.rating_for(plat)) is not None}
        mu = statistics.fmean(r.normalized for r in entries.values())
        conservative = {
            i: bayesian_mean(r.normalized, r.count, mu, cfg.prior_reviews)
            - cfg.rating_lcb_z * cfg.rating_sd / math.sqrt(r.count + cfg.prior_reviews)
            for i, r in entries.items()
        }
        pct = percentile_ranks(conservative)
        pw = cfg.platform_weights.get(plat, cfg.default_platform_weight)
        for i, r in entries.items():
            # 평점 수가 많을수록 그 플랫폼 판정을 더 믿는다. 수동 입력에서 count를 비우면 0.5로 둔다.
            w = pw * max(math.log1p(r.count), 0.5)
            num[i] += w * pct[i]
            den[i] += w
    return [num[i] / den[i] if den[i] > 0 else None for i in range(len(places))]


# ---- 텍스트 측면 신호 -------------------------------------------------------------
def aspect_raw(ar: AspectResult, prior_mu: float, cfg: ScoringConfig, salience_ref: float) -> Optional[float]:
    if ar.llm_score is not None:
        return ar.llm_score
    if ar.total_weight <= 0:
        return None
    positivity = (ar.positive + cfg.aspect_prior * prior_mu) / (ar.mentions + cfg.aspect_prior)
    # 분모에 가상 텍스트를 더해 리뷰 1개짜리 가게의 언급 빈도가 100%로 잡히지 않게 한다.
    salience = clamp01(ar.positive / (ar.total_weight + cfg.aspect_prior) / salience_ref)
    return (1 - cfg.salience_weight) * positivity + cfg.salience_weight * salience


def _pool_positivity(results: Sequence[AspectResult]) -> float:
    pos = sum(r.positive for r in results)
    tot = sum(r.mentions for r in results)
    return pos / tot if tot > 0 else 0.5


def _vote_rate(place: Place, key: str) -> Optional[float]:
    """플랫폼별 득표율("음식이 맛있어요" 득표 / 리뷰 수)의 평균. 분모가 플랫폼마다 달라 합산하지 않는다."""
    rates = [r for vs in place.vote_stats.values() if (r := vs.rate(key)) is not None]
    return statistics.fmean(rates) if rates else None


# ---- 웨이팅 ---------------------------------------------------------------------
@dataclass
class WaitingEstimate:
    index: Optional[float]
    level: str
    confidence: str
    basis: list[str]


def estimate_waiting(
    place: Place, analysis: TextAnalysis, popularity_pct: Optional[float], cfg: ScoringConfig
) -> WaitingEstimate:
    if place.waiting_minutes is not None:
        idx = minutes_to_index(place.waiting_minutes, cfg)
        return WaitingEstimate(idx, _wait_level(idx, cfg), "높음", [f"직접 입력 {place.waiting_minutes:.0f}분"])

    w = analysis.waiting
    comps: dict[str, Optional[float]] = {}
    weights = dict(cfg.wait_component_weights)
    basis: list[str] = []
    if place.live_waiting is not None:
        lw = place.live_waiting
        comps["live"] = live_teams_to_index(lw.teams)
        when = f" ({lw.observed_at} 기준)" if lw.observed_at else ""
        basis.append(f"실시간 대기 {lw.teams}팀{when}, 출처 {lw.source}")
    tag_mean, n_tags = wait_tag_minutes(place.wait_tags)
    if tag_mean is not None:
        comps["tags"] = minutes_to_index(tag_mean, cfg)
        # 태그 수가 적으면 한두 건에 휘둘리므로 가중치를 줄인다.
        weights["tags"] = cfg.wait_tag_weight * n_tags / (n_tags + cfg.wait_tag_prior)
        long_n = sum(n for t, n in place.wait_tags.items() if (m := tag_to_minutes(t)) is not None and m >= 30)
        basis.append(
            f"방문자 리뷰 대기시간 태그 {n_tags}건: 평균 약 {tag_mean:.0f}분, 30분 이상 {long_n / n_tags:.0%}"
        )
    if w.llm_level in _LLM_WAIT_INDEX:
        comps["rate"] = comps["direction"] = _LLM_WAIT_INDEX[w.llm_level]
        basis.append(f"LLM 판정 {w.llm_level}")
    else:
        if w.total_weight >= 1:
            rate = (w.long_weight - 0.5 * w.short_weight) / (w.total_weight + cfg.wait_rate_prior)
            comps["rate"] = clamp01(rate / cfg.wait_rate_saturation)
            basis.append(f"리뷰 중 긴 웨이팅 언급 {w.long_weight / w.total_weight:.0%}")
        if w.dir_long + w.dir_short >= 1:
            comps["direction"] = (w.dir_long + 0.5) / (w.dir_long + w.dir_short + 1)
            basis.append(f"웨이팅 언급 중 '길다' {w.dir_long:.1f} : '짧다/없다' {w.dir_short:.1f}")
    if w.minutes_mentioned:
        med = statistics.median(w.minutes_mentioned)
        comps["minutes"] = minutes_to_index(med, cfg)
        basis.append(f"언급된 대기시간 중앙값 {med:.0f}분")
    if place.blog_total and place.blog_total >= 20 and place.blog_waiting_total is not None:
        ratio = min(1.0, place.blog_waiting_total / place.blog_total)
        comps["blog"] = clamp01((ratio - cfg.wait_blog_floor) / cfg.wait_blog_span)
        basis.append(f"블로그 '웨이팅' 동시 언급 비율 {ratio:.0%}")

    if not comps:
        return WaitingEstimate(None, "판단불가", "낮음", ["웨이팅 근거 없음"])
    if popularity_pct is not None:
        comps["popularity"] = popularity_pct

    idx = weighted_mean(comps, weights)
    assert idx is not None

    mentions = w.dir_long + w.dir_short
    has_blog = "blog" in comps
    if "live" in comps or n_tags >= 20 or (mentions >= 4 and has_blog):
        conf = "높음"
    elif (
        n_tags >= 8
        or mentions >= 2
        or (has_blog and (place.blog_total or 0) >= 50)
        or w.llm_level in _LLM_WAIT_INDEX
    ):
        conf = "중간"
    else:
        conf = "낮음"
    return WaitingEstimate(idx, _wait_level(idx, cfg), conf, basis)


# 네이버 방문자 리뷰 '대기 시간' 태그 → 대표 분. 2026년 관측값 기준 (공식 목록은 공개되지 않음).
WAIT_TAG_MINUTES = {
    "바로 입장": 0.0,
    "10분 이내": 5.0,
    "30분 이내": 20.0,
    "30분 이상": 45.0,
    "1시간 이내": 40.0,
    "1시간 이상": 80.0,
    "2시간 이상": 140.0,
}
_TAG_RE = re.compile(r"(\d+)\s*(분|시간)\s*(이내|이상)")


def tag_to_minutes(tag: str) -> Optional[float]:
    tag = re.sub(r"\s+", " ", tag.strip())
    if tag in WAIT_TAG_MINUTES:
        return WAIT_TAG_MINUTES[tag]
    m = _TAG_RE.search(tag)
    if not m:
        return None
    v = float(m.group(1)) * (60 if m.group(2) == "시간" else 1)
    return v * 0.6 if m.group(3) == "이내" else v * 1.4


def wait_tag_minutes(tags: dict[str, int]) -> tuple[Optional[float], int]:
    """태그 분포의 평균 대기 분과 유효 태그 수."""
    total = n = 0.0
    for tag, count in tags.items():
        m = tag_to_minutes(tag)
        if m is None or count <= 0:
            continue
        total += m * count
        n += count
    return (total / n if n else None), int(n)


def live_teams_to_index(teams: int) -> float:
    """실시간 대기 팀 수 → 웨이팅 지수. 0팀=0.05, 5팀≈0.55(보통), 7팀 이상≈김 (판단값)."""
    if teams <= 0:
        return 0.05
    return min(1.0, 0.25 + 0.06 * teams)


def minutes_to_index(m: float, cfg: Optional[ScoringConfig] = None) -> float:
    """대기 분 → 웨이팅 지수. 15분=짧음/보통 경계, 40분=보통/김 경계에 맞춘 구간 선형 변환."""
    a, b, c = (cfg or ScoringConfig()).wait_level_bounds
    if m <= 0:
        return 0.0
    if m <= 15:
        return b * m / 15
    if m <= 40:
        return b + (c - b) * (m - 15) / 25
    return min(1.0, c + (1 - c) * (m - 40) / 80)


def _wait_level(idx: float, cfg: ScoringConfig) -> str:
    a, b, c = cfg.wait_level_bounds
    if idx < a:
        return "거의 없음"
    if idx < b:
        return "짧음"
    if idx < c:
        return "보통"
    return "김"


# ---- 종합 -----------------------------------------------------------------------
def _overall_confidence(place: Place, analysis: TextAnalysis) -> str:
    n_r, n_t = place.total_rating_count, analysis.n_texts
    if n_r >= 300 and n_t >= 15:
        return "높음"
    if n_r >= 50 or n_t >= 8:
        return "중간"
    return "낮음"


def score_places(
    places: Sequence[Place],
    analyses: Sequence[TextAnalysis],
    food: str,
    cfg: Optional[ScoringConfig] = None,
    dish_filter: bool = True,
) -> list[ScoredPlace]:
    cfg = cfg or ScoringConfig()
    dish_filter = dish_filter and food.replace(" ", "") not in GENERIC_FOOD_WORDS

    # 근거 부족·메뉴 무관 후보 제외
    scored: list[ScoredPlace] = []
    excluded: list[ScoredPlace] = []
    for p, a in zip(places, analyses, strict=True):
        sp = ScoredPlace(place=p, analysis=a)
        if a.n_texts:
            sp.dish_relevance = a.dish_mentions / a.n_texts
        if p.total_rating_count < cfg.min_rating_count and a.n_texts < cfg.min_texts and not p.vote_stats:
            sp.notes.append("근거 부족(평점·리뷰가 너무 적음)으로 순위 제외")
            excluded.append(sp)
        elif dish_filter and "manual" not in p.sources and a.n_texts >= cfg.relevance_min_texts and a.dish_mentions == 0:
            sp.notes.append(f"리뷰 {a.n_texts}건 중 '{food}' 언급이 없어 순위 제외")
            excluded.append(sp)
        else:
            scored.append(sp)
    if not scored:
        return excluded
    ps = [sp.place for sp in scored]
    an = [sp.analysis for sp in scored]

    rating = rating_signal(ps, cfg)
    taste_mu = _pool_positivity([a.taste for a in an])
    mood_mu = _pool_positivity([a.mood for a in an])
    taste_text = {i: v for i, a in enumerate(an) if (v := aspect_raw(a.taste, taste_mu, cfg, cfg.taste_salience_ref)) is not None}
    mood_text = {
        i: v
        for i, a in enumerate(an)
        if (a.mood.mentions > 0 or a.mood.llm_score is not None)
        and (v := aspect_raw(a.mood, mood_mu, cfg, cfg.mood_salience_ref)) is not None
    }
    taste_votes = {i: v for i, p in enumerate(ps) if (v := _vote_rate(p, "taste")) is not None}
    mood_votes = {i: v for i, p in enumerate(ps) if (v := _vote_rate(p, "mood")) is not None}
    popularity = {
        i: math.log1p(p.total_rating_count + (p.blog_total or 0))
        for i, p in enumerate(ps)
        if p.total_rating_count or p.blog_total
    }

    tt_pct = percentile_ranks(taste_text)
    mt_pct = percentile_ranks(mood_text)
    tv_pct = percentile_ranks(taste_votes)
    mv_pct = percentile_ranks(mood_votes)
    pop_pct = percentile_ranks(popularity)

    for i, sp in enumerate(scored):
        p = sp.place
        sp.rating_score = None if rating[i] is None else 100 * rating[i]
        taste = weighted_mean(
            {"rating": rating[i], "text": tt_pct.get(i), "votes": tv_pct.get(i)}, cfg.taste_weights
        )
        if taste is not None:
            bonus = min(cfg.award_bonus * len(p.awards), cfg.award_bonus_cap)
            sp.taste_score = min(100.0, 100 * taste + bonus)
        mood = weighted_mean({"text": mt_pct.get(i), "votes": mv_pct.get(i)}, cfg.mood_weights)
        if mood is not None:
            sp.mood_score = 100 * mood
        if sp.taste_score is not None and sp.mood_score is not None:
            t = max(sp.taste_score, 1.0) / 100
            m = max(sp.mood_score, 1.0) / 100
            wt = cfg.combined_taste_weight
            sp.combined_score = 100 * math.exp(wt * math.log(t) + (1 - wt) * math.log(m))

        we = estimate_waiting(p, sp.analysis, pop_pct.get(i), cfg)
        sp.waiting_index, sp.waiting_level, sp.waiting_confidence = we.index, we.level, we.confidence
        sp.notes.extend(we.basis)
        sp.confidence = _overall_confidence(p, sp.analysis)
        if rating[i] is None:
            sp.notes.append("평점 데이터 없음: 맛 점수가 리뷰 텍스트에만 의존")
        if sp.mood_score is None:
            sp.notes.append("분위기 근거 없음: 맛+분위기 순위에서 제외")
    return scored + excluded


# ---- 카테고리 -------------------------------------------------------------------
def is_low_wait(sp: ScoredPlace, cfg: Optional[ScoringConfig] = None) -> bool:
    cfg = cfg or ScoringConfig()
    return sp.waiting_level in cfg.low_wait_levels and sp.waiting_confidence in cfg.low_wait_min_confidence


def _rank(
    scored: Sequence[ScoredPlace],
    key: Callable[[ScoredPlace], Optional[float]],
    keep: Callable[[ScoredPlace], bool],
    top: int,
) -> list[ScoredPlace]:
    cands = [sp for sp in scored if key(sp) is not None and keep(sp)]
    cands.sort(
        key=lambda sp: (key(sp), _CONF_RANK[sp.confidence], sp.place.total_rating_count),
        reverse=True,
    )
    return cands[:top]


CATEGORY_TITLES = {
    "any_taste": "웨이팅 무관 · 맛 최우선",
    "any_both": "웨이팅 무관 · 맛+분위기",
    "low_taste": "웨이팅 적음/없음 · 맛 최우선",
    "low_both": "웨이팅 적음/없음 · 맛+분위기",
}


def categorize(scored: Sequence[ScoredPlace], top: int = 3, cfg: Optional[ScoringConfig] = None) -> dict[str, list[ScoredPlace]]:
    cfg = cfg or ScoringConfig()
    ranked = [sp for sp in scored if sp.taste_score is not None]
    everyone = lambda sp: True  # noqa: E731
    low = lambda sp: is_low_wait(sp, cfg)  # noqa: E731
    taste = lambda sp: sp.taste_score  # noqa: E731
    both = lambda sp: sp.combined_score  # noqa: E731
    good_both = lambda sp: (  # noqa: E731
        (sp.taste_score or 0) >= cfg.both_min_score and (sp.mood_score or 0) >= cfg.both_min_score
    )
    return {
        "any_taste": _rank(ranked, taste, everyone, top),
        "any_both": _rank(ranked, both, good_both, top),
        "low_taste": _rank(ranked, taste, low, top),
        "low_both": _rank(ranked, both, lambda sp: low(sp) and good_both(sp), top),
    }
