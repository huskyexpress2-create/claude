"""명령행 진입점: python -m matjip <음식> --area <지역>"""

from __future__ import annotations

import argparse
import os
import sys
from importlib import resources
from typing import Optional

from .http import HttpClient
from .pipeline import run_search
from .report import render_json, render_text
from .sources import GooglePlacesSource, KakaoLocalSource, ManualSource, NaverSearchSource, SearchQuery

ENV_HELP = """필요한 환경변수 (가진 것만 설정하면 해당 소스만 사용):
  GOOGLE_MAPS_API_KEY                     Google Places API (New)
  KAKAO_REST_API_KEY                      카카오 로컬 API
  NAVER_CLIENT_ID / NAVER_CLIENT_SECRET   네이버 검색 API (지역·블로그)
  ANTHROPIC_API_KEY                       --analyzer claude 사용 시"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="matjip",
        description="여러 평점·리뷰 소스를 합쳐 음식/디저트 맛집을 4개 카테고리로 추천합니다.",
        epilog=ENV_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("food", help="찾을 음식/디저트 (예: 소금빵, 평양냉면, 크로플)")
    ap.add_argument("--area", help="지역 (예: 성수동, 강남역). --demo가 아니면 필수")
    ap.add_argument("--lat", type=float, help="검색 중심 위도 (선택)")
    ap.add_argument("--lng", type=float, help="검색 중심 경도 (선택)")
    ap.add_argument("--radius", type=int, default=2000, help="검색 반경 m (기본 2000, 카카오 최대 20000)")
    ap.add_argument("--sources", default="auto", help="google,kakao,naver 중 사용할 것 (기본: 키가 있는 것 전부)")
    ap.add_argument("--manual", action="append", default=[], metavar="CSV", help="수동 입력 CSV (여러 번 지정 가능)")
    ap.add_argument("--analyzer", choices=["lexicon", "claude"], default="lexicon", help="리뷰 텍스트 분석기")
    ap.add_argument("--claude-model", default=None, help="--analyzer claude에서 쓸 모델 ID")
    ap.add_argument("--top", type=int, default=3, help="카테고리별 추천 수 (기본 3)")
    ap.add_argument("--max-candidates", type=int, default=30, help="블로그 보강·분석할 최대 후보 수 (기본 30)")
    ap.add_argument("--no-dish-filter", action="store_true", help="요청 메뉴 언급이 없는 가게도 순위에 포함")
    ap.add_argument("--format", choices=["text", "markdown", "json"], default="text")
    ap.add_argument("--demo", action="store_true", help="API 없이 내장 가상 데이터로 실행 (소금빵)")
    return ap


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    env = os.environ
    try:  # Windows 콘솔(cp949)에서 한글·기호 출력이 깨지지 않도록
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

    if args.demo:
        demo_csv = resources.files("matjip") / "data" / "demo_saltbread.csv"
        with resources.as_file(demo_csv) as path:
            query = SearchQuery(food=args.food, area=args.area or "(데모) 가상동")
            result = run_search(query, [ManualSource([str(path)])], top=args.top)
        _print(result, args.format)
        return 0

    if not args.area:
        print(
            "오류: --area가 필요합니다. 지역 없이 '최고'를 정의할 수 없고, 검색 API도 지역 단위로 결과를 줍니다.",
            file=sys.stderr,
        )
        return 2

    http = HttpClient()
    wanted = None if args.sources == "auto" else {s.strip() for s in args.sources.split(",")}
    use = lambda name: wanted is None or name in wanted  # noqa: E731

    discovery: list = []
    naver: Optional[NaverSearchSource] = None
    if use("google") and env.get("GOOGLE_MAPS_API_KEY"):
        discovery.append(GooglePlacesSource(env["GOOGLE_MAPS_API_KEY"], http))
    if use("kakao") and env.get("KAKAO_REST_API_KEY"):
        discovery.append(KakaoLocalSource(env["KAKAO_REST_API_KEY"], http))
    if use("naver") and env.get("NAVER_CLIENT_ID") and env.get("NAVER_CLIENT_SECRET"):
        naver = NaverSearchSource(env["NAVER_CLIENT_ID"], env["NAVER_CLIENT_SECRET"], http)
        discovery.append(naver)
    if args.manual:
        discovery.append(ManualSource(args.manual))

    if not discovery:
        print("오류: 사용할 데이터 소스가 없습니다.\n" + ENV_HELP + "\n또는 --manual CSV, --demo를 쓰세요.", file=sys.stderr)
        return 2
    if wanted is not None:
        missing = [s for s in sorted(wanted) if s not in {d.name for d in discovery}]
        if missing:
            print(f"경고: 키가 없어 건너뜀: {', '.join(missing)}", file=sys.stderr)

    analyzer = None
    if args.analyzer == "claude":
        from .llm_analyzer import DEFAULT_MODEL, ClaudeAnalyzer

        analyzer = ClaudeAnalyzer(model=args.claude_model or DEFAULT_MODEL)

    query = SearchQuery(food=args.food, area=args.area, lat=args.lat, lng=args.lng, radius_m=args.radius)
    result = run_search(
        query,
        discovery,
        naver=naver,
        analyzer=analyzer,
        max_candidates=args.max_candidates,
        top=args.top,
        dish_filter=not args.no_dish_filter,
    )
    _print(result, args.format)
    return 0


def _print(result, fmt: str) -> None:
    if fmt == "json":
        print(render_json(result))
    else:
        print(render_text(result, md=(fmt == "markdown")))


if __name__ == "__main__":
    raise SystemExit(main())
