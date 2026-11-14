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

## Programme

Each patient has a **programme**: what they may do. The AI, the session planner and the warm-up always stay inside it. Open a patient and choose the **Programme** tab.

| Section | What you set | What follows it |
| --- | --- | --- |
| **Games** | Each game on or off, and its **highest level** (1 to 10). The line under the slider says what the level means: 1-3 gentle, 4-6 moderate, 7-9 challenging, 10 no limit. Games turned off in the Game Library cannot be turned on here. | The planner plans only these games; the patient cannot start any other; the AI never makes a game harder than its highest level. |
| **Session** | Minutes of games (10-40), the fewest and most games per session (2-6), and a rest every 3-10 minutes of play. | The planner's game count and length (the fewest on lighter days, after high fatigue, pain or "too hard"); the rest prompts in games. |
| **Warm-up** | Which of the six exercises, and **Personal** targets (from the patient's results) or **Always gentle**. | The warm-up shows only these exercises, with the chosen targets. |
| **AI** | The difficulty engine: L0 fixed, L1 staircase, L2 Bayesian. | New game runs. The safety rules always apply. |
| **Muscle sensor** | The default electrode site. | The muscle sensor step suggests it; the patient can change it. |
| **Goals and notes** | The weekly goal (1-14 sessions) and private notes. | The patient's weekly ring and reports. Notes are never shown to the patient. |

**To change it:** make the changes and click **Save programme**. The dialog lists every change (before → after) and asks for an optional **reason**; changing the AI engine also shows a warning. Click **Save**. Every changed field is kept in the **Change history** below, with your name, the time and the reason. **Undo changes** puts the form back before you save.

The weekly goal and engine can still be changed from the patient's **Overview** and **AI levels** tabs; those changes also go into the history.

## Research mode

**Research** in the menu holds the studies, the research consent and the data exports. Studies compare the difficulty engines in a controlled way; patients are never told which condition a session plays.

**Before a study: research consent.** Under **Research consent**, tick **Research consent recorded** for each patient who has given consent, and set the date. Only patients with consent can be enrolled.

**To create a study:** click **New study** and fill in:

- **Design:** **Within-subject** (every participant plays every condition, in an order from a balanced Latin square) or **Between-subject** (each participant plays one condition, from balanced randomisation).
- **Conditions:** two or three of L0, L1 and L2.
- **Sessions per condition:** completed sessions each participant plays in each condition.
- **Games:** the games every study session plays, in the order you turn them on.

**To run it:**

1. **Enrol** consenting patients. The order (or condition) is assigned automatically, in turn.
2. Click **Start study**. From now on, each new session of an enrolled patient plays the next condition: the condition replaces the programme's engine, and the plan is the study's games, which the patient cannot change. The programme's highest levels and the safety rules still apply.
3. Follow the **Participants and progress** table: sessions done per condition, and the next condition.
4. **Withdraw** a participant if needed: their next sessions follow their programme again; the data already collected stays in the results.
5. Click **Close study** at the end. Sessions go back to each programme. A closed study cannot be reopened.

**Results** show, per condition, the success rate, challenge error (how far the rolling success is from 70%), time in the 60-80% zone, compensation, mean level, enjoyment, fatigue and report ratings. Each bar is the mean over participants and its line the 95% confidence interval (from two participants on); a table gives the same numbers. **Download the study (CSV)** gives one row per trial, with patients by code only.

The design of a study can only change while it is a draft without participants.

## Alerts

Everything that needs a look is an **alert**. Open **Alerts** in the menu; the badge beside it shows how many are open. The **Overview** shows the open high and medium counts and the latest five; a patient's **Alerts** tab shows only theirs.

| Alert | Severity | Raised when |
| --- | --- | --- |
| **Pain** | High | The questionnaire's pain is 4 or more out of 10 |
| **New or unusual symptoms** | High | The patient noticed something new or unusual |
| **High fatigue** | Medium | Tiredness is 8 or more out of 10 |
| **Sharp decline** | High | Three key measures are much worse than usual (2 MDC or more) when a session ends |
| **Missed sessions** | Low | No completed session for 4 days or more (checked when the server starts and when the Overview loads) |
| **Repeated device problems** | Low | Three sessions in a row stopped early, had the muscle sensor pause, or ran the camera very slowly |
| **Many template reports** | Low | More than 30% of the last 10 feedback reports used the template (the language model may be down); a system alert, for no one patient |

> The thresholds are provisional and must be confirmed with the supervisor. The questionnaire's are in `server/app/services/safety.py`, the others in `server/app/services/alerts.py`.

For **Pain** or **New or unusual symptoms**, the patient's summary shows a fixed notice: stop practising for today, tell the therapist, and call emergency services for signs of stroke. MuVi Rehab gives no other medical advice.

**To deal with an alert:**

1. Filter the list if you like (**Open and acknowledged**, severity, type), and open the patient or the session from its links.
2. Click **Acknowledge** when you start dealing with it, with an optional note (for example, "Calling the patient today").
3. Click **Resolve** when it is dealt with, with an optional note. A resolved alert is closed for good.

On a session's page, **Mark reviewed** resolves all of that session's alerts at once and shows the note. The same cause never raises two alerts.

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

## Language and accessibility

- **Language:** the switch at the top of every page (English / বাংলা) is kept in your browser. A patient's choice is saved to their profile, and their reports follow it.
- **Patients' display settings** (text size, high contrast, reduce motion, sounds, spoken instructions) are their own, on their **Profile** page and in the session's **Display** button.
- **Keyboard:** every page starts with **Skip to content**; admin tables scroll sideways on small screens with the first column kept in view; charts have **View as table**.
