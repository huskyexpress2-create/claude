import json
from types import SimpleNamespace

import pytest

from matjip.cli import main
from matjip.models import Place, ReviewText, TextAnalysis


def test_demo_text(capsys):
    assert main(["소금빵", "--demo"]) == 0
    out = capsys.readouterr().out
    for title in ["웨이팅 무관 · 맛 최우선", "웨이팅 무관 · 맛+분위기", "웨이팅 적음/없음 · 맛 최우선", "웨이팅 적음/없음 · 맛+분위기"]:
        assert title in out


def test_demo_json(capsys):
    assert main(["소금빵", "--demo", "--format", "json", "--top", "1"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert set(data["categories"]) == {"any_taste", "any_both", "low_taste", "low_both"}
    best = data["categories"]["any_taste"]["places"][0]
    assert best["name"] == "(데모) 오븐집"
    assert best["waiting"]["level"] == "김"
    low = data["categories"]["low_taste"]["places"][0]
    assert low["waiting"]["level"] in ("거의 없음", "짧음")


def test_area_required(capsys):
    assert main(["소금빵"]) == 2
    assert "--area" in capsys.readouterr().err


def test_no_sources(monkeypatch, capsys):
    for k in ["GOOGLE_MAPS_API_KEY", "KAKAO_REST_API_KEY", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"]:
        monkeypatch.delenv(k, raising=False)
    assert main(["소금빵", "--area", "성수동"]) == 2
    assert "사용할 데이터가 없습니다" in capsys.readouterr().err


# ---- Claude 분석기 (가짜 클라이언트) ------------------------------------------
anthropic = pytest.importorskip("anthropic")
from matjip.llm_analyzer import ClaudeAnalyzer, apply_llm_result  # noqa: E402


class FakeMessages:
    def __init__(self, payload, stop_reason="end_turn"):
        self.payload = payload
        self.stop_reason = stop_reason
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        block = SimpleNamespace(type="text", text=json.dumps(self.payload, ensure_ascii=False))
        return SimpleNamespace(stop_reason=self.stop_reason, content=[block])


def fake_client(payload, stop_reason="end_turn"):
    msgs = FakeMessages(payload, stop_reason)
    return SimpleNamespace(beta=SimpleNamespace(messages=msgs)), msgs


PAYLOAD = {
    "taste": {"score": 0.9, "evidence": ["소금빵 최고"]},
    "atmosphere": {"score": -1, "evidence": []},
    "waiting": {"level": "long", "typical_minutes": 60, "evidence": ["1시간 대기"]},
    "dish_mentioned": True,
}


def test_claude_analyzer_applies_structured_result():
    client, msgs = fake_client(PAYLOAD)
    p = Place(name="빵집", texts=[ReviewText("manual", "소금빵 최고, 1시간 대기", sponsored=True)])
    a = TextAnalysis()
    ClaudeAnalyzer(client=client).refine([p], [a], "소금빵")
    assert a.taste.llm_score == 0.9
    assert a.mood.llm_score is None  # -1 = 근거 없음 → 사전 분석 유지
    assert a.waiting.llm_level == "long" and a.waiting.minutes_mentioned == [60.0]
    kw = msgs.kwargs
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert kw["fallbacks"] == "default"
    assert "[협찬의심]" in kw["messages"][0]["content"]


def test_claude_refusal_keeps_lexicon_result():
    client, _ = fake_client(PAYLOAD, stop_reason="refusal")
    a = TextAnalysis()
    ClaudeAnalyzer(client=client).refine([Place(name="x", texts=[ReviewText("manual", "맛있어요")])], [a], "빵")
    assert a.taste.llm_score is None


def test_apply_ignores_out_of_range_scores():
    a = TextAnalysis()
    apply_llm_result(a, {"taste": {"score": 7, "evidence": []}, "waiting": {"level": "unknown"}})
    assert a.taste.llm_score is None and a.waiting.llm_level is None
