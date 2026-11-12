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
| `catalogue.yaml` | The 13 suggestions the feedback may make: trigger, threshold, audience, priority and approved guidance |
| `rules.py` | `candidates(facts)`: the suggestions that apply (at most 5, safety first, each with evidence). `red_flags(facts)`: the fixed notices. `facts_for_llm(facts)`: what the model may see |
| `kb/en/<ID>.md` | One approved tip per suggestion, which the model may reword. Looked up by id; no search |

**Safety notices** come from `shared/safety-notices.json`, the one source of their wording. The web app's stop notice is checked against it by `web/src/features/session/safetyNotices.test.ts`. Red flags:
- `pain` and `new_symptoms` (the Day 7 stop notice);
- `sharp_decline`: three or more key measures worse by 2 MDC or more.

When one fires, suggestions asking for more effort are left out. The model is told only that a notice exists: it never sees the codes, the notice or the pain score.

Settings are in `server/.env` (`LLM_PROVIDER`, `OLLAMA_URL`, `LLM_MODEL`, …; see `.env.example`). Tests always use the mock. Speed of each local model: `analysis/llm/speed_test.py`.
