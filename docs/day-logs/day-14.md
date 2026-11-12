# Day 14

**The LLM feedback module, part 1 (server side).** After each session, a small local language model writes a short report for the patient and a technical summary for the therapist.

The principle: **the code calculates, the rules decide, the LLM only writes.**
- Tested code makes every number and judgement.
- Rules choose what may be suggested and which safety notices apply.
- A validator checks every answer, and a template report takes over when the model fails.

See [ai-engine.md, "LLM feedback"](../ai-engine.md#llm-feedback-serverappfeedback).

## What was built

- **Provider** (`server/app/feedback/llm.py`):
  - `OllamaProvider`: `/api/chat` with the JSON schema as `format`, `think` off (retried and remembered for models that refuse it), options, `keep_alive`, timings, `health()` and `warm_up()`;
  - `MockProvider` for tests;
  - settings in `.env` (`LLM_PROVIDER`, `OLLAMA_URL`, `LLM_MODEL`, candidates, temperature, context, limits).
- **Speed test** (`analysis/llm/speed_test.py`): each candidate model on a short and a 1,500-token prompt.
- **Rule layer:**
  - `catalogue.yaml` with 13 suggestion types;
  - `rules.py` with `candidates`, `red_flags` and `facts_for_llm`;
  - approved tips in `kb/en` and `kb/bn`.
  - Safety notices come from `shared/safety-notices.json`, which a web test ties to the app's wording.
  - The facts gained the questionnaire's flag codes and a shoulder-compensation rate.
- **Report generation:**
  - `schemas.py`: the report and its Ollama schema;
  - `prompts/` and `prompt.py`: versioned prompts, two checked examples, compact JSON;
  - `validate.py`: 8 kinds of check;
  - `fallback.py`: the template report;
  - `service.py`: `generate_report` and `generate_report_from_facts`, with 2 retries and the template;
  - `cli.py`: one report as JSON, or `--list` to find sessions.
- **Evaluation** (`analysis/llm/`):
  - `make_testset.py`: 60 seeded synthetic cases;
  - `run_eval.py`: resumable, scores every answer the model wrote;
  - `compare_models.py`: writes `docs/llm-model-choice.md`.
- **Review (task 5):** see [the test report](day-14-test-report.md#review-findings).

## How to test

```powershell
# Every check
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run lint

# Ollama: is it running, and which models are there?
cd server; .venv\Scripts\python.exe -c "from app.feedback.llm import OllamaProvider; print(OllamaProvider().health())"

# Speed of each model (4-6 minutes)
server\.venv\Scripts\python.exe analysis\llm\speed_test.py

# Reports for demo sessions (seed first: cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py)
cd server; .venv\Scripts\python.exe -m app.feedback.cli --list
cd server; .venv\Scripts\python.exe -m app.feedback.cli <id>
cd server; .venv\Scripts\python.exe -m app.feedback.cli <id> --language bn

# Model comparison on the dev split (35-50 minutes; --limit 10 for about 10-15)
server\.venv\Scripts\python.exe analysis\llm\compare_models.py
```

- **Ollama:** the app must be running (http://localhost:11434), with the models pulled (`ollama pull qwen3.5:4b`, `qwen3.5:2b`, `phi4-mini`).
- **Settings:** `LLM_PROVIDER=ollama` in `server/.env`. Tests always use the mock.
- **Manual checks:** [the checklist in the test report](day-14-test-report.md#manual-checklist).

## Decisions

- **The model decides nothing.** Numbers, better/worse judgements, suggestions and safety notices come from tested code and approved text. The model only words them, and every answer is checked.
- **The model never sees a red flag.** It is told only that a notice exists; the app shows the fixed notice itself. The pain score is withheld too.
- **The template is the safety net.** After two failed retries, or at once when Ollama is down or too slow, the template report is used. It is plain but always correct.
- **Every model answer is scored,** retries included, because the final report always passes.
- **NEXT_FOCUS is always kept** among the candidates. Suggestions that ask for more practice are dropped under a red flag.
- **The safety notice uses the report's language,** whatever the profile language.
- **Bangla in the evaluation:** about a third of the test cases are in Bangla, so its quality is measured from the start.

## Known issues

- **The evaluation has not been run on the real models.** The model choice, the prompt versions v2/v3 and the "Results" part of the methods are pending.
- **Reports are generated on request, not stored.** Storage, with the model and prompt version, comes with the report API (Day 15).
- **Pattern-based checks:** the direction and leakage checks work on word lists, so an unknown paraphrase can slip through and an unusual harmless wording can force a retry.
- **Bangla text to review:** the 13 Bangla tips, the template sentences and the sharp-decline notice were written for this task and need a native speaker's check.
- **Unconfirmed thresholds:** shoulder relax (15%), the sharp decline (3 measures at 2 MDC) and the banned list.
- **qwen3.5:4b does not fit the 4 GB GPU** (about half on the CPU), so it is the slowest candidate.
- **PyYAML** comes with `uvicorn[standard]`, but `requirements.txt` does not pin it.

## Day 15 preview: the LLM feedback module, part 2

- **Report API:** generate, store and fetch a session's report (patients see only their own, admins all), with its model, prompt version and validation meta.
- **Summary page:** the patient's report under the session summary, with the fixed safety notice above it.
- **Reports page:** past reports for the patient; the therapist summary for admins.
- **Bangla:** reports in the patient's language.
- **Read-aloud:** the report spoken by the browser's speech synthesis.
