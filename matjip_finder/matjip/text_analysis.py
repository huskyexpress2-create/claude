"""사전(lexicon) 기반 한국어 리뷰 측면 분석기.

리뷰를 절(clause) 단위로 나눈 뒤
  - 맛(taste) / 분위기(mood) 측면이 언급됐는지,
  - 그 절의 극성(긍정/부정)이 무엇인지,
  - 웨이팅이 길다/없다는 근거가 있는지
를 정규식으로 판정한다.

한계: 반어·비꼼, 비교 표현("A보다 별로"), 오탈자, 신조어는 놓친다.
정확도가 더 필요하면 `--analyzer claude`(llm_analyzer.py)를 쓴다.
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

from .models import AspectResult, Place, ReviewText, TextAnalysis, WaitingResult

SOURCE_WEIGHTS = {
    "google_review": 1.0,
    "manual": 1.0,
    "naver_blog": 0.6,
    "naver_blog_waiting": 0.6,
}
SPONSORED_FACTOR = 0.3
DISH_TASTE_BOOST = 1.5  # 요청한 메뉴가 같은 절에 등장하면 맛 근거 가중치 증가

# 대조 접속(지만/는데/...)과 문장부호에서 절을 나눈다.
_CLAUSE_SPLIT = re.compile(
    r"[.!?\n…~;]+|,\s*|(?<=[가-힣])(?:지만|는데|은데|인데|었는데|았는데|으나|던데)\s+|\s(?:근데|그런데|하지만|그러나|반면)\s"
)

# "뷰 맛집", "사진 맛집"은 맛이 아니라 분위기 칭찬이다. 맛 판정 전에 치환한다.
_MOOD_MATJIP = re.compile(r"(뷰|사진|분위기|인테리어|감성|야경|포토)\s?맛집")

TASTE_NOUN = re.compile(
    r"맛|음식|요리|메뉴|빵(?!집)|디저트|케이크|케잌|커피|음료|라떼|식감|풍미|육즙|소스|국물|고기|크림|반죽|재료|간도|간이 딱|간이 잘"
)
MOOD_NOUN = re.compile(
    r"분위기|인테리어|감성|뷰|전망|야경|조명|음악|공간|매장|테라스|루프탑|정원|창가|채광|외관|건물|포토존|사진|좌석|MOOD_PRAISE"
)

TASTE_POS = re.compile(
    r"맛있|맛나|맛났|존맛|꿀맛|jmt|맛집|고소|촉촉|바삭|쫄깃|쫀득|쫀쫀|담백|풍미|감칠맛|녹아|"
    r"겉바속촉|겉바속쫀|맛도리|달달|달콤|신선|진한 맛|깊은 맛",
    re.IGNORECASE,
)
TASTE_NEG = re.compile(
    r"맛\s?(?:이|은|도)?\s?없|노맛|별맛\s?(?:없|이 없)|싱겁|싱거|느끼|비리|비린|퍽퍽|눅눅|질기|질겨|텁텁|"
    r"(?<![진가])짜(?:요|다|고|서|더|네|게|웠|워|긴|ㄷ)|너무\s?달(?:아|고|다|어|았|더)|맛이\s?그냥|평범한\s?맛"
)
MOOD_POS = re.compile(
    r"MOOD_PRAISE|아늑|감성적|힙(?:한|해|하|함)|세련|쾌적|조용|아기자기|고급스럽|고급스러|운치|로맨틱|"
    r"데이트\s?(?:하기)?\s?좋|채광|넓(?:고|어|은|직|찍)"
)
MOOD_NEG = re.compile(
    r"시끄럽|시끄러|좁(?:고|아|은|다|더)|협소|복잡|정신\s?없|답답|북적|더럽|더러|지저분|낡(?:고|은|았)|불편"
)
# 측면 명사가 같은 절에 있을 때만 그 측면에 붙는 범용 평가어
GENERIC_POS = re.compile(
    r"좋|최고|훌륭|만족|(?<!비)추천|강추|대박|미쳤|완벽|일품|굿|good|인생|괜찮|예쁘|이쁘|예뻐|이뻐|멋지|멋있|멋져|깔끔",
    re.IGNORECASE,
)
GENERIC_NEG = re.compile(
    r"별로|실망|아쉽|아쉬|그저\s?그|그냥\s?그|평범|비추|최악|그닥|그다지|애매|기대\s?이하|과대평가|거품|나쁘|나빠|나쁜"
)
# 예쁘다·깔끔하다 류는 음식에 붙으면 '보기 좋음'이지 맛이 아니므로 맛 측면에는 쓰지 않는다.
_TASTE_EXCLUDED_GENERIC = re.compile(r"예쁘|이쁘|예뻐|이뻐|멋지|멋있|멋져|깔끔")

_NEG_BEFORE = re.compile(r"(?:^|\s)(?:안|못)\s?$")
_NEG_AFTER = re.compile(r"^\S{0,2}?(?:지|진)(?:는|도|가)?\s*(?:않|못)")

# ---- 웨이팅 -----------------------------------------------------------------
WAIT_SHORT = re.compile(
    r"(?:웨이팅|대기|줄|기다림)\s?(?:이|은|도|가|는)?\s?(?:거의\s?|하나도\s?|1도\s?|별로\s?|전혀\s?)?(?:없|짧|적었|적어|금방|빨리|안\s?(?:했|하고|함|해))|"
    r"(?:웨이팅|대기|기다림)\s?없이|노\s?웨이팅|웨이팅\s?[xX]|바로\s?(?:입장|앉|들어|착석|자리)|한산|여유롭|여유로|널널|"
    r"자리\s?(?:가|는|도)?\s?(?:많|넉넉|여유)|금방\s?(?:들어|입장|자리|빠)"
)
_TIME = r"(?:\d+\s?(?:시간|분)|한\s?시간|두\s?시간|세\s?시간|반나절)"
WAIT_LONG = re.compile(
    r"(?:웨이팅|대기)\s?(?:이|은|도|가)?\s?(?:정말\s?|진짜\s?|너무\s?)?(?:길|많|엄청|장난|헬|어마|필수|있었|있어|있음|있고|있는|있$|심|기본|꽤|후덜|ㄷㄷ)|"
    + _TIME + r"\s?(?:정도|넘게|이상|가량|씩|가까이)?\s?(?:웨이팅|대기|기다|줄)|"
    r"(?:웨이팅|대기)\s?(?:시간)?\s?(?:이|은|만)?\s?(?:약|거의)?\s?" + _TIME + r"|"
    r"줄\s?(?:을|이)?\s?(?:서|섰|길|엄청|어마)|오픈런|오픈\s?전부터|번호표|대기\s?(?:번호|명단|순번|팀|인원)|"
    r"테이블링|원격\s?줄서기|\d+\s?팀|기다(?:렸|려야|리는|려서)"
)
_MINUTES = re.compile(r"(\d+)\s?(시간|분)|(한|두|세)\s?시간")
_KOR_NUM = {"한": 1, "두": 2, "세": 3}


def split_clauses(text: str) -> list[str]:
    return [c.strip() for c in _CLAUSE_SPLIT.split(text) if c and c.strip()]


def _count_polarity(pattern: re.Pattern, clause: str, skip: Optional[re.Pattern] = None) -> tuple[float, float]:
    """패턴 매치를 세되, 부정 표현이 붙은 매치는 반대 극성(가중 0.5)으로 센다."""
    same, flipped = 0.0, 0.0
    for m in pattern.finditer(clause):
        if skip is not None and skip.fullmatch(m.group(0)):
            continue
        before = clause[max(0, m.start() - 3): m.start()]
        after = clause[m.end(): m.end() + 6]
        if _NEG_BEFORE.search(before) or _NEG_AFTER.match(after):
            flipped += 0.5
        else:
            same += 1.0
    return same, flipped


def _clause_aspect_polarity(clause: str, dish_terms: list[str]) -> dict[str, float]:
    clause = _MOOD_MATJIP.sub("MOOD_PRAISE", clause)
    has_dish = any(t in clause for t in dish_terms)
    taste_on = bool(TASTE_NOUN.search(clause)) or has_dish
    mood_on = bool(MOOD_NOUN.search(clause))

    tp, tn_flip = _count_polarity(TASTE_POS, clause)
    tn, tp_flip = _count_polarity(TASTE_NEG, clause)
    mp, mn_flip = _count_polarity(MOOD_POS, clause)
    mn, mp_flip = _count_polarity(MOOD_NEG, clause)
    gp, gn_flip = _count_polarity(GENERIC_POS, clause)
    gn, gp_flip = _count_polarity(GENERIC_NEG, clause)

    taste_pos = tp + tp_flip
    taste_neg = tn + tn_flip
    if taste_on:
        gp_taste, gn_flip_taste = _count_polarity(GENERIC_POS, clause, skip=_TASTE_EXCLUDED_GENERIC)
        taste_pos += gp_taste + gp_flip
        taste_neg += gn + gn_flip_taste
    mood_pos = mp + mp_flip
    mood_neg = mn + mn_flip
    if mood_on:
        mood_pos += gp + gp_flip
        mood_neg += gn + gn_flip

    boost = DISH_TASTE_BOOST if has_dish else 1.0
    return {
        "taste_pos": taste_pos * boost,
        "taste_neg": taste_neg * boost,
        "mood_pos": mood_pos,
        "mood_neg": mood_neg,
        "dish": 1.0 if has_dish else 0.0,
    }


def _extract_minutes(clause: str) -> list[float]:
    out = []
    for m in _MINUTES.finditer(clause):
        if m.group(1):
            n = float(m.group(1))
            out.append(n * 60 if m.group(2) == "시간" else n)
        else:
            out.append(_KOR_NUM[m.group(3)] * 60.0)
    # 영업시간("10시간 영업") 같은 오탐을 줄이기 위해 5시간 초과는 버린다.
    return [x for x in out if 0 < x <= 300]


def text_weight(t: ReviewText) -> float:
    w = SOURCE_WEIGHTS.get(t.source, 0.6)
    return w * (SPONSORED_FACTOR if t.sponsored else 1.0)


def _snippet(text: str, limit: int = 90) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def analyze_texts(texts: Iterable[ReviewText], dish_terms: list[str]) -> TextAnalysis:
    res = TextAnalysis(taste=AspectResult(), mood=AspectResult(), waiting=WaitingResult())
    taste_ev: list[tuple[float, str]] = []
    mood_ev: list[tuple[float, str]] = []
    wait_ev: list[tuple[float, str]] = []

    for t in texts:
        w = text_weight(t)
        res.n_texts += 1
        # 웨이팅 검색어로 모은 글은 '언급 비율' 계산에서 빼야 선택 편향이 없다.
        general = t.source != "naver_blog_waiting"

        agg = {"taste_pos": 0.0, "taste_neg": 0.0, "mood_pos": 0.0, "mood_neg": 0.0, "dish": 0.0}
        long_c = short_c = 0
        minutes: list[float] = []
        for clause in split_clauses(t.text):
            for k, v in _clause_aspect_polarity(clause, dish_terms).items():
                agg[k] += v
            if WAIT_SHORT.search(clause):
                short_c += 1
            elif WAIT_LONG.search(clause):
                long_c += 1
                minutes.extend(_extract_minutes(clause))
        # "10분 정도 웨이팅"은 길다는 근거가 아니다.
        if long_c > short_c and minutes and max(minutes) <= 15:
            long_c, short_c = 0, 1
            minutes = []

        if agg["dish"]:
            res.dish_mentions += 1

        if general:
            res.taste.total_weight += w
            res.mood.total_weight += w
            res.waiting.total_weight += w
            for aspect, ev in (("taste", taste_ev), ("mood", mood_ev)):
                net = agg[f"{aspect}_pos"] - agg[f"{aspect}_neg"]
                ar: AspectResult = getattr(res, aspect)
                if net > 0:
                    ar.positive += w
                    ev.append((w * net, "+ " + _snippet(t.text)))
                elif net < 0:
                    ar.negative += w
                    ev.append((100 + w * -net, "- " + _snippet(t.text)))  # 부정 근거를 먼저 보여준다

        if long_c > short_c:
            res.waiting.dir_long += w
            res.waiting.minutes_mentioned.extend(minutes)
            wait_ev.append((w, "웨이팅↑ " + _snippet(t.text)))
            if general:
                res.waiting.long_weight += w
        elif short_c > long_c:
            res.waiting.dir_short += w
            wait_ev.append((w, "웨이팅↓ " + _snippet(t.text)))
            if general:
                res.waiting.short_weight += w

    res.taste.evidence = [s for _, s in sorted(taste_ev, reverse=True)[:3]]
    res.mood.evidence = [s for _, s in sorted(mood_ev, reverse=True)[:3]]
    res.waiting.evidence = [s for _, s in sorted(wait_ev, reverse=True)[:3]]
    return res


def dish_terms_for(food: str) -> list[str]:
    terms = [t for t in re.split(r"\s+", food.strip()) if len(t) >= 2]
    joined = food.replace(" ", "")
    if joined and joined not in terms:
        terms.append(joined)
    return terms


def analyze_place(place: Place, food: str) -> TextAnalysis:
    return analyze_texts(place.texts, dish_terms_for(food))
