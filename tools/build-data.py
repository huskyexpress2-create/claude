#!/usr/bin/env python3
"""워크플로 출력(JSON)을 data/*.js 문항 파일로 변환한다.

사용법:
  python3 tools/build-data.py text <workflow-output.json>        # 언어·논리·자료 (회차 1개분)
  python3 tools/build-data.py personality <workflow-output.json> # 인성 진술문 은행

출력 JSON은 워크플로 결과 객체 자체이거나 {"result": {...}} 래퍼여도 된다.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
HEADER = "/* 자동 생성 파일: tools/build-data.py. 형식은 docs/SCHEMA.md 참고. */\n"
ITEM_KEYS = ["id", "subtype", "group", "passageTitle", "passage", "materials", "stem", "box",
             "figure", "choices", "choiceCharts", "choiceSvgs", "answer", "explanation"]


def load(path):
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    return obj.get("result", obj) if isinstance(obj, dict) else obj


def clean(value):
    """null, 빈 문자열, 빈 배열/객체를 제거한다."""
    if isinstance(value, dict):
        out = {k: clean(v) for k, v in value.items()}
        return {k: v for k, v in out.items() if v not in (None, "", [], {})}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def order_item(item):
    item = clean(item)
    ordered = {k: item[k] for k in ITEM_KEYS if k in item}
    ordered.update({k: v for k, v in item.items() if k not in ordered})
    return ordered


def write_js(path, call, payload):
    body = json.dumps(payload, ensure_ascii=False, indent=1)
    path.write_text(HEADER + f"{call}{body});\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


def build_text(path):
    res = load(path)
    set_no = res["set"]
    for sec in res["sections"]:
        if not sec or not sec.get("items"):
            print(f"skip: set {set_no} section {sec and sec.get('section')} has no items", file=sys.stderr)
            continue
        if sec.get("unresolved"):
            print(f"warning: set {set_no} {sec['section']} unresolved: {[u.get('id') for u in sec['unresolved'] if isinstance(u, dict)]}", file=sys.stderr)
        items = [order_item(it) for it in sec["items"]]
        items.sort(key=lambda it: it["id"])
        write_js(DATA / f"set{set_no}-{sec['section']}.js", f"HMAT.add({set_no}, '{sec['section']}', ", items)


def build_personality(path):
    res = load(path)
    stmts = []
    for s in res["statements"]:
        s = clean(s)
        if "lie" not in s:
            s["lie"] = False
        stmts.append({k: s[k] for k in ["id", "text", "dim", "key", "pair", "lie"] if k in s})
    stmts.sort(key=lambda s: s["id"])
    write_js(DATA / "personality-bank.js", "HMAT.addPersonalityBank(", stmts)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("text", "personality"):
        print(__doc__)
        sys.exit(1)
    (build_text if sys.argv[1] == "text" else build_personality)(sys.argv[2])
