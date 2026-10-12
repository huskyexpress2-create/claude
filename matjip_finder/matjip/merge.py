"""여러 소스에서 온 같은 가게를 하나로 합친다 (이름 유사도 + 좌표 거리)."""

from __future__ import annotations

import math
import re
from difflib import SequenceMatcher
from typing import Iterable, Optional

from .models import Place

# 이름 정규화 전에 지우는 흔한 접두어. "카페 어니언" == "어니언"
_PREFIXES = ("카페", "cafe", "coffee", "커피")


def norm_name(s: str) -> str:
    s = s.lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)
    s = re.sub(r"[^0-9a-z가-힣]", "", s)
    for pre in _PREFIXES:
        if s.startswith(pre) and len(s) > len(pre) + 1:
            s = s[len(pre):]
            break
    return s


def name_similarity(a: str, b: str) -> float:
    na, nb = norm_name(a), norm_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    short, long_ = sorted((na, nb), key=len)
    # 지점명만 다른 경우: "런던베이글뮤지엄" ⊂ "런던베이글뮤지엄안국점"
    if len(short) >= 3 and short in long_:
        return 0.9
    return SequenceMatcher(None, na, nb).ratio()


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def is_same_place(a: Place, b: Place) -> bool:
    sim = name_similarity(a.name, b.name)
    if None not in (a.lat, a.lng, b.lat, b.lng):
        d = haversine_m(a.lat, a.lng, b.lat, b.lng)  # type: ignore[arg-type]
        if d <= 30 and sim >= 0.45:
            return True
        return d <= 150 and sim >= 0.6
    # 좌표가 없으면 이름이 거의 같아야 한다.
    return sim >= 0.85


def _merge_into(dst: Place, src: Place) -> None:
    # 카카오 이름·주소·카테고리가 한국어 표기로 가장 일관적이라 우선한다.
    if "kakao" in src.sources and "kakao" not in dst.sources:
        dst.name, dst.category = src.name, src.category or dst.category
        dst.address = src.address or dst.address
    dst.address = dst.address or src.address
    dst.category = dst.category or src.category
    if dst.lat is None and src.lat is not None:
        dst.lat, dst.lng = src.lat, src.lng
    dst.ids.update({k: v for k, v in src.ids.items() if k not in dst.ids})
    dst.urls.update({k: v for k, v in src.urls.items() if k not in dst.urls})
    for r in src.ratings:
        existing = dst.rating_for(r.platform)
        if existing is None:
            dst.ratings.append(r)
        elif r.count > existing.count:
            dst.ratings[dst.ratings.index(existing)] = r
    seen = {t.text for t in dst.texts}
    dst.texts.extend(t for t in src.texts if t.text not in seen)
    for attr in ("blog_total", "blog_waiting_total"):
        v = getattr(src, attr)
        if v is not None:
            cur = getattr(dst, attr)
            setattr(dst, attr, v if cur is None else max(cur, v))
    dst.keyword_votes.update(src.keyword_votes)
    if src.waiting_minutes is not None:
        dst.waiting_minutes = src.waiting_minutes
    if dst.reservable is None:
        dst.reservable = src.reservable
    dst.awards.extend(a for a in src.awards if a not in dst.awards)
    dst.sources |= src.sources


def merge_places(groups: Iterable[list[Place]]) -> list[Place]:
    """소스별 결과 리스트들을 받아 중복을 합친 장소 목록을 돌려준다."""
    merged: list[Place] = []
    for group in groups:
        for p in group:
            target: Optional[Place] = None
            for m in merged:
                if is_same_place(m, p):
                    target = m
                    break
            if target is None:
                merged.append(p)
            else:
                _merge_into(target, p)
    return merged
