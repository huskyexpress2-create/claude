"""Playwright 브라우저 드라이버 (작성 중: 실제 페이지 구조 조사 결과를 반영해 구현 예정)."""

from __future__ import annotations


class PlaywrightUnavailable(RuntimeError):
    pass


class PlaywrightDriver:
    name = "playwright"

    def __init__(self, sites: list[str], headless: bool = False):
        raise PlaywrightUnavailable("Playwright 모드는 아직 구현 중입니다. 지금은 --browser-plan(Claude 브라우징)을 쓰세요.")
