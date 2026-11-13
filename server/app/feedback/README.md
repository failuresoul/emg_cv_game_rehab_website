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
| `kb/en/<ID>.md`, `kb/bn/<ID>.md` | One approved tip per suggestion, which the model may reword. Looked up by id; no search |
| `schemas.py` | The `Report` (patient summary, up to 3 highlights, 1–3 suggestions, next-session text, English therapist summary), word limits, and the flat JSON schema given to Ollama as `format` |
| `prompts/` | Versioned prompts: `system_v1.txt`, `user_v1.txt`, and `fewshot/` (an improving and a mixed example, each checked against its facts by the tests) |
| `prompt.py` | Builds the prompt in compact JSON (about 3,000 tokens at most, for a 4,096 context) |
| `validate.py` | Every check: schema, word limits, numbers from the facts only, ids from the candidates, improved/worse words matching `mdc_status`, `banned.txt`, no safety text under a notice, sentence length, script |
| `fallback.py` | The template report from facts, candidates and tips; always passes the validator |
| `service.py` | `generate_report(session_id)` and `generate_report_from_facts(facts)`: prompt, model, validate, up to 2 retries with the errors, then the template |
| `store.py` | Stored reports (`LlmReport`, `ReportRating`): request (reuse, regenerate, supersede), run one job, finish, list for patients and admins, ratings |
| `jobs.py` | The background runner: one asyncio worker (one generation on the GPU at a time), restart recovery, the 120 s job limit; `/api` routes in `app/api/feedback.py` |
| `cli.py` | `python -m app.feedback.cli <session_id> [--model tag] [--language bn]` prints the report and meta as JSON |
| `names.py` | Plain names of measures, movements, directions and games in English and Bangla (the Bangla ones are the web app's) |

**Safety notices** come from `shared/safety-notices.json`, the one source of their wording. The web app's stop notice is checked against it by `web/src/features/session/safetyNotices.test.ts`. Red flags:
- `pain` and `new_symptoms` (the Day 7 stop notice);
- `sharp_decline`: three or more key measures worse by 2 MDC or more.

When one fires, suggestions asking for more effort are left out. The model is told only that a notice exists: it never sees the codes, the notice or the pain score.

Settings are in `server/.env` (`LLM_PROVIDER`, `OLLAMA_URL`, `LLM_MODEL`, …; see `.env.example`). Tests always use the mock. Speed of each local model: `analysis/llm/speed_test.py`.
