# Day 15 test report (the LLM feedback module, part 2)

Date: 2026-11-13. Nothing in this report failed at the end of the review. **MANUAL** means a person still has to check it; it has not been confirmed yet. **PENDING** means it waits for runs with the real model or for the native-speaker review.

## Automated results

| Check | Result |
| --- | --- |
| `pytest` | 1,076 passed, 1 warning (`httpx` deprecation) |
| `pytest --cov=app --cov=scripts` | **98%** of 8,517 statements (1,073 tests; the review's last 3 tests were added after this run) |
| `npm test` (Vitest) | 1,239 passed (112 files) |
| `npm run lint` | No problems |
| `npx prettier --check src` | No problems |
| `npm run build` | Succeeds, with the chunk size warning (1,566 kB, 443 kB gzipped) |
| `scripts/smoke_test.py` | 65 steps pass in-process under `pytest` (with a running report worker and the mock model); **not yet run against a live server** |
| `analysis/llm/eval_bangla.py` | Tested with the mock model; **not run on the real model** |

The model is mocked in every unit test. A guard in `tests/conftest.py` fails any test that tries to reach a real Ollama.

### Coverage of today's server code

| File | Coverage |
| --- | --- |
| `app/feedback/prompt.py`, `schemas.py`, `names.py`; `app/models/llm_report.py`, `review.py`; `app/schemas/review.py` | 100% |
| `app/feedback/review.py`, `rules.py`, `validate.py`, `fallback.py`; `app/schemas/feedback_report.py` | 99% |
| `app/feedback/jobs.py`, `service.py` | 97% |
| `app/feedback/store.py` | 99% in the report tests |
| `app/api/feedback.py` | 98% |
| `app/api/review.py` | 92% |

Code run by the report worker thread is measured unevenly across full runs: one run gave `store.py` 83% and `app/api/feedback.py` 98%, an earlier one 94% and 81%. The figures above come from running the report tests on their own.

## Day 15 requirements

| Requirement | How checked | Result | Notes |
| --- | --- | --- | --- |
| One GPU job at a time | pytest: `test_only_one_job_runs_at_a_time` (6 jobs, at most 1 running) | PASS | |
| Patients' reports go before review reports | pytest: `test_patients_reports_go_before_review_reports` | PASS | |
| Reports never block the summary page | Vitest: `summaryFeedback.test.tsx` (the summary shows while the report is prepared, and after an error) | PASS | New in this review |
| Safety notices first, fixed, shown once | Vitest: `shows the safety notices before everything else`, `puts the fixed stop notice first while preparing, then the report's notice instead`; pytest: `test_red_flag_sessions_never_contain_model_written_safety_text`; smoke step "The questionnaire's report is written, with the fixed stop notice" | PASS | |
| Model text rendered as plain text | Vitest: `renders the model's text as plain text, never HTML`, `never renders HTML from the model` (no `innerHTML` in the feedback code), and the blind review's escaping | PASS | |
| Patients only see their own reports | pytest: `test_other_patients_get_404`, `test_patients_never_reach_review_reports` | PASS | The second was fixed in this review |
| Patients never get the therapist summary, raw output or validation errors | pytest: `test_a_report_is_queued_written_and_read`; Vitest: `never shows the therapist summary to the patient` | PASS | |
| Bangla files marked for review | pytest: `test_every_bangla_file_is_marked_for_review`, `test_every_bangla_content_file_is_marked_for_review` | PASS | 13 tips, banned list, template sentences, notices |
| The template works with Ollama closed | pytest: `test_the_template_is_used_at_once_when_ollama_is_closed` (a refused connection: one call, no retries, English and Bangla, all strategies); `test_the_template_is_used_when_the_model_is_unreachable` | PASS | New in this review |
| The facts snapshot is stored with each report | pytest: `test_every_finished_report_stores_its_facts_snapshot`; review sets share one snapshot (`test_a_set_has_both_versions_of_each_session_from_the_same_facts`) | PASS | |
| No names, emails or comments in prompts | pytest: `test_no_names_emails_or_comments_in_any_prompt_bangla_included` (English, Bangla direct, Bangla translate) | PASS | New in this review |
| Jobs: queue, reuse, regenerate, fallback, failure, restart recovery, trigger | pytest: `test_feedback_api.py` (19 tests), plus `test_a_report_being_written_is_never_queued_twice`, `test_two_requests_at_once_share_one_report`, `test_a_job_that_is_not_queued_is_left_alone` | PASS | The last three are new in this review |
| Bangla: digits, script, banned words, strategies (translate keeps numbers), template always validates | pytest: `test_feedback_bangla.py` | PASS | |
| Blind review: blinding, shuffling, kappa, CSV | pytest: `test_report_review.py` (14 tests) | PASS | |
| Model quality targets, Bangla strategy choice, blind review results | `compare_models.py`, `eval_bangla.py`, the review tool | **PENDING** | |

## Review findings

| Finding | Severity | Action |
| --- | --- | --- |
| A patient could open, or rate, a blind-review report of their own session by guessing its id (review reports are kept apart from patients' reports) | Medium | Fixed: review reports answer `404` to patients; test added |
| A request while a report was being written, two simultaneous requests, and jobs that are not queued had no tests | Low | Tests added; no fault found |
| `store.count_waiting` was never used | Low | Removed |
| Coverage of code run by the worker thread varies between full runs (`store.py` 83–94%, `app/api/feedback.py` 81–98%) | — | A measurement effect; on their own the report tests cover 99% and 98% |
| The smoke test could not see a report being written under `pytest`, because the shared test client leaves jobs queued | — | The smoke test's pytest wrapper now uses a file database with a running worker |
| A direct Bangla answer may hit the 700-token output limit | — | Known issue; `eval_bangla.py` will show whether it does |

## Smoke test against a live server

Not run in this review; run it yourself, with the mock model so the reports take seconds:

```powershell
# Terminal 1
cd server; $env:LLM_PROVIDER="mock"; $env:LLM_BN_STRATEGY="template"; .venv\Scripts\python.exe -m uvicorn app.main:app
# Terminal 2
cd server; .venv\Scripts\python.exe scripts\smoke_test.py
```

Expected: 65 lines starting with PASS, then "All steps passed", exit code 0. The new steps:

- `PASS  The questionnaire's report is written, with the fixed stop notice`
- `PASS  Admin reads the report, its facts snapshot and the list`
- `PASS  Patient lists the report and rates it once`
- `PASS  A Bangla report is written in Bangla`
- `PASS  Feedback health answers`

The environment variables last for that terminal only. Close it before running the app with the real model.

## Manual checklist

Before you start:
- The Ollama app is running and `LLM_PROVIDER=ollama` is set in `server/.env`.
- The demo data is seeded: `cd server; .venv\Scripts\python.exe scripts\seed_demo_data.py`.
- The server and web app are started (`uvicorn ... --reload`; `npm run dev`).
- To find session ids: `cd server; .venv\Scripts\python.exe -m app.feedback.cli --list`.

### Patient

- [ ] **Normal report:**
  - As your own test patient, play a short session to the end, with pain 0–2 in the cool-down.
  - The summary appears at once, with the calm "Preparing your personal feedback…" card.
  - Within about 30 s, "Your feedback" shows a summary, highlight cards, 1–3 tip cards, "Next time:" and the disclaimer.
  - There are no metric ids, "MDC" or numbers that are not in your results.
- [ ] **Pain 5:**
  - Play another session and answer pain 5.
  - The stop notice ("Please stop practising for today …") is the first thing on the summary, above "Well done", and appears only once, before and after the report arrives.
  - The report itself never mentions pain, doctors or emergencies, and suggests no extra practice.
- [ ] **First session:** a new patient's first report says there is not enough history yet, with no "improved" or "worse".
- [ ] **Ollama closed:**
  - Quit the Ollama app and finish a session.
  - The report arrives within seconds and looks like a normal report, with no error wording.
  - Admin shows it as "Template", with the problem "Is the Ollama app running?".
  - Start Ollama again.
- [ ] **Bangla toggle and font:**
  - On the summary's feedback card, press বাংলা: the preparing card shows, then the Bangla report.
  - It is in Noto Sans Bengali: DevTools → Network shows one `Noto+Sans+Bengali` stylesheet, loaded only now (none on an English-only page).
  - English brings the English report back.
  - With a pain-5 session, the notice at the top switches to Bangla.
- [ ] **Read aloud, both languages:**
  - Read aloud reads the notices, then the report; Stop stops it.
  - In Bangla, the button appears only if Windows has a Bangla voice (Settings → Time & language → Speech → Add voices).
- [ ] **Print:** Print / save as PDF opens the print dialog without the buttons or the rating form.
- [ ] **Rating:** 4 stars and a comment, then Send, shows "Thank you for your answer." Pressing Send again on reload also says thanks (already rated).
- [ ] **Reports pages:**
  - `/patient/reports` lists each report with its session number, date, EN or বাংলা badge, preview, and "Includes an important note" for the pain-5 one.
  - Read opens the same layout as the summary, with the language toggle.
  - Home's "Latest feedback" links to the newest one.

### Admin

- [ ] **Reports tab:**
  - Patient → Reports lists every version: status, model, time and ratings.
  - Show opens the patient's view beside the therapist summary.
  - It also shows how the report was made: model, prompt version, retries, template used, time, tokens, each attempt's validation errors and the model output.
  - Your rating shows under Ratings.
- [ ] **Regenerate:** the toast appears, a new version is written, and the old one shows "Older version". The session page shows the same report.
- [ ] **System:** Feedback model shows provider, model, Reachable Yes, Model loaded Yes and Reports waiting. With Ollama closed it shows Reachable No within 10 s.
- [ ] **Blind review results:**
  - Research → Open the review tool. Create a set of 4 sessions; "Writing reports" counts up to 8 of 8 (about 2 minutes), then "Ready to rate".
  - Rate every code. Nothing says LLM, template or the model.
  - Log in as a second admin and rate them too.
  - Results show three rows (LLM all, LLM model-written, Template) with means, SDs and % unsafe, and a kappa row per dimension for the two raters.
  - Export CSV downloads the ratings with their versions.
  - While a set is being written, a patient's own report still arrives first.
