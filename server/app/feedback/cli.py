"""Print one session's feedback report and its meta as JSON.

    cd server
    .venv\\Scripts\\python.exe -m app.feedback.cli 12
    .venv\\Scripts\\python.exe -m app.feedback.cli 12 --model phi4-mini --language bn

Uses LLM_PROVIDER from server/.env (ollama: the Ollama app must be running).
"""

import argparse
import json
import sys

from app.feedback.service import as_json, generate_report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a session's feedback report.")
    parser.add_argument("session_id", type=int)
    parser.add_argument("--model", help="an Ollama model tag; default LLM_MODEL")
    parser.add_argument("--language", choices=["en", "bn"], default="en")
    args = parser.parse_args(argv)
    try:
        result = generate_report(args.session_id, args.language, args.model)
    except LookupError as error:
        print(error, file=sys.stderr)
        return 1
    # Bangla on a Windows console.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(as_json(result), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
