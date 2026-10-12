"""검색 → 병합 → 보강 → 텍스트 분석 → 점수 → 카테고리."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Optional

from .config import ScoringConfig
from .merge import merge_places
from .models import Place, ScoredPlace
from .scoring import categorize, score_places
from .sources import NaverSearchSource, SearchQuery
from .text_analysis import analyze_place


@dataclass
class SearchResult:
    query: SearchQuery
    categories: dict[str, list[ScoredPlace]]
    scored: list[ScoredPlace]
    sources_used: list[str]
    warnings: list[str] = field(default_factory=list)


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def run_search(
    query: SearchQuery,
    discovery_sources: list,
    naver: Optional[NaverSearchSource] = None,
    analyzer=None,
    max_candidates: int = 30,
    top: int = 3,
    cfg: Optional[ScoringConfig] = None,
    dish_filter: bool = True,
) -> SearchResult:
    cfg = cfg or ScoringConfig()
    warnings: list[str] = []
    groups: list[list[Place]] = []
    used: list[str] = []
    for src in discovery_sources:
        try:
            found = src.discover(query)
        except Exception as e:  # 한 소스가 실패해도 나머지로 계속한다
            warnings.append(f"{src.name} 검색 실패: {e}")
            continue
        _log(f"[{src.name}] 후보 {len(found)}곳")
        groups.append(found)
        used.append(src.name)

    places = merge_places(groups)
    # 여러 소스에 동시에 잡힌 곳, 평점 수가 많은 곳을 우선 보강한다(API 호출량 절약).
    places.sort(key=lambda p: (len(p.sources), p.total_rating_count), reverse=True)
    if len(places) > max_candidates:
        warnings.append(f"후보 {len(places)}곳 중 상위 {max_candidates}곳만 분석")
        places = places[:max_candidates]

    if naver is not None:
        for p in places:
            try:
                naver.enrich(p, query.area)
            except Exception as e:
                warnings.append(f"네이버 블로그 보강 실패({p.name}): {e}")
        used.append("naver_blog")

    analyses = [analyze_place(p, query.food) for p in places]
    if analyzer is not None:
        _log(f"[claude] {sum(1 for p in places if p.texts)}곳 리뷰 분석 중…")
        notes = analyzer.refine(places, analyses, query.food)
        warnings.extend(f"{p.name}: {n}" for p, n in zip(places, notes, strict=True) if n)

    scored = score_places(places, analyses, query.food, cfg, dish_filter=dish_filter)
    n_ranked = sum(1 for sp in scored if sp.taste_score is not None)
    if 0 < n_ranked < 5:
        warnings.append(
            f"순위 후보가 {n_ranked}곳뿐이라 점수(후보군 내 백분위)의 해상도가 낮습니다. "
            "'맛+분위기'의 '둘 다 중간 이상' 기준도 거칠게 적용됩니다."
        )
    return SearchResult(
        query=query,
        categories=categorize(scored, top=top, cfg=cfg),
        scored=scored,
        sources_used=used,
        warnings=warnings,
    )
