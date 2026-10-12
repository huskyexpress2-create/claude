"""Claude 브라우징 모드: Claude(데스크톱 앱 내장 브라우저 또는 Claude in Chrome)가 따라 할 작업 파일을 만든다.

`python -m matjip 소금빵 --area 성수동 --browser-plan ./browse` →
  browse/tasks.json   후보 목록과 결과 파일 형식
  browse/prompt.md    Claude에게 그대로 붙여넣을 작업 지시문
Claude가 browse/browser_results.json을 쓰면, `--browser-results browse/browser_results.json`으로 최종 순위를 낸다.
"""

from __future__ import annotations

import json
import shlex
from pathlib import Path

from ..models import Place
from ..sources import SearchQuery
from .observations import SCHEMA_VERSION, now_iso

RESULTS_NAME = "browser_results.json"

RULES = [
    "네이버·카카오에 로그인하지 않은 브라우저(Claude 데스크톱 앱 내장 브라우저 권장)로만 본다.",
    "화면에 보이는 정보만 읽는다. 개발자 도구, 페이지 JavaScript 실행, 내부 API 호출, 네트워크 요청 재현으로 값을 꺼내지 않는다.",
    "페이지를 열 때마다 5~8초 기다린다. 후보 수를 넘겨서 더 보지 않는다.",
    "CAPTCHA, '자동입력 방지', '비정상적인 접근', '과도한 요청', 로그인 요구가 나오면 즉시 멈추고"
    " 그때까지의 결과만 저장한다. 우회하지 않는다.",
    "리뷰 작성자 닉네임·프로필·사진은 적지 않는다. 리뷰 본문만, 사이트당 최대 10개.",
    "보이지 않는 값은 null로 둔다. 추측하거나 다른 가게 값으로 채우지 않는다.",
    "가게 이름·주소가 후보와 다르면 그 사이트는 비워 둔다(다른 지점·동명 가게 주의).",
]

EXAMPLE_PLACE = {
    "candidate_id": "c1",
    "name": "후보 목록의 이름을 그대로",
    "address": "화면에 보인 주소",
    "observations": [
        {
            "site": "naver",
            "url": "https://m.place.naver.com/restaurant/1234567/home",
            "rating": 4.52,
            "rating_scale": 5,
            "rating_count": None,
            "review_count": 243,
            "blog_review_count": 31,
            "keywords": {"음식이 맛있어요": 224, "인테리어가 멋져요": 40, "친절해요": 94},
            "keyword_participants": None,
            "wait_tags": {"바로 입장": 7, "10분 이내": 2, "30분 이상": 1},
            "reviews": ["리뷰 본문 1", "리뷰 본문 2"],
            "live_waiting_teams": None,
            "observed_at": "",
        },
        {
            "site": "kakao",
            "url": "https://place.map.kakao.com/12345678",
            "rating": 4.3,
            "rating_scale": 5,
            "rating_count": 128,
            "review_count": 128,
            "blog_review_count": 45,
            "keywords": {"맛": 30, "분위기": 12},
            "keyword_participants": None,
            "wait_tags": {},
            "reviews": ["보이는 후기 본문"],
            "live_waiting_teams": None,
            "observed_at": "",
        },
    ],
}


def _candidate_dict(i: int, p: Place) -> dict:
    urls = {k: v for k, v in p.urls.items() if k in ("kakao", "naver_place", "google")}
    return {"candidate_id": f"c{i}", "name": p.name, "address": p.address, "known_urls": urls}


def write_plan(
    outdir: str | Path, query: SearchQuery, targets: list[Place], limit: int, rerun_args: list[str]
) -> tuple[Path, Path]:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    results_path = out / RESULTS_NAME
    candidates = [_candidate_dict(i, p) for i, p in enumerate(targets[:limit], 1)]
    tasks = {
        "version": SCHEMA_VERSION,
        "created_at": now_iso(),
        "query": {"food": query.food, "area": query.area},
        "limit": limit,
        "candidates": candidates,
        "results_file": str(results_path),
        "rules": RULES,
        "result_example": {
            "version": SCHEMA_VERSION,
            "query": {"food": query.food, "area": query.area},
            "collected_at": "2026-10-12T19:30:00+09:00",
            "collector": "claude",
            "places": [EXAMPLE_PLACE],
        },
    }
    tasks_path = out / "tasks.json"
    tasks_path.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")

    final_cmd = " ".join(
        ["python", "-m", "matjip", shlex.quote(query.food), "--area", shlex.quote(query.area)]
        + [shlex.quote(a) for a in rerun_args]
        + ["--browser-results", shlex.quote(str(results_path))]
    )
    prompt_path = out / "prompt.md"
    prompt_path.write_text(render_prompt(query, candidates, limit, results_path, final_cmd), encoding="utf-8")
    return tasks_path, prompt_path


def render_prompt(query: SearchQuery, candidates: list[dict], limit: int, results_path: Path, final_cmd: str) -> str:
    if candidates:
        cand_lines = "\n".join(
            f"- {c['candidate_id']}: {c['name']} ({c['address'] or '주소 미상'})"
            + (f" — 카카오: {c['known_urls']['kakao']}" if c["known_urls"].get("kakao") else "")
            for c in candidates
        )
        who = f"아래 후보 {len(candidates)}곳"
    else:
        cand_lines = (
            f"(API 후보 없음) 네이버 지도에서 '{query.area} {query.food}'를 검색해 기본 정렬 상위 {limit}곳을 후보로 삼고,"
            " candidate_id는 b1, b2…로 붙인다."
        )
        who = f"후보 최대 {limit}곳"
    rules = "\n".join(f"{i}. {r}" for i, r in enumerate(RULES, 1))
    example = json.dumps(
        {"version": SCHEMA_VERSION, "query": {"food": query.food, "area": query.area},
         "collected_at": "<지금 시각, ISO 8601>", "collector": "claude", "places": [EXAMPLE_PLACE]},
        ensure_ascii=False, indent=2,
    )
    return f"""# matjip 브라우저 수집 작업: {query.area} {query.food}

사용자의 컴퓨터에서 브라우저로 공개 가게 페이지를 읽고, 결과를 JSON 파일로 저장하는 작업이다.
{who}에 대해 아래 규칙을 지키며 값을 모은다.

## 규칙
{rules}

## 후보
{cand_lines}

## 가게마다 할 일
1. 네이버 플레이스: m.place.naver.com 또는 map.naver.com에서 "{query.area} <가게명>"으로 찾아 해당 가게 페이지를 연다.
   - 홈/리뷰 탭에서 다음을 읽는다: 평균 별점(보일 때만), 방문자 리뷰 수, 블로그 리뷰 수,
     "이런 점이 좋았어요" 키워드와 각 숫자(보이는 만큼),
     방문자 리뷰 본문 최대 10개, 각 리뷰의 "대기 시간" 값(예: 바로 입장, 10분 이내, 30분 이상)을 세어 wait_tags에 합계로 적는다.
2. 카카오맵: 후보에 카카오 주소가 있으면 그 페이지를, 없으면 카카오맵에서 검색해 연다.
   - 평균 별점, 후기 수, 블로그 리뷰 수, 추천 포인트(맛·분위기 등)와 숫자, 화면에 보이는 후기 본문.
3. (선택) 캐치테이블·테이블링 가게 페이지에 "현재 대기 N팀"이 로그인 없이 화면에 보이면
   site를 "catchtable" 또는 "tabling"으로 한 관측값에 live_waiting_teams와 observed_at(지금 시각)을 적는다.
4. 각 사이트 사이, 각 페이지 이동 사이에 5~8초 기다린다.

## 결과 파일
`{results_path}`에 UTF-8 JSON으로 저장한다. name은 후보 목록의 이름을 그대로 쓴다. 형식:

```json
{example}
```

## 저장 후
다음 명령을 실행해 최종 추천을 사용자에게 보여 준다.

```
{final_cmd}
```
"""
