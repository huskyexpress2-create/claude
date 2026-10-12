"""키워드 리뷰("음식이 맛있어요", 카카오 추천 포인트 "맛" 등)를 맛/분위기로 분류한다."""

from __future__ import annotations

import re

# "음식이 빨리 나와요", "매장이 청결해요", "가성비가 좋아요"는 맛·분위기 어느 쪽도 아니다.
TASTE_KEYWORD = re.compile(r"맛있|맛나|맛이\s?좋|^맛$|신선|풍미|고기\s?질|육즙|간이\s?딱")
MOOD_KEYWORD = re.compile(
    r"인테리어|분위기|뷰가|뷰\s?맛집|아늑|대화하기|사진이\s?잘|음악|매장이\s?넓|좌석이\s?편|조용|차분|감성|야경|테라스|특별한\s?날"
)


def classify_keyword(keyword: str) -> str | None:
    k = keyword.strip().strip('"“”')
    if TASTE_KEYWORD.search(k):
        return "taste"
    if MOOD_KEYWORD.search(k):
        return "mood"
    return None


def split_votes(keywords: dict[str, int]) -> tuple[int, int]:
    taste = mood = 0
    for k, n in keywords.items():
        kind = classify_keyword(k)
        if kind == "taste":
            taste += n
        elif kind == "mood":
            mood += n
    return taste, mood
