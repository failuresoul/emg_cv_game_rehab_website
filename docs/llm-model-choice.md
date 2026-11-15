# The feedback model

**The model for v1.0:** `qwen3.5:4b`, served by Ollama on the same computer. It is set by `LLM_MODEL`, the server's default, and pulled by `docker compose --profile ollama` (`ollama-pull`). Native installs pull it with `ollama pull qwen3.5:4b`.

## Why this model

- **It fits:** a 4B model runs on a laptop GPU (or, slowly, the CPU). Its JSON-schema output (Ollama's `format`) keeps answers in the report's shape.
- **The text is checked:** every report is validated against the session's facts, and falls back to a template when it fails (`docs/ai-engine.md`). So a smaller model is enough for the text.
- **The other candidates:**
  - **Which:** `LLM_MODELS_CANDIDATES` (`qwen3.5:2b`, `phi4-mini`), compared by `analysis/llm/speed_test.py` and `analysis/llm/compare_models.py`.
  - **Status:** the evaluation (`docs/llm-evaluation.md`) is **PENDING**. Confirm the choice, or change `LLM_MODEL`, when it is done.

## Licence

- **The model is not part of MuVi Rehab:** Ollama downloads it from its library.
- **Before release:** check its licence and acceptable-use terms on its model card ([THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) marks this to verify).

## Changing the model

1. Set `LLM_MODEL` in `server\.env`, and in the `.env` next to `docker-compose.yml` for the pull.
2. Pull it (`ollama pull <model>` or `docker compose --profile ollama up -d`).
3. Run `analysis/llm/run_eval.py` again before relying on it.
