# Day 14 test report (the LLM feedback module, part 1)

Date: 2026-11-13. Nothing in this report failed at the end of the review. **MANUAL** means a person still has to check the requirement; it has not been confirmed yet. **PENDING** means it waits for the real model evaluation.

## Automated results

| Check | Result |
| --- | --- |
| `pytest` | 981 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **99%** of 7,448 statements |
| `npm test` (Vitest) | 1,205 passed (107 files), including `safetyNotices.test.ts` |
| `npm run lint` | No problems |
| `analysis/llm/speed_test.py` | Tested against a fake Ollama; **not run on the real models here** |
| `analysis/llm/compare_models.py` | Tested with the mock provider; **the real dev evaluation has not been run** |

The model is mocked in every unit test. A guard in `tests/conftest.py` fails any test that sends a real request to Ollama.

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/feedback/prompt.py`, `schemas.py`, `names.py` | 100% |
| `app/feedback/rules.py`, `validate.py`, `fallback.py` | 99% |
| `app/feedback/llm.py`, `service.py` | 97% |
| `app/feedback/cli.py` | 84% (the `__main__` entry and the missing-session path) |

## Day 14 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| The provider sends the schema as `format`, the options, `keep_alive` and `think=false`; retries once without `think` and remembers the model | pytest: `test_feedback_llm.py` (18 tests) | PASS | Ollama's HTTP API mocked |
| Timeouts, Ollama down and malformed answers give clear errors | pytest: `test_a_timeout_is_a_clear_error`, `test_ollama_not_running_is_a_clear_error`, `test_a_malformed_answer_is_surfaced` | PASS | |
| Every suggestion trigger, the order, the maximum of 5, evidence on every candidate | pytest: `test_feedback_rules.py` (42 tests) | PASS | |
| Red flags: pain, new symptoms, sharp decline; the model only told a notice exists | pytest: `test_pain_and_new_symptoms_use_the_day_7_stop_notice`, `test_sharp_decline_needs_three_key_measures_two_mdc_worse`, `test_the_model_is_only_told_a_notice_exists` | PASS | |
| The model receives only facts: no names, emails or comments | pytest: `test_the_model_never_sees_names_emails_or_comments` (a stored session with a name, an email and a comment) | PASS | New in this review |
| The validator runs on every output | pytest: `test_the_validator_checks_every_answer` | PASS | New in this review |
| Each bad answer is caught: invented number, wrong direction, unknown id, banned word, leakage, too long, wrong script | pytest: `test_feedback_validate.py` (28 tests) | PASS | |
| Retry with errors, then the template after two failures | pytest: `test_a_failed_answer_is_retried_with_its_errors`, `test_two_failed_retries_use_the_template` | PASS | |
| The template always validates | pytest: 20 random facts × 2 languages; all 60 test-set cases × 2 languages | PASS | The test-set check found the `paint_wall` fault below |
| Red-flag sessions never contain model-written safety text | pytest: `test_red_flag_sessions_never_contain_model_written_safety_text` | PASS | |
| Safety notices are fixed text from one shared source | pytest: `test_the_notice_wording_lives_only_in_the_shared_file`, `test_the_notices_come_back_unchanged_whatever_the_model_writes`; Vitest: `safetyNotices.test.ts` | PASS | The only copy outside the shared file is the web's i18n string, which the web test checks |
| The model and prompt version are stored with each result | pytest: `test_every_result_records_its_model_and_prompt_version`; `run_eval` CSV columns `model` and `prompt_version` | PASS | Storage in the database comes on Day 15 |
| The prompt fits a 4,096 context with room to answer | pytest: `test_the_prompt_fits_a_4096_context_with_room_to_answer` | PASS | About 3,000 tokens at most (estimated from characters); check `meta.prompt_tokens` on real runs |
| The few-shot examples pass the validator against their own facts | pytest: `test_the_fewshot_examples_are_checked_against_their_facts` | PASS | |
| Test set: 60 cases, categories, 40/20 split, seeded | pytest: `test_llm_eval.py` | PASS | |
| `run_eval` on 3 cases with the mock; resume; summary | pytest: `test_run_eval_on_three_cases_with_the_mock`, `test_run_eval_resumes_and_counts_failures` | PASS | |
| Quality targets on the dev split | `compare_models.py` | **PENDING** | Not yet run on the real models |

## Review findings

| Finding | Severity | Action |
| --- | --- | --- |
| The safety-leakage pattern `pain\w*` matched "Paint the wall" and `paint_wall`, so under a safety notice every report naming that game (and the template's therapist summary) failed | Medium | Fixed: whole words only; test added |
| Unit tests relied on `LLM_PROVIDER=mock` alone; a test building an `OllamaProvider` without a fake client could reach a running Ollama | Low | Fixed: a guard fails any real request to Ollama in tests |
| `run_eval` rows did not name their model and prompt version (only the file name did) | Low | Fixed: both are columns |
| Reports are not yet stored with their meta | — | Planned for Day 15 (report API) |
| Bangla tips, template sentences and the sharp-decline notice were written without a native-speaker review | Low | Known issue |

## Manual checklist

Before you start:
- the Ollama app is running, with `qwen3.5:4b` (or your chosen model) pulled;
- `LLM_PROVIDER=ollama` is set in `server/.env`;
- the demo data is seeded: `cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py`.

Then list the sessions: `cd server; .venv\Scripts\python.exe -m app.feedback.cli --list`. It shows each completed session's id, patient code, number, and whether it improved, has no baseline or raised a red flag.

### Ollama health

- [ ] Run `cd server; .venv\Scripts\python.exe -c "from app.feedback.llm import OllamaProvider; print(OllamaProvider().health())"`.
  - Expected: `reachable=True`, your models listed, `main_model_present=True`.

### A report for an improving session

- [ ] Take Demo Rahim's last session from the list (the line with the most "improved"), and run `cd server; .venv\Scripts\python.exe -m app.feedback.cli <id>`. The first call loads the model, about 20–40 s.
- [ ] Expected:
  - JSON with `report`, `safety_notices: []` and `meta`;
  - `meta.model` is your model, `prompt_version` is `v1`, and `fallback_used` is false (if true, `validation_errors` says why);
  - the patient summary is in short, plain sentences and mentions at least one improved measure in everyday words, with no ids or "MDC";
  - every number appears in the facts (compare with `GET /api/sessions/<id>/facts`, or the therapist summary);
  - the therapist summary is English, with measure ids, baseline -> latest and MDC changes.
- [ ] Repeat with `--language bn`: the patient text is in Bangla script; the therapist summary stays English.

### A red-flag session (pain 5)

- [ ] Take Demo Salma's session marked `RED FLAG: pain` and generate its report.
- [ ] Expected:
  - `safety_notices` holds exactly the stop notice ("Please stop practising for today and tell your therapist how you feel. …"), identical to the app's summary page;
  - the report itself never mentions pain, symptoms, doctors or emergencies, and suggests no extra practice;
  - with `--language bn`, the notice is the Bangla one.

### A first session

- [ ] Take a session marked `first sessions (no baseline)` (each patient's first or second).
- [ ] Expected:
  - the report makes no comparison: it says there is not enough history yet, and there are no "improved" or "worse" claims;
  - the highlights are empty or neutral.

### The fallback (Ollama closed)

- [ ] Quit the Ollama app (tray icon → Quit), then generate any report.
- [ ] Expected:
  - it returns at once with `meta.fallback_used: true`, `retries: 0`, and `provider_error` naming Ollama ("Is the Ollama app running?");
  - the report is the template: correct and plain, with the same `safety_notices` as before.
- [ ] Start Ollama again; the next report uses the model.
