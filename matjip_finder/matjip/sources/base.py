from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Optional, Protocol

from ..models import Place

_TAG_RE = re.compile(r"<[^>]+>")


def clean_html(s: str) -> str:
    """네이버 검색 API가 붙이는 <b> 태그와 HTML 엔티티를 제거한다."""
    return html.unescape(_TAG_RE.sub("", s or "")).strip()


@dataclass
class SearchQuery:
    food: str
    area: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_m: int = 2000

    @property
    def text(self) -> str:
        return f"{self.area} {self.food}".strip()


class DiscoverySource(Protocol):
    name: str

    def discover(self, query: SearchQuery) -> list[Place]:
        ...
