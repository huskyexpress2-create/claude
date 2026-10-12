"""결과 출력: 텍스트(터미널) / 마크다운 / JSON."""

from __future__ import annotations

import json
from typing import Optional

from .models import ScoredPlace
from .pipeline import SearchResult
from .scoring import CATEGORY_TITLES

PLATFORM_LABELS = {
    "google": "구글",
    "kakao": "카카오",
    "naver": "네이버",
    "catchtable": "캐치테이블",
    "diningcode": "다이닝코드",
    "tabling": "테이블링",
    "manual": "직접 입력",
}

CAVEATS = [
    "점수는 이번 검색 후보군 안에서의 상대 순위(0~100)입니다. 절대적인 맛 점수가 아닙니다.",
    "웨이팅은 리뷰·블로그 언급으로 추정한 값입니다. 요일·시간대에 따라 크게 다르므로 방문 전 확인하세요.",
    "카카오맵·네이버 플레이스 별점·키워드·대기시간 태그는 공식 API가 없습니다."
    " 브라우저 모드(--browser) 결과나 --manual CSV로만 들어옵니다.",
    "블로그에는 체험단·협찬 글이 섞여 있습니다. 요약문에서 협찬 표기가 보이는 글만 가중치를 낮췄습니다.",
]


def _fmt(v: Optional[float]) -> str:
    return "-" if v is None else f"{v:.0f}"


def _ratings_line(sp: ScoredPlace) -> str:
    parts = []
    for r in sp.place.ratings:
        label = PLATFORM_LABELS.get(r.platform, r.platform)
        scale = "" if r.scale == 5.0 else f"/{r.scale:g}"
        parts.append(f"{label} {r.rating:g}{scale}({r.count:,})")
    return " · ".join(parts) if parts else "평점 데이터 없음"


def _place_block(rank: int, sp: ScoredPlace, md: bool) -> list[str]:
    p = sp.place
    head = f"{rank}. {p.name}"
    if md:
        head = f"{rank}. **{p.name}**"
    lines = [
        head + (f" — {p.address}" if p.address else ""),
        f"   맛 {_fmt(sp.taste_score)} · 분위기 {_fmt(sp.mood_score)} · 맛+분위기 {_fmt(sp.combined_score)}"
        f" · 웨이팅 {sp.waiting_level}(신뢰도 {sp.waiting_confidence}) · 근거량 {sp.confidence}",
        f"   평점: {_ratings_line(sp)}",
    ]
    if p.awards:
        lines.append(f"   수상/가이드: {', '.join(p.awards)}")
    for plat, vs in p.vote_stats.items():
        label = PLATFORM_LABELS.get(plat, plat)
        lines.append(f"   {label} 키워드: 맛 {vs.taste:,} · 분위기 {vs.mood:,} / 기준 {vs.total:,}")
    if p.live_waiting is not None:
        lw = p.live_waiting
        when = f", {lw.observed_at} 기준" if lw.observed_at else ""
        lines.append(f"   실시간 대기: {lw.teams}팀 ({PLATFORM_LABELS.get(lw.source, lw.source)}{when})")
    if p.wait_tags:
        tags = ", ".join(f"{t} {n}" for t, n in sorted(p.wait_tags.items(), key=lambda kv: -kv[1]))
        lines.append(f"   리뷰 대기시간 태그: {tags}")
    ev = sp.analysis.taste.evidence[:2] + sp.analysis.mood.evidence[:1] + sp.analysis.waiting.evidence[:1]
    for e in dict.fromkeys(ev):  # 같은 글이 맛·분위기 근거로 중복될 수 있다
        lines.append(f"   > {e}")
    for key in ("naver_place", "kakao", "naver", "google", "manual"):
        if p.urls.get(key):
            lines.append(f"   {p.urls[key]}")
            break
    return lines


def render_text(res: SearchResult, md: bool = False) -> str:
    q = res.query
    out = []
    title = f"'{q.area} {q.food}' 추천 결과"
    out.append(f"# {title}" if md else f"=== {title} ===")
    ranked = [sp for sp in res.scored if sp.taste_score is not None]
    out.append(
        f"데이터: {', '.join(res.sources_used) or '없음'} · 분석 후보 {len(ranked)}곳"
        f" (제외 {len(res.scored) - len(ranked)}곳)"
    )
    for key, title in CATEGORY_TITLES.items():
        out.append("")
        out.append(f"## {title}" if md else f"[{title}]")
        picks = res.categories.get(key, [])
        if not picks:
            if key.startswith("low"):
                out.append("   조건을 만족하는 곳이 없습니다 (웨이팅이 적다고 판단할 근거가 충분한 후보 없음).")
            else:
                out.append("   조건을 만족하는 곳이 없습니다 (맛·분위기 모두 후보군 중간 이상인 곳 없음).")
            continue
        for i, sp in enumerate(picks, 1):
            out.extend(_place_block(i, sp, md))
    if res.warnings:
        out.append("")
        out.append("## 경고" if md else "[경고]")
        out.extend(f"- {w}" for w in res.warnings)
    out.append("")
    out.append("## 해석 시 주의" if md else "[해석 시 주의]")
    out.extend(f"- {c}" for c in CAVEATS)
    return "\n".join(out)


def _sp_dict(sp: ScoredPlace) -> dict:
    p = sp.place
    return {
        "name": p.name,
        "address": p.address,
        "lat": p.lat,
        "lng": p.lng,
        "sources": sorted(p.sources),
        "urls": p.urls,
        "ratings": [
            {"platform": r.platform, "rating": r.rating, "scale": r.scale, "count": r.count} for r in p.ratings
        ],
        "awards": p.awards,
        "keyword_votes": {
            plat: {"taste": vs.taste, "mood": vs.mood, "total": vs.total} for plat, vs in p.vote_stats.items()
        },
        "keyword_counts": p.keyword_counts,
        "wait_tags": p.wait_tags,
        "live_waiting": None
        if p.live_waiting is None
        else {"teams": p.live_waiting.teams, "source": p.live_waiting.source, "observed_at": p.live_waiting.observed_at},
        "scores": {
            "rating": sp.rating_score,
            "taste": sp.taste_score,
            "mood": sp.mood_score,
            "taste_and_mood": sp.combined_score,
        },
        "waiting": {"index": sp.waiting_index, "level": sp.waiting_level, "confidence": sp.waiting_confidence},
        "confidence": sp.confidence,
        "dish_relevance": sp.dish_relevance,
        "n_texts": sp.analysis.n_texts,
        "evidence": {
            "taste": sp.analysis.taste.evidence,
            "mood": sp.analysis.mood.evidence,
            "waiting": sp.analysis.waiting.evidence,
        },
        "notes": sp.notes,
    }


def render_json(res: SearchResult) -> str:
    return json.dumps(
        {
            "query": {"food": res.query.food, "area": res.query.area},
            "sources_used": res.sources_used,
            "categories": {
                k: {"title": CATEGORY_TITLES[k], "places": [_sp_dict(sp) for sp in v]}
                for k, v in res.categories.items()
            },
            "all_candidates": [_sp_dict(sp) for sp in res.scored],
            "warnings": res.warnings,
            "caveats": CAVEATS,
        },
        ensure_ascii=False,
        indent=2,
    )
