"""analysis/llm/eval_bangla.py with the model mocked."""

import csv
import importlib.util
import re
from pathlib import Path
from types import ModuleType

from app.feedback.llm import MockProvider

ROOT = Path(__file__).resolve().parents[2]


def load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("eval_bangla", ROOT / "analysis" / "llm" / "eval_bangla.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_eval_bangla_writes_outputs_a_blind_page_and_a_key(tmp_path: Path) -> None:
    script = load()
    html_path, key_path = tmp_path / "review.html", tmp_path / "key.csv"
    argv = ["--cases", "2", "--out-dir", str(tmp_path), "--html", str(html_path), "--key", str(key_path)]
    provider = MockProvider()  # Never a valid report: direct and translate use the template.
    assert script.main(argv, provider=provider) == 0

    [csv_path] = tmp_path.glob("bangla_*.csv")
    rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
    assert len(rows) == 2 * 3
    assert {row["strategy"] for row in rows} == {"direct", "translate", "template"}
    assert all("সেশন" in row["report_json"] for row in rows)

    page = html_path.read_text(encoding="utf-8")
    # Blind: the strategies are never named on the page.
    cases = page[page.index("<section>") : page.index("<script>")].lower()
    assert not re.search(r"\b(direct|translate|template)\b", cases)
    assert page.count('<div class="col"><h3>') == 6
    assert "Noto+Sans+Bengali" in page and 'lang="bn"' in page
    assert 'data-rating="' in page and "Download my ratings" in page

    key = list(csv.DictReader(key_path.open(encoding="utf-8")))
    assert len(key) == 6
    for case_id in {row["case_id"] for row in key}:
        assert sorted(row["code"] for row in key if row["case_id"] == case_id) == ["A", "B", "C"]
        assert sorted(row["strategy"] for row in key if row["case_id"] == case_id) == ["direct", "template", "translate"]

    # A second run resumes: nothing is generated again.
    calls = len(provider.calls)
    assert script.main(argv, provider=provider) == 0
    assert len(provider.calls) == calls
    # The page can be rebuilt without a model.
    assert script.main([*argv, "--html-only"]) == 0


def test_codes_are_shuffled_per_case_but_stable() -> None:
    script = load()
    first = script.codes_for("improving_01")
    assert sorted(first.values()) == ["A", "B", "C"]
    assert script.codes_for("improving_01") == first
    patterns = {tuple(sorted(script.codes_for(f"case_{n}").items())) for n in range(20)}
    assert len(patterns) > 1


def test_model_text_is_escaped_on_the_page() -> None:
    script = load()
    html = script._report_html({"patient_summary": "<script>alert(1)</script>", "next_session_text": "ok"})
    assert "<script>" not in html and "&lt;script&gt;" in html
