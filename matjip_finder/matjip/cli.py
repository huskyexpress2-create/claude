"""명령행 진입점: python -m matjip <음식> --area <지역>"""

from __future__ import annotations

import argparse
import os
import sys
from importlib import resources
from typing import Optional

from .http import HttpClient
from .pipeline import collect_candidates, run_search, select_browser_targets
from .report import render_json, render_text
from .sources import GooglePlacesSource, KakaoLocalSource, ManualSource, NaverSearchSource, SearchQuery

BROWSER_MAX_HARD = 15

ENV_HELP = """API 키 (가진 것만 설정하면 해당 소스만 사용):
  KAKAO_REST_API_KEY                      카카오 로컬 API: 후보 찾기·카카오맵 주소 (권장)
  GOOGLE_MAPS_API_KEY                     Google Places API (New): 기본은 추천 결과 옆에 Google Maps 평점을
                                          '참고'로만 표시. --google-scoring을 주면 점수에도 반영(약관 회색지대)
  NAVER_CLIENT_ID / NAVER_CLIENT_SECRET   네이버 검색 API. 약관상 결과 재가공·AI 입력이 금지라
                                          기본으로 쓰지 않음. --sources에 naver를 직접 적을 때만 사용
  ANTHROPIC_API_KEY                       --analyzer claude 사용 시

브라우저 모드 (네이버 플레이스·카카오맵 공개 페이지를 화면 그대로 읽음):
  --browser playwright        이 PC에서 브라우저 창을 띄워 직접 읽음 (pip install playwright 필요)
  --browser-plan DIR          Claude 데스크톱 앱/Claude in Chrome이 따라 할 작업 파일을 만들고 종료
  --browser-results FILE      위 두 방식의 결과 JSON을 반영
네이버·카카오 약관은 자동화된 수집을 금지합니다. 사용 책임은 사용자에게 있습니다 (README 참고)."""

GOOGLE_SCORING_WARNING = (
    "경고: Google Maps Platform 약관 3.2.3(c)(g)는 Google 콘텐츠로 새 콘텐츠를 만들거나 검색 결과를 바꾸는 것을 "
    "금지합니다. --google-scoring은 Google 평점을 다른 소스와 섞어 순위를 매기므로 약관과 충돌할 소지가 있습니다."
)

NAVER_API_WARNING = (
    "경고: 네이버 검색 API 약관(2026-10-07 개정)은 결과를 가공·재정렬하거나 AI에 입력하는 것을 금지합니다. "
    "이 프로그램은 결과를 다른 소스와 합쳐 재정렬하므로 약관 위반 소지가 있습니다. "
    "또 2026-07-30 이후 개발자센터 신규 신청이 중단됐습니다."
)


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
    ap.add_argument(
        "--sources", default="auto",
        help="google,kakao,naver 중 사용할 API (기본 auto: 키가 있는 google·kakao. naver는 직접 적어야 함)",
    )
    ap.add_argument("--manual", action="append", default=[], metavar="CSV", help="수동 입력 CSV (여러 번 지정 가능)")
    ap.add_argument("--analyzer", choices=["lexicon", "claude"], default="lexicon", help="리뷰 텍스트 분석기")
    ap.add_argument("--claude-model", default=None, help="--analyzer claude에서 쓸 모델 ID")
    ap.add_argument("--top", type=int, default=3, help="카테고리별 추천 수 (기본 3)")
    ap.add_argument("--max-candidates", type=int, default=30, help="분석할 최대 후보 수 (기본 30)")
    ap.add_argument("--no-dish-filter", action="store_true", help="요청 메뉴 언급이 없는 가게도 순위에 포함")
    ap.add_argument("--format", choices=["text", "markdown", "json"], default="text")
    ap.add_argument("--demo", action="store_true", help="API 없이 내장 가상 데이터로 실행 (소금빵)")
    ap.add_argument(
        "--google-scoring", action="store_true",
        help="Google 평점을 후보 발굴과 점수에 반영 (기본은 참고 표시만. 약관 회색지대)",
    )

    b = ap.add_argument_group("브라우저 모드")
    b.add_argument("--browser", choices=["playwright"], help="이 PC에서 브라우저로 공개 페이지를 읽어 반영")
    b.add_argument("--browser-plan", metavar="DIR", help="Claude 브라우징용 작업 파일(tasks.json, prompt.md)을 만들고 종료")
    b.add_argument("--browser-results", action="append", default=[], metavar="FILE", help="브라우저 수집 결과 JSON 반영")
    b.add_argument("--browser-max", type=int, default=8, help=f"브라우저로 볼 최대 가게 수 (기본 8, 상한 {BROWSER_MAX_HARD})")
    b.add_argument("--browser-sites", default="naver,kakao", help="브라우저로 볼 사이트 (기본 naver,kakao)")
    b.add_argument("--browser-headless", action="store_true", help="창 없이 실행 (기본은 창을 띄워 진행 상황을 보여 줌)")
    b.add_argument(
        "--save-browser-results", metavar="FILE", help="Playwright 수집 결과를 저장 (다음에 --browser-results로 재사용)"
    )
    return ap


def _rerun_args(args: argparse.Namespace) -> list[str]:
    """--browser-plan 이후 최종 실행에 그대로 넘길 옵션."""
    out: list[str] = []
    for flag, val in (
        ("--lat", args.lat), ("--lng", args.lng), ("--claude-model", args.claude_model),
    ):
        if val is not None:
            out += [flag, str(val)]
    if args.radius != 2000:
        out += ["--radius", str(args.radius)]
    if args.sources != "auto":
        out += ["--sources", args.sources]
    for m in args.manual:
        out += ["--manual", m]
    for r in args.browser_results:
        out += ["--browser-results", r]
    if args.analyzer != "lexicon":
        out += ["--analyzer", args.analyzer]
    if args.top != 3:
        out += ["--top", str(args.top)]
    if args.max_candidates != 30:
        out += ["--max-candidates", str(args.max_candidates)]
    if args.no_dish_filter:
        out.append("--no-dish-filter")
    if args.google_scoring:
        out.append("--google-scoring")
    if args.format != "text":
        out += ["--format", args.format]
    return out


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
    if args.browser and args.browser_plan:
        print("오류: --browser와 --browser-plan은 함께 쓸 수 없습니다.", file=sys.stderr)
        return 2
    browser_max = max(1, min(args.browser_max, BROWSER_MAX_HARD))
    if args.browser_max > BROWSER_MAX_HARD:
        print(f"경고: --browser-max는 최대 {BROWSER_MAX_HARD}곳입니다 (요청 {args.browser_max}).", file=sys.stderr)

    http = HttpClient()
    explicit = None if args.sources == "auto" else {s.strip() for s in args.sources.split(",") if s.strip()}
    use = lambda name: name in explicit if explicit is not None else name in ("google", "kakao")  # noqa: E731

    discovery: list = []
    naver: Optional[NaverSearchSource] = None
    google_ref: Optional[GooglePlacesSource] = None
    if use("google") and env.get("GOOGLE_MAPS_API_KEY"):
        google = GooglePlacesSource(env["GOOGLE_MAPS_API_KEY"], http)
        if args.google_scoring:
            print(GOOGLE_SCORING_WARNING, file=sys.stderr)
            discovery.append(google)
        else:
            google_ref = google
    if use("kakao") and env.get("KAKAO_REST_API_KEY"):
        discovery.append(KakaoLocalSource(env["KAKAO_REST_API_KEY"], http))
    if use("naver") and env.get("NAVER_CLIENT_ID") and env.get("NAVER_CLIENT_SECRET"):
        print(NAVER_API_WARNING, file=sys.stderr)
        naver = NaverSearchSource(env["NAVER_CLIENT_ID"], env["NAVER_CLIENT_SECRET"], http)
        discovery.append(naver)
    if args.manual:
        discovery.append(ManualSource(args.manual))
    if explicit is not None:
        have = {d.name for d in discovery} | {"manual"} | ({"google"} if google_ref else set())
        missing = [s for s in sorted(explicit) if s not in have]
        if missing:
            print(f"경고: 키가 없어 건너뜀: {', '.join(missing)}", file=sys.stderr)

    browser_places: list = []
    extra_warnings: list[str] = []
    if args.browser_results:
        from .browser.observations import load_places

        for path in args.browser_results:
            try:
                ps, ws = load_places(path, args.food, args.area)
            except (OSError, ValueError) as e:
                print(f"오류: 브라우저 결과 파일을 읽지 못했습니다: {path}: {e}", file=sys.stderr)
                return 2
            browser_places += ps
            extra_warnings += ws

    if not discovery and not browser_places and not args.browser and not args.browser_plan:
        hint = (
            "Google 키만으로는 후보를 찾지 않습니다(기본은 참고 표시). 카카오 키, 브라우저 모드, "
            "--google-scoring 중 하나가 필요합니다.\n" if google_ref else ""
        )
        print(
            "오류: 사용할 데이터가 없습니다.\n" + hint + ENV_HELP + "\n또는 --manual CSV, --demo를 쓰세요.",
            file=sys.stderr,
        )
        return 2

    query = SearchQuery(food=args.food, area=args.area, lat=args.lat, lng=args.lng, radius_m=args.radius)

    if args.browser_plan:
        from .browser.plan import write_plan

        places, _, warnings = collect_candidates(
            query, discovery, extra_places=browser_places, max_candidates=args.max_candidates, naver=naver
        )
        targets = select_browser_targets(places, query, browser_max, dish_filter=not args.no_dish_filter)
        tasks_path, prompt_path = write_plan(args.browser_plan, query, targets, browser_max, _rerun_args(args))
        for w in warnings + extra_warnings:
            print(f"경고: {w}", file=sys.stderr)
        print(f"작업 파일을 만들었습니다: {tasks_path}\n지시문: {prompt_path}")
        if targets:
            print(f"후보 {len(targets)}곳")
        else:
            print("API 후보가 없어 Claude가 네이버 지도에서 직접 후보를 찾도록 지시했습니다.")
        print("다음: Claude 데스크톱 앱(또는 Claude in Chrome)에서 prompt.md 내용을 그대로 붙여넣어 실행하세요.")
        return 0

    driver = None
    if args.browser == "playwright":
        from .browser.playwright_driver import PlaywrightDriver, PlaywrightUnavailable

        try:
            driver = PlaywrightDriver(
                sites=[s.strip() for s in args.browser_sites.split(",") if s.strip()],
                headless=args.browser_headless,
            )
        except PlaywrightUnavailable as e:
            print(f"오류: {e}", file=sys.stderr)
            return 2

    analyzer = None
    if args.analyzer == "claude":
        from .llm_analyzer import DEFAULT_MODEL, ClaudeAnalyzer

        analyzer = ClaudeAnalyzer(model=args.claude_model or DEFAULT_MODEL)

    result = run_search(
        query,
        discovery,
        naver=naver,
        analyzer=analyzer,
        max_candidates=args.max_candidates,
        top=args.top,
        dish_filter=not args.no_dish_filter,
        browser_places=browser_places,
        browser_driver=driver,
        browser_max=browser_max,
        google_reference=google_ref,
    )
    result.warnings[:0] = extra_warnings
    if driver is not None and args.save_browser_results:
        driver.save(args.save_browser_results, query)
        print(f"브라우저 수집 결과를 저장했습니다: {args.save_browser_results}", file=sys.stderr)
    _print(result, args.format)
    return 0


def _print(result, fmt: str) -> None:
    if fmt == "json":
        print(render_json(result))
    else:
        print(render_text(result, md=(fmt == "markdown")))


if __name__ == "__main__":
    raise SystemExit(main())
