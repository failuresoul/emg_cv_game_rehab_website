# MuVi Rehab: guide for therapists and researchers

This guide covers the admin area of MuVi Rehab v0.1: managing patients, weekly goals, reviewing sessions and progress, handling safety alerts, and using demo data.

Log in with the admin account from `server/.env` (`ADMIN_EMAIL` and `ADMIN_PASSWORD`). You land on the **Overview**.

## Overview

The **Overview** page shows:

- **Four counts:** total patients, active patients, sessions today (since midnight UTC) and **open alerts**.
- **Recent patients:** the five most recently added, each linking to their page.
- **Alerts:** sessions flagged by the cool-down questionnaire that nobody has reviewed yet (see [Alerts](#alerts)).
- **Recent sessions:** every patient's latest sessions, with date, score and status. Click one to open its session page.

## Managing patients

Open **Patients** in the menu.

- **Search** by name, email or patient code.
- **Add patient:** enter email, full name, a password (at least 8 characters), affected side, dominant side, age band, and optionally months since stroke, language (English or Bangla) and notes. The patient gets the next code (`P001`, `P002`, …). Give them their email and password.
- **Open a patient** with **View** at the end of their row.

On a patient's page:

- **Edit** changes their details, or sets a new password if they forgot theirs.
- **Deactivate** stops them from logging in, without deleting anything. **Activate** lets them in again.
- Patients marked **Demo** are synthetic (see [Demo data](#demo-data)).

> The affected side matters: every reach and movement is measured from the affected shoulder. Change it only if it was entered wrongly, because sessions recorded before then were measured from the other side.

## Weekly goals

Each patient has a **weekly goal**: how many sessions a week they aim to complete. The default is 5.

1. Open the patient. The **Overview** tab shows the **Practice** section.
2. Next to **Weekly goal**, click **Change**, enter a whole number from 1 to 14, and click **Save**.

The patient sees the goal as a ring on their home page ("3/5"). Weeks run from Monday to Sunday in the patient's own time zone.

The **Practice** section also shows **sessions this week**, the **streak** (days in a row with a completed session) and the **last session** date.

## Sessions

On a patient's page, the **Sessions** tab lists every session, newest first, with date, status, duration, reach area, warm-up and games. Click one to open its **session page**, which shows:

- **Details:** patient, date, status (**Completed**, **Active** or **Aborted**), duration and device (browser, frame rate, GPU or CPU).
- **Reach map:** the calibration from that session.
- **Cool-down questionnaire:** pain, tiredness, enjoyment, difficulty, whether anything new or unusual was noticed, the comment, and any **safety flags**. For a flagged session, its review status and note.
- **Warm-up:** each exercise with its target, full reps, best value, compensation and personalisation decision.
- **One card per game:**
  - the reach map of targets coloured by outcome (for Reach and squeeze and Balloon pop), or a strip of fruit positions (for Fruit catch);
  - a table of every trial;
  - a movement-time chart.

A session marked **Aborted** was stopped with **Exit**, replaced with **Start over**, or left open for more than 2 hours.

## Progress

On a patient's page, the **Progress** tab shows:

- **Latest reach map**, with the previous one dashed, and a table of reach per direction with the change.
- **Reach area over time.**
- **Warm-up:** a chart per exercise of the best value against the target, and the personalisation decisions.

The patient sees simpler versions of these on their home and **Progress** pages.

## Alerts

The cool-down questionnaire flags a session for review when:

| Flag | When |
| --- | --- |
| **Pain** | Pain is 4 or more out of 10 |
| **Something new or unusual** | The patient said they noticed something new or unusual in their body |
| **Very tired** | Tiredness is 8 or more out of 10 |

> These thresholds are provisional and must be confirmed with the supervisor. They are in one place in the code, `server/app/services/safety.py`.

For **Pain** or **Something new or unusual**, the patient's summary shows a fixed notice: stop practising for today, tell the therapist, and call emergency services for signs of stroke. MuVi Rehab gives no other medical advice.

**To review an alert:**

1. On the **Overview**, find it under **Alerts**. Click the patient code to open the session and read the answers.
2. Click **Mark reviewed**, add an optional note (for example, "Phoned the patient, pain settled"), and click **Mark reviewed** again.

The alert leaves the list, the **open alerts** count goes down, and the session page shows when it was reviewed and the note. You can also mark it reviewed from the session page.

## Demo data

To show the dashboards without weeks of real practice, create two demo patients with two weeks of synthetic sessions. From `server/`, with the virtual environment active:

```sh
python scripts/seed_demo_data.py          # remove old demo patients, then create them again
python scripts/seed_demo_data.py --clear  # only remove demo patients and all their data
```

| Patient | Email | What their data shows |
| --- | --- | --- |
| Demo Rahim | `demo.rahim@example.com` | Left side affected. 8 sessions, steady improvement in reach, warm-up goals and games. |
| Demo Salma | `demo.salma@example.com` | Right side affected. 6 sessions, slower progress, and one unreviewed pain alert. |

- **Passwords:** the script prints new passwords each time it runs. Save them.
- **Same data every run:** the data comes from a fixed seed, so it is identical each time; only the dates follow today's date.
- **Safety:** only patients marked **Demo** are ever removed. If a real patient already uses a demo email, the script stops without changing anything.
- **Research exports:** demo patients are synthetic. Leave them out of any analysis.

## Not in v0.1

The **Games**, **Research** and **System** pages, and a patient's **Programme** and **Reports** tabs, are placeholders. Personal feedback reports, adaptive difficulty and EMG input come in later versions.
