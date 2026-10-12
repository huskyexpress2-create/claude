"""수동 CSV 입력.

공식 API가 없는 플랫폼(카카오맵 별점, 네이버 플레이스 별점·키워드 리뷰, 캐치테이블,
다이닝코드, 블루리본, 미쉐린 등)의 값을 사용자가 직접 확인해 넣는 통로다.

컬럼 규칙 (헤더 이름, 순서 무관, 없는 컬럼은 비워도 됨):
  name (필수), address, lat, lng, category
  <platform>_rating, <platform>_count, <platform>_scale   예) kakao_rating, kakao_count
  taste_votes, mood_votes, keyword_review_total            네이버 키워드 리뷰
                                                           ("음식이 맛있어요"/"인테리어가 멋져요" 수, 키워드 리뷰 총 참여자 수)
  waiting_minutes   직접 확인한 평균 웨이팅(분). 0이면 웨이팅 없음.
  reservable        true/false
  awards            "|"로 구분. 예) 블루리본 2|미쉐린 빕구르망
  reviews           "|"로 구분한 리뷰 원문
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Optional

from ..models import DEFAULT_SCALES, Place, PlatformRating, ReviewText


def _num(v: Optional[str]) -> Optional[float]:
    if v is None:
        return None
    v = v.strip().replace(",", "")
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _bool(v: Optional[str]) -> Optional[bool]:
    if v is None or not v.strip():
        return None
    return v.strip().lower() in {"1", "true", "yes", "y", "o", "예", "가능"}


def load_manual_csv(path: str | Path) -> list[Place]:
    places = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            row = {(k or "").strip().lower(): (v or "") for k, v in row.items()}
            name = row.get("name", "").strip()
            if not name:
                continue
            p = Place(
                name=name,
                address=row.get("address", "").strip(),
                lat=_num(row.get("lat")),
                lng=_num(row.get("lng")),
                category=row.get("category", "").strip(),
                waiting_minutes=_num(row.get("waiting_minutes")),
                reservable=_bool(row.get("reservable")),
            )
            p.sources.add("manual")
            if row.get("url", "").strip():
                p.urls["manual"] = row["url"].strip()

            platforms = {k[: -len("_rating")] for k in row if k.endswith("_rating")}
            for plat in sorted(platforms):
                rating = _num(row.get(f"{plat}_rating"))
                if rating is None:
                    continue
                scale = _num(row.get(f"{plat}_scale")) or DEFAULT_SCALES.get(plat, 5.0)
                count = int(_num(row.get(f"{plat}_count")) or 0)
                p.ratings.append(PlatformRating(plat, rating, count=count, scale=scale))

            for key in ("taste_votes", "mood_votes", "keyword_review_total"):
                v = _num(row.get(key))
                if v is not None:
                    p.keyword_votes[key] = int(v)

            p.awards = [a.strip() for a in row.get("awards", "").split("|") if a.strip()]
            for t in row.get("reviews", "").split("|"):
                if t.strip():
                    p.texts.append(ReviewText(source="manual", text=t.strip()))
            places.append(p)
    return places


class ManualSource:
    name = "manual"

    def __init__(self, paths: list[str]):
        self.paths = paths

    def discover(self, query) -> list[Place]:  # query는 사용하지 않는다
        out: list[Place] = []
        for p in self.paths:
            out.extend(load_manual_csv(p))
        return out
