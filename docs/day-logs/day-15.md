# Day 15

**The LLM feedback module, part 2: the reports reach people.**
- Reports are written in the background and served through an API.
- The summary, the patient's Reports pages and the admin pages show them.
- They come in English and Bangla, can be read aloud and rated, and a blind review compares them with template reports.

The principle is unchanged: **the code calculates, the rules decide, the LLM only writes.** See [ai-engine.md, "LLM feedback"](../ai-engine.md#llm-feedback-serverappfeedback).

## What was built

- **Report API and jobs** (`app/api/feedback.py`, `feedback/store.py`, `feedback/jobs.py`):
  - **Storage:** `LlmReport` (report, notices, facts snapshot, candidates, model, prompt version, strategy, timings, validation errors, raw output; versions kept) and `ReportRating`.
  - **One worker,** so one generation runs on the GPU at a time, with patients' reports first.
  - **Limits:** per attempt, and 120 s per job; then the template.
  - **Restarts:** unfinished jobs are queued again at start-up, and the model warms up in the background.
  - **Trigger:** the questionnaire queues the report, and the job waits briefly for the session to end.
- **Web:**
  - the summary's "Your feedback" (preparing card, fixed notices first, report cards, disclaimer);
  - read aloud, print, and "Was this helpful?";
  - the patient's Reports list and detail, and "Latest feedback" on home;
  - admin: the Reports tab with validation info and Regenerate, the session's report, and LLM health on System.
- **Bangla:**
  - `LLM_BN_STRATEGY` (`direct`, `translate`, `template`);
  - Bangla tips, banned list, template sentences and notices, marked for native review;
  - a validator for Bangla script, banned words and Bengali digits;
  - `analysis/llm/eval_bangla.py`, a blind side-by-side comparison;
  - an English / বাংলা toggle, and Noto Sans Bengali loaded only when needed.
- **Blind human review:**
  - review sets of LLM and template reports from the same facts, under random codes;
  - the rubric;
  - results with weighted Cohen's kappa;
  - a CSV export;
  - the method in [llm-evaluation.md](../llm-evaluation.md) (RQ5).
- **Smoke test:** five new steps (report written with the stop notice, admin detail, rating, Bangla report, health).
- **Review (task 5):** see [the test report](day-15-test-report.md#review-findings).

## How to test

```powershell
# Every check
cd server; .venv\Scripts\python.exe -m pytest -q --cov=app --cov=scripts --cov-report=term
cd web; npm test; npm run lint; npm run build

# Smoke test against a live server with the mock model (two terminals)
cd server; $env:LLM_PROVIDER="mock"; $env:LLM_BN_STRATEGY="template"; .venv\Scripts\python.exe -m uvicorn app.main:app
cd server; .venv\Scripts\python.exe scripts\smoke_test.py

# The app with the real model (Ollama running; LLM_PROVIDER=ollama in server/.env)
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --reload
cd web; npm run dev

# Bangla strategies, for the native-speaker review (25-35 minutes on qwen3.5:4b)
server\.venv\Scripts\python.exe analysis\llm\eval_bangla.py
```

- **Database:** the new tables (`llmreport`, `reportrating`, `reviewset`, `reviewitem`) and columns are created on start; existing data is kept.
- **Manual checks:** [the checklist in the test report](day-15-test-report.md#manual-checklist).

## Decisions

- **The report is the job.** One row holds the job's state and the finished report, so a restart can pick up any unfinished job.
- **One worker, a priority queue.** The 4 GB GPU can run one generation at a time. Patients' reports go before review reports, so a 20-session review set never delays a patient's own report.
- **The facts are stored with each report,** as they were when it was written. A later recomputation never changes what a report was based on, and both versions in the blind review share one snapshot.
- **Safety notices first, and only once.** Until the report arrives, the summary shows the questionnaire's stop notice. The report's own fixed notices then replace it.
- **Patients never see** the therapist summary, the raw output, the validation errors or any blind-review report.
- **A template report looks exactly like a model's report.** It is correct and calm, with no error wording.
- **Blind review opens only once every report is written,** so a report still "being written" cannot give its version away.
- **Bangla:** "direct" is the default. "translate" checks that every number and id is preserved. The choice waits for the native-speaker review of `eval_bangla.py`.

## Known issues

- **Model results pending:**
  - the model comparison and prompt versions v2/v3 (Day 14);
  - the Bangla strategy comparison and its native-speaker review;
  - the blind human review.
- **Bangla wording to review:** every file marked "Needs review by a native speaker".
- **Bangla length:** a direct Bangla answer may hit the 700-token output limit; the Bangla evaluation will show whether it does.
- **Jobs are in-process:** they do not survive across several server processes. A stop re-queues unfinished jobs, so a report being written may be written twice.
- **Print** includes the page header and navigation.
- **The main web bundle** is about 1.55 MB (the build warns).

## Day 16 preview: EMG

EMG, the "Muscle" in MuVi Rehab, joins the webcam's tracking of the hand and arm. The details come with the Day 16 tasks.
