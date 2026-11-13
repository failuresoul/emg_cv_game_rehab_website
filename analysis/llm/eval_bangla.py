"""Compare the three ways of writing Bangla reports, for a blind rating by a native speaker.

Run from the repository root, with the Ollama app running:

    server\\.venv\\Scripts\\python.exe analysis\\llm\\eval_bangla.py
    server\\.venv\\Scripts\\python.exe analysis\\llm\\eval_bangla.py --model qwen3.5:2b --cases 5
    server\\.venv\\Scripts\\python.exe analysis\\llm\\eval_bangla.py --html-only   (rebuild the page)

Takes the first 15 dev cases of testset.json, in Bangla, and writes each with every strategy:
"direct" (the model writes Bangla), "translate" (English, then translated) and "template" (no
model). Saves after every case (a stopped run resumes):
- analysis/llm/results/bangla_<model>.csv: every output with its meta;
- analysis/llm/bangla_review.html: the outputs side by side under codes A, B and C, shuffled per
  case, with 1-5 boxes for fluency and correctness and a button that downloads your ratings;
- analysis/llm/bangla_review_key.csv: which code is which strategy. Open it only after rating.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import random
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app.core.config import settings  # noqa: E402
from app.feedback.llm import LLMError, LLMProvider, OllamaProvider  # noqa: E402
from app.feedback.rules import red_flags  # noqa: E402
from app.feedback.service import BANGLA_STRATEGIES, generate_report_from_facts  # noqa: E402
from app.schemas.metrics import SessionFacts  # noqa: E402

HERE = Path(__file__).resolve().parent
TESTSET = HERE / "testset.json"
RESULTS = HERE / "results"
HTML = HERE / "bangla_review.html"
KEY = HERE / "bangla_review_key.csv"
CODES = ("A", "B", "C")
SEED = 1515
COLUMNS = [
    "case_id", "strategy", "model", "valid", "fallback_used", "retries", "latency_s",
    "output_tokens", "provider_error", "first_errors", "report_json",
]  # fmt: skip


def bangla_cases(count: int, testset: Path = TESTSET) -> list[dict[str, Any]]:
    """The first `count` dev cases, made Bangla."""
    cases = [c for c in json.loads(testset.read_text(encoding="utf-8"))["cases"] if c["split"] == "dev"]
    return [{**case, "facts": {**case["facts"], "language": "bn"}} for case in cases[:count]]


def codes_for(case_id: str) -> dict[str, str]:
    """Each strategy's code in this case: shuffled per case, the same on every run."""
    strategies = list(BANGLA_STRATEGIES)
    random.Random(f"{SEED}-{case_id}").shuffle(strategies)
    return dict(zip(strategies, CODES, strict=True))


def run_case(case: dict[str, Any], strategy: str, provider: LLMProvider, model: str) -> dict[str, Any]:
    facts = SessionFacts.model_validate(case["facts"])
    result = generate_report_from_facts(facts, "bn", model=model, provider=provider, bn_strategy=strategy)  # type: ignore[arg-type]
    meta = result.meta
    return {
        "case_id": case["id"],
        "strategy": strategy,
        "model": meta.model or model,
        "valid": not meta.fallback_used or strategy == "template",
        "fallback_used": meta.fallback_used,
        "retries": meta.retries,
        "latency_s": round(meta.latency_ms / 1000, 2),
        "output_tokens": meta.output_tokens,
        "provider_error": meta.provider_error or "",
        "first_errors": " | ".join(meta.validation_errors[0][:3]) if meta.validation_errors else "",
        "report_json": json.dumps(result.report.model_dump(), ensure_ascii=False),
    }


# The review page


def _facts_lines(facts: SessionFacts) -> list[str]:
    """What the reviewer checks correctness against, in English."""
    lines = [f"Session {facts.session_no}; baseline {'available' if facts.baseline_available else 'not yet available'}."]
    for metric in facts.metrics:
        lines.append(f"{metric.name}: {metric.mdc_status.replace('_', ' ')} ({metric.value:g} {metric.unit})")
    flags = [flag.code for flag in red_flags(facts, "bn")]
    if flags:
        lines.append(f"Safety notice shown by the app ({', '.join(flags)}): the report must not mention pain, symptoms or doctors.")
    if facts.next_session:
        lines.append("Next session: " + ", ".join(facts.next_session.focus_movements or ["-"]))
    return lines


def _report_html(report: dict[str, Any]) -> str:
    def esc(value: Any) -> str:
        return html.escape(str(value))

    parts = [f"<p>{esc(report.get('patient_summary', ''))}</p>"]
    for title, key in (("Highlights", "highlights"), ("Tips", "suggestions")):
        items = report.get(key) or []
        if items:
            parts.append(f"<h4>{title}</h4><ul>" + "".join(f"<li>{esc(i.get('text', ''))}</li>" for i in items) + "</ul>")
    parts.append(f"<p><b>Next time:</b> {esc(report.get('next_session_text', ''))}</p>")
    return "\n".join(parts)


def _rating(case_id: str, code: str, name: str) -> str:
    options = "".join(f'<option value="{n}">{n}</option>' for n in range(1, 6))
    field = f"{case_id}|{code}|{name}"
    return f'<label>{name.title()} <select data-rating="{html.escape(field)}"><option value=""></option>{options}</select></label>'


def build_html(cases: list[dict[str, Any]], rows: list[dict[str, Any]], model: str) -> str:
    by_key = {(row["case_id"], row["strategy"]): row for row in rows}
    blocks = []
    for case in cases:
        codes = codes_for(case["id"])
        if not all((case["id"], s) in by_key for s in codes):
            continue
        facts = SessionFacts.model_validate(case["facts"])
        columns = []
        for strategy, code in sorted(codes.items(), key=lambda item: item[1]):
            report = json.loads(by_key[(case["id"], strategy)]["report_json"])
            note = f'{html.escape(case["id"])}|{code}|note'
            columns.append(
                f'<div class="col"><h3>{code}</h3><div lang="bn" class="report">{_report_html(report)}</div>'
                f'<div class="rate">{_rating(case["id"], code, "fluency")} {_rating(case["id"], code, "correctness")}'
                f'<input data-rating="{note}" placeholder="Note (optional)"></div></div>'
            )
        facts_list = "".join(f"<li>{html.escape(line)}</li>" for line in _facts_lines(facts))
        blocks.append(
            f'<section><h2>Case {html.escape(case["id"])}</h2><details><summary>The facts</summary>'
            f'<ul class="facts">{facts_list}</ul></details><div class="cols">{"".join(columns)}</div></section>'
        )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bangla report review</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600&display=swap">
<style>
  body {{ font-family: system-ui, sans-serif; margin: 16px; max-width: 1400px; color: #1f2a2e; background: #f4f7f7; }}
  section {{ background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 20px; }}
  .cols {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }}
  .col {{ border: 1px solid #ccd; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; }}
  .report {{ font-family: "Noto Sans Bengali", system-ui, sans-serif; font-size: 18px; line-height: 1.6; flex: 1; }}
  .rate {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }}
  .rate input {{ flex: 1; min-width: 120px; }}
  h3 {{ margin: 0 0 8px; color: #0f5c5c; }}
  button {{ background: #0f5c5c; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 16px; }}
</style>
</head>
<body>
<h1>Bangla report review ({html.escape(model)})</h1>
<p>Each case shows the same session written three ways, under the codes A, B and C (shuffled for
every case). Rate each 1 (poor) to 5 (excellent):</p>
<ul>
  <li><b>Fluency:</b> natural, simple Bangla that an older person reads easily.</li>
  <li><b>Correctness:</b> agrees with the facts (open "The facts"): nothing invented, improved and
  worse only where the facts say so, no medical advice.</li>
</ul>
<p>Your ratings are kept in this browser while you work. When finished, press the button and send the
file. Do not open bangla_review_key.csv before you have rated every case.</p>
<p><button type="button" id="download">Download my ratings (CSV)</button></p>
{"".join(blocks)}
<p><button type="button" id="download2">Download my ratings (CSV)</button></p>
<script>
  const STORE = "bangla-review-ratings";
  const fields = [...document.querySelectorAll("[data-rating]")];
  let saved = {{}};
  try {{ saved = JSON.parse(localStorage.getItem(STORE) || "{{}}"); }} catch (e) {{ saved = {{}}; }}
  for (const field of fields) {{
    const key = field.dataset.rating;
    if (saved[key] !== undefined) field.value = saved[key];
    field.addEventListener("change", () => {{
      saved[key] = field.value;
      try {{ localStorage.setItem(STORE, JSON.stringify(saved)); }} catch (e) {{}}
    }});
  }}
  function download() {{
    const rows = {{}};
    for (const field of fields) {{
      const [caseId, code, name] = field.dataset.rating.split("|");
      const row = (rows[caseId + "|" + code] ||= {{ case_id: caseId, code, fluency: "", correctness: "", note: "" }});
      row[name] = field.value;
    }}
    const quote = (value) => '"' + String(value).replaceAll('"', '""') + '"';
    const lines = ["case_id,code,fluency,correctness,note"].concat(
      Object.values(rows).map((r) => [r.case_id, r.code, r.fluency, r.correctness, r.note].map(quote).join(",")),
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lines.join("\\n")], {{ type: "text/csv" }}));
    link.download = "bangla_ratings.csv";
    link.click();
  }}
  document.getElementById("download").addEventListener("click", download);
  document.getElementById("download2").addEventListener("click", download);
</script>
</body>
</html>
"""


def write_key(cases: list[dict[str, Any]], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["case_id", "code", "strategy"])
        for case in cases:
            for strategy, code in sorted(codes_for(case["id"]).items(), key=lambda item: item[1]):
                writer.writerow([case["id"], code, strategy])


def _read_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def main(argv: list[str] | None = None, provider: LLMProvider | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare the Bangla strategies for a blind review.")
    parser.add_argument("--model", default=settings.LLM_MODEL)
    parser.add_argument("--cases", type=int, default=15)
    parser.add_argument("--html-only", action="store_true", help="rebuild the page from saved outputs")
    parser.add_argument("--out-dir", type=Path, default=RESULTS)
    parser.add_argument("--html", type=Path, default=HTML)
    parser.add_argument("--key", type=Path, default=KEY)
    parser.add_argument("--testset", type=Path, default=TESTSET)
    args = parser.parse_args(argv)

    cases = bangla_cases(args.cases, args.testset)
    safe_model = "".join(c if c.isalnum() or c in ".-" else "-" for c in args.model)
    csv_path = args.out_dir / f"bangla_{safe_model}.csv"
    rows = _read_rows(csv_path)

    if not args.html_only:
        if provider is None:
            ollama = OllamaProvider(model=args.model, timeout_s=max(settings.LLM_TIMEOUT_S, 120))
            health = ollama.health()
            if not health.reachable:
                print(f"Ollama is not reachable at {ollama.url} ({health.error}). Start the Ollama app.")
                return 1
            provider = ollama
        try:
            print(f"Loading {args.model}...", flush=True)
            provider.warm_up(args.model)
        except LLMError as error:
            print(f"Could not load {args.model}: {error}")
            return 1
        args.out_dir.mkdir(parents=True, exist_ok=True)
        done = {(row["case_id"], row["strategy"]) for row in rows}
        for number, case in enumerate(cases, start=1):
            for strategy in BANGLA_STRATEGIES:
                if (case["id"], strategy) in done:
                    continue
                row = run_case(case, strategy, provider, args.model)
                new_file = not csv_path.exists()
                with csv_path.open("a", encoding="utf-8", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=COLUMNS)
                    if new_file:
                        writer.writeheader()
                    writer.writerow(row)
                rows.append(row)
                print(
                    f"[{number}/{len(cases)}] {case['id']} {strategy:9}: {row['latency_s']} s, "
                    f"retries {row['retries']}" + (", TEMPLATE" if row["fallback_used"] and strategy != "template" else ""),
                    flush=True,
                )

    args.html.write_bytes(build_html(cases, rows, args.model).encode("utf-8"))
    write_key(cases, args.key)
    print(f"\nWrote {args.html} and {args.key} (open the key only after rating).")
    for strategy in BANGLA_STRATEGIES:
        found = [row for row in rows if row["strategy"] == strategy]
        if found and strategy != "template":
            fallback = sum(str(row["fallback_used"]) == "True" for row in found)
            print(f"  {strategy:9}: {len(found)} cases, template needed in {fallback}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
