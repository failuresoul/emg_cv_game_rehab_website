# LLM feedback module

Turns a session's verified facts into a short, warm, honest report for the patient, with a local language model in the Ollama app.

**The code calculates, the rules decide, the LLM only writes.**
- **Tested code** produces every number, every improved or worse judgement, every allowed suggestion and every safety warning.
- **The model** only puts verified facts into words; it receives the session facts JSON only, never names, emails or free-text comments.
- **A validator** checks every answer. After two failed retries a template report is used.
- **Safety notices** are fixed, approved text, never written by the model.

| File | What it does |
| --- | --- |
| `llm.py` | Providers: `OllamaProvider` (POST `/api/chat`, structured JSON output, timings, health, warm-up) and `MockProvider` (tests) |

Settings are in `server/.env` (`LLM_PROVIDER`, `OLLAMA_URL`, `LLM_MODEL`, …; see `.env.example`). Tests always use the mock. Speed of each local model: `analysis/llm/speed_test.py`.
