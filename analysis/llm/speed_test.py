"""How fast each local model reads a feedback prompt and writes an answer, on this laptop.

Run from the repository root, with the Ollama app running:

    server\\.venv\\Scripts\\python.exe analysis\\llm\\speed_test.py

For each candidate model (LLM_MODELS_CANDIDATES in server/.env): one warm-up call to load it, then
3 runs of a SHORT prompt and 3 runs of a LONG prompt (about 1,500 tokens of realistic session
facts and instructions, asking for about 350 tokens of JSON, like a real report). Writes
analysis/llm/speed.csv and prints a table per model: prompt tokens, prompt reading rate
(tokens/s), writing rate (tokens/s), total seconds for the long prompt, and whether the JSON
parsed.

The facts are synthetic: no patient data.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app.core.config import settings  # noqa: E402
from app.feedback.llm import LLMError, OllamaProvider  # noqa: E402

SHORT_SYSTEM = "You answer with JSON only."
SHORT_USER = 'Reply with {"ok": true, "word": "<one encouraging word>"}.'
SHORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}, "word": {"type": "string"}},
    "required": ["ok", "word"],
}

#: Synthetic session facts in the shape of GET /api/sessions/{id}/facts.
FACTS: dict[str, Any] = {
    "session_id": 412,
    "patient_code": "P007",
    "session_no": 9,
    "language": "en",
    "affected_side": "left",
    "duration_min": 27,
    "baseline_available": True,
    "games": {
        "reach_activate": {"trials": 20, "success_rate": 0.75, "level_start": 4, "level_end": 5},
        "balloon_pop": {"trials": 18, "success_rate": 0.67, "level_start": 3, "level_end": 3},
        "bloom": {"trials": 15, "success_rate": 0.8, "level_start": 5, "level_end": 6},
        "grip_hold": {"trials": 8, "success_rate": 0.5, "level_start": 4, "level_end": 3},
    },
    "metrics": [
        {"id": "K1", "name": "Reach area", "value": 1.84, "baseline": 1.52, "unit": "SW²", "change_mdc": 1.6, "mdc_status": "improved"},
        {"id": "K6", "name": "Movement time", "value": 1180, "baseline": 1420, "unit": "ms", "change_mdc": 1.2, "mdc_status": "improved"},
        {"id": "K7", "name": "Path efficiency", "value": 0.81, "baseline": 0.79, "unit": "share", "change_mdc": 0.3, "mdc_status": "no_detectable_change"},
        {"id": "K8", "name": "Smoothness (SPARC)", "value": -2.1, "baseline": -2.3, "unit": "SPARC", "change_mdc": 0.5, "mdc_status": "no_detectable_change"},
        {"id": "R1", "name": "Shoulder raise forward", "value": 74, "baseline": 66, "unit": "deg", "change_mdc": 1.1, "mdc_status": "improved"},
        {"id": "H1", "name": "Hand opening range", "value": 0.31, "baseline": 0.33, "unit": "palm", "change_mdc": -0.4, "mdc_status": "no_detectable_change"},
        {"id": "H3", "name": "Grip steadiness", "value": 0.09, "baseline": 0.07, "unit": "share", "change_mdc": -1.3, "mdc_status": "worse"},
        {"id": "G1", "name": "Overall game success rate", "value": 0.71, "baseline": 0.62, "unit": "share", "change_mdc": 1.4, "mdc_status": "improved"},
    ],
    "directions": {"weak": [90, 135], "strong": [0, 315]},
    "flags": {"compensation_rate": 0.12, "fatigue_flag": False, "hand_loss_pct": 4},
    "self_report": {"pain_0_10": 1, "fatigue_0_10": 4, "enjoyment_1_5": 4},
    "adherence": {"sessions_this_week": 3, "planned_this_week": 5},
    "next_session": {
        "focus_movements": ["grip", "hand_opening"],
        "focus_directions": [90],
        "planned_games": ["bloom", "reach_activate", "grip_hold", "fruit_catch"],
    },
    "safety_notice_present": False,
}

LONG_SYSTEM = """You write short, warm, honest feedback for a person practising arm and hand
movements at home after a stroke, using a research prototype called MuVi Rehab. It is not a
medical device. You are given verified facts as JSON. Every number and every judgement of
better or worse has already been decided by tested code; you only put them into plain words.

Rules:
1. Use only the facts given. Never invent a number, a body part, a game or a result.
2. Say "improved" only for measures whose mdc_status is "improved"; say "worse" only for
   "worse"; for "no_detectable_change" say it stayed about the same; for "no_baseline" say there
   is not enough history yet.
3. Never give medical advice, a diagnosis, a medicine, or a prediction of recovery. Do not say
   the person is healing, cured or recovering.
4. Write for someone tired, possibly older, reading on a laptop: short sentences, everyday
   words, no jargon. Do not mention SPARC, MDC, baselines or units like SW².
5. Be kind and honest: celebrate real progress, name one thing that stayed the same or got
   harder without blame, and suggest only the focus given in next_session.
6. Do not mention the patient code or the session id. Address the person as "you".
7. Do not repeat the same idea twice. Keep the whole answer under 170 words.
8. If safety_notice_present is true, do not write any safety advice yourself; the app adds a
   fixed notice.

Write JSON with:
- "summary": two or three sentences about today's session as a whole;
- "highlights": two to four short sentences, each about one measure or game from the facts;
- "next_focus": one or two sentences about what the next session will practise;
- "encouragement": one warm closing sentence."""

LONG_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "highlights": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 4},
        "next_focus": {"type": "string"},
        "encouragement": {"type": "string"},
    },
    "required": ["summary", "highlights", "next_focus", "encouragement"],
}


def long_user() -> str:
    return (
        "Here are today's facts as JSON. Write the feedback described in your instructions, "
        "about 300 words of JSON in total.\n\n"
        + json.dumps(FACTS, indent=2, ensure_ascii=False)
        + "\n\nMeasure names in plain words: Reach area = how far you can reach around you; "
        "Movement time = how quickly you reach a target; Path efficiency = how direct your "
        "reaching path is; Smoothness = how smooth your movement is; Shoulder raise forward = "
        "how high you can lift your arm in front; Hand opening range = how wide you can open "
        "your hand; Grip steadiness = how steadily you can hold a squeeze; Overall game success "
        "rate = the share of game turns you completed. Directions: 0 is out to the side, 90 is "
        "up, 135 is up and across, 315 is down and out."
    )


def run_once(provider: OllamaProvider, model: str, kind: str) -> dict[str, Any]:
    system, user, schema = (
        (SHORT_SYSTEM, SHORT_USER, SHORT_SCHEMA) if kind == "short" else (LONG_SYSTEM, long_user(), LONG_SCHEMA)
    )
    started = time.perf_counter()
    try:
        result = provider.generate(system, user, schema, model=model)
    except LLMError as error:
        return {
            "model": model,
            "kind": kind,
            "error": str(error)[:200],
            "total_s": round(time.perf_counter() - started, 2),
            "json_ok": False,
        }
    try:
        json_ok = isinstance(json.loads(result.text), dict)
    except ValueError:
        json_ok = False
    return {
        "model": model,
        "kind": kind,
        "prompt_tokens": result.prompt_tokens,
        "output_tokens": result.output_tokens,
        "prompt_rate_tps": round(result.prompt_rate, 1) if result.prompt_rate else None,
        "gen_rate_tps": round(result.output_rate, 1) if result.output_rate else None,
        "total_s": round(result.latency_ms / 1000, 2),
        "json_ok": json_ok,
        "error": "",
    }


def median(values: list[Any]) -> float | None:
    found = [v for v in values if isinstance(v, int | float)]
    return round(statistics.median(found), 1) if found else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Speed of each local model on feedback prompts.")
    parser.add_argument("--models", help="comma-separated; default LLM_MODELS_CANDIDATES")
    parser.add_argument("--runs", type=int, default=3, help="runs of each prompt (default 3)")
    parser.add_argument("--out", type=Path, default=ROOT / "analysis" / "llm" / "speed.csv")
    args = parser.parse_args(argv)
    models = [m.strip() for m in args.models.split(",")] if args.models else settings.llm_candidates

    print("Tip: run `ollama ps` in another PowerShell window during the test to see how much of")
    print("each model is on the GPU and how much on the CPU (the PROCESSOR column).\n")

    provider = OllamaProvider(timeout_s=max(settings.LLM_TIMEOUT_S, 180))
    health = provider.health()
    if not health.reachable:
        print(f"Ollama is not reachable at {provider.url} ({health.error}). Start the Ollama app.")
        return 1
    rows: list[dict[str, Any]] = []
    for model in models:
        if not any(model == name or f"{model}:latest" == name for name in health.models_available):
            print(f"{model}: not installed (ollama pull {model}); skipped.")
            continue
        print(f"{model}: loading...", flush=True)
        started = time.perf_counter()
        try:
            provider.warm_up(model)
        except LLMError as error:
            print(f"  could not load: {error}")
            continue
        print(f"  loaded in {time.perf_counter() - started:.1f} s", flush=True)
        for kind in ("short", "long"):
            for run in range(1, args.runs + 1):
                row = {"run": run, **run_once(provider, model, kind)}
                rows.append(row)
                print(
                    f"  {kind:5} run {run}: {row['total_s']:6.1f} s, "
                    f"{row.get('gen_rate_tps') or '-'} tok/s writing, JSON {'ok' if row['json_ok'] else 'FAILED'}"
                    + (f" ({row['error']})" if row.get("error") else ""),
                    flush=True,
                )

    if not rows:
        print("No model was tested.")
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    columns = ["model", "kind", "run", "prompt_tokens", "output_tokens", "prompt_rate_tps", "gen_rate_tps", "total_s", "json_ok", "error"]
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print("\nLong prompt (median of the runs):")
    header = f"{'model':14} {'prompt tok':>10} {'read tok/s':>10} {'write tok/s':>11} {'total s':>8} {'JSON ok':>8}"
    print(header)
    print("-" * len(header))
    for model in dict.fromkeys(row["model"] for row in rows):
        long_rows = [row for row in rows if row["model"] == model and row["kind"] == "long"]
        ok = sum(bool(row["json_ok"]) for row in long_rows)
        print(
            f"{model:14} {median([r.get('prompt_tokens') for r in long_rows]) or '-':>10} "
            f"{median([r.get('prompt_rate_tps') for r in long_rows]) or '-':>10} "
            f"{median([r.get('gen_rate_tps') for r in long_rows]) or '-':>11} "
            f"{median([r.get('total_s') for r in long_rows]) or '-':>8} "
            f"{ok}/{len(long_rows):>6}"
        )
    print(f"\nSaved {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
