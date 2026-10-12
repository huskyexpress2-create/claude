"""브라우저로 읽은 값의 공용 형식.

Playwright 모드와 Claude 브라우징 모드 모두 이 형식의 JSON을 만들고, CLI는 `--browser-results`로 읽는다.

{
  "version": 1,
  "query": {"food": "소금빵", "area": "성수동"},
  "collected_at": "2026-10-12T19:30:00+09:00",
  "collector": "playwright" | "claude",
  "places": [
    {"name": "가게명", "address": "주소", "candidate_id": "c1",
     "observations": [
       {"site": "naver", "url": "...", "rating": 4.52, "rating_scale": 5, "rating_count": 120,
        "review_count": 243, "blog_review_count": 31,
        "keywords": {"음식이 맛있어요": 224, "인테리어가 멋져요": 40}, "keyword_participants": 193,
        "wait_tags": {"바로 입장": 12, "30분 이상": 2},
        "reviews": ["리뷰 본문", "..."],
        "live_waiting_teams": null, "observed_at": ""}
     ]}
  ]
}
값이 화면에 없으면 null/빈 값으로 둔다. 리뷰 작성자 닉네임 같은 개인 정보는 넣지 않는다.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ..models import LiveWaiting, Place, PlatformRating, ReviewText, VoteStats
from .keywords import split_votes

SCHEMA_VERSION = 1
MAX_REVIEWS_PER_SITE = 20
MAX_REVIEW_CHARS = 2000


@dataclass
class SiteObservation:
    site: str
    url: str = ""
    rating: Optional[float] = None
    rating_scale: float = 5.0
    rating_count: Optional[int] = None
    review_count: Optional[int] = None
    blog_review_count: Optional[int] = None
    keywords: dict[str, int] = field(default_factory=dict)
    keyword_participants: Optional[int] = None
    wait_tags: dict[str, int] = field(default_factory=dict)
    reviews: list[str] = field(default_factory=list)
    live_waiting_teams: Optional[int] = None
    observed_at: str = ""

    def is_empty(self) -> bool:
        return (
            self.rating is None
            and not self.review_count
            and not self.keywords
            and not self.wait_tags
            and not self.reviews
            and self.live_waiting_teams is None
        )


@dataclass
class PlaceObservation:
    name: str
    address: str = ""
    candidate_id: str = ""
    observations: list[SiteObservation] = field(default_factory=list)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ---- 느슨한 검증: 외부(사람·LLM·스크립트)가 쓴 파일이라 타입을 하나하나 확인한다 -------------
def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    if isinstance(v, str):
        try:
            f = float(v.replace(",", "").strip())
        except ValueError:
            return None
        return f if math.isfinite(f) else None
    return None


def _int(v: Any) -> Optional[int]:
    f = _num(v)
    return int(f) if f is not None and f >= 0 else None


def _count_map(v: Any) -> dict[str, int]:
    if not isinstance(v, dict):
        return {}
    out: dict[str, int] = {}
    for k, n in v.items():
        c = _int(n)
        if isinstance(k, str) and k.strip() and c is not None:
            out[k.strip()] = c
    return out


def _site_from_dict(d: dict) -> Optional[SiteObservation]:
    site = str(d.get("site") or "").strip().lower()
    if not site:
        return None
    scale = _num(d.get("rating_scale")) or 5.0
    rating = _num(d.get("rating"))
    if rating is not None and not (0 < rating <= scale):
        rating = None
    reviews = [
        str(t).strip()[:MAX_REVIEW_CHARS]
        for t in (d.get("reviews") or [])
        if isinstance(t, str) and t.strip()
    ][:MAX_REVIEWS_PER_SITE]
    return SiteObservation(
        site=site,
        url=str(d.get("url") or ""),
        rating=rating,
        rating_scale=scale,
        rating_count=_int(d.get("rating_count")),
        review_count=_int(d.get("review_count")),
        blog_review_count=_int(d.get("blog_review_count")),
        keywords=_count_map(d.get("keywords")),
        keyword_participants=_int(d.get("keyword_participants")),
        wait_tags=_count_map(d.get("wait_tags")),
        reviews=reviews,
        live_waiting_teams=_int(d.get("live_waiting_teams")),
        observed_at=str(d.get("observed_at") or ""),
    )


def load_results(path: str | Path) -> tuple[dict, list[PlaceObservation]]:
    """결과 파일을 읽는다. 형식이 틀린 항목은 버리고, 메타 정보와 장소 목록을 돌려준다."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("places"), list):
        raise ValueError(f"{path}: 'places' 목록이 없는 파일입니다")
    meta = {k: data.get(k) for k in ("version", "query", "collected_at", "collector")}
    places = []
    for raw in data["places"]:
        if not isinstance(raw, dict) or not str(raw.get("name") or "").strip():
            continue
        obs = [o for d in (raw.get("observations") or []) if isinstance(d, dict) and (o := _site_from_dict(d))]
        places.append(
            PlaceObservation(
                name=str(raw["name"]).strip(),
                address=str(raw.get("address") or "").strip(),
                candidate_id=str(raw.get("candidate_id") or ""),
                observations=[o for o in obs if not o.is_empty()],
            )
        )
    return meta, places


def save_results(path: str | Path, food: str, area: str, collector: str, places: list[PlaceObservation]) -> None:
    data = {
        "version": SCHEMA_VERSION,
        "query": {"food": food, "area": area},
        "collected_at": now_iso(),
        "collector": collector,
        "places": [asdict(p) for p in places],
    }
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ---- Place로 변환 -----------------------------------------------------------------------
def to_place(po: PlaceObservation, collected_at: str = "") -> Place:
    p = Place(name=po.name, address=po.address)
    p.sources.add("browser")
    for o in po.observations:
        if o.url:
            # 네이버 검색 API의 link(업체 홈페이지)와 구분한다.
            p.urls["naver_place" if o.site == "naver" else o.site] = o.url
        if o.rating is not None:
            count = o.rating_count if o.rating_count is not None else (o.review_count or 0)
            p.ratings.append(PlatformRating(o.site, o.rating, count=count, scale=o.rating_scale, url=o.url or None))
        if o.keywords:
            taste, mood = split_votes(o.keywords)
            total = o.review_count or o.keyword_participants or sum(o.keywords.values())
            p.vote_stats[o.site] = VoteStats(taste=taste, mood=mood, total=total)
            p.keyword_counts[o.site] = dict(sorted(o.keywords.items(), key=lambda kv: -kv[1]))
        for tag, n in o.wait_tags.items():
            p.wait_tags[tag] = p.wait_tags.get(tag, 0) + n
        for text in o.reviews:
            p.texts.append(ReviewText(source=f"{o.site}_place_review", text=text, url=o.url or None))
        if o.live_waiting_teams is not None:
            lw = LiveWaiting(o.live_waiting_teams, o.site, o.observed_at or collected_at)
            if p.live_waiting is None or lw.observed_at > p.live_waiting.observed_at:
                p.live_waiting = lw
    return p


def load_places(path: str | Path, food: str = "", area: str = "") -> tuple[list[Place], list[str]]:
    """결과 파일 → Place 목록과 경고 목록."""
    meta, observed = load_results(path)
    warnings = []
    q = meta.get("query") or {}
    if isinstance(q, dict) and food and q.get("food") and q.get("food") != food:
        warnings.append(f"{path}: 수집 당시 메뉴('{q.get('food')}')와 지금 메뉴('{food}')가 다릅니다")
    if isinstance(q, dict) and area and q.get("area") and q.get("area") != area:
        warnings.append(f"{path}: 수집 당시 지역('{q.get('area')}')과 지금 지역('{area}')이 다릅니다")
    collected_at = str(meta.get("collected_at") or "")
    places = [to_place(po, collected_at) for po in observed if po.observations]
    empty = [po.name for po in observed if not po.observations]
    if empty:
        warnings.append(f"{path}: 값이 하나도 없는 장소 {len(empty)}곳은 건너뜀 ({', '.join(empty[:5])})")
    return places, warnings
