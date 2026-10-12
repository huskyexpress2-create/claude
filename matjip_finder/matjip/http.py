"""표준 라이브러리만 쓰는 최소 HTTP JSON 클라이언트.

테스트에서는 `HttpClient(transport=...)`로 가짜 전송 함수를 주입한다.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

# transport(method, url, headers, body_bytes) -> (status, response_bytes)
Transport = Callable[[str, str, dict[str, str], Optional[bytes]], tuple[int, bytes]]


class HttpError(RuntimeError):
    def __init__(self, status: int, url: str, body: str):
        super().__init__(f"HTTP {status} for {url}: {body[:300]}")
        self.status = status
        self.url = url
        self.body = body


def _urllib_transport(
    method: str, url: str, headers: dict[str, str], body: Optional[bytes]
) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class HttpClient:
    def __init__(self, transport: Optional[Transport] = None, retries: int = 2):
        self.transport = transport or _urllib_transport
        self.retries = retries

    def request_json(
        self,
        method: str,
        url: str,
        *,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
        json_body: Optional[dict[str, Any]] = None,
    ) -> Any:
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        hdrs = dict(headers or {})
        body = None
        if json_body is not None:
            body = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")

        attempt = 0
        while True:
            try:
                status, raw = self.transport(method, url, hdrs, body)
            except (urllib.error.URLError, TimeoutError) as e:
                # 네트워크 오류만 재시도한다.
                if attempt >= self.retries:
                    raise HttpError(0, url, str(e)) from e
                attempt += 1
                time.sleep(2**attempt)
                continue
            # 429/5xx만 재시도한다.
            if (status == 429 or status >= 500) and attempt < self.retries:
                attempt += 1
                time.sleep(2**attempt)
                continue
            text = raw.decode("utf-8", errors="replace")
            if status >= 400:
                raise HttpError(status, url, text)
            return json.loads(text) if text else {}

    def get_json(self, url: str, **kw: Any) -> Any:
        return self.request_json("GET", url, **kw)

    def post_json(self, url: str, **kw: Any) -> Any:
        return self.request_json("POST", url, **kw)
