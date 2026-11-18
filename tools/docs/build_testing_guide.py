"""Builds docs/MuVi_Rehab_Testing_Guide.docx: a step-by-step manual testing guide (Day 20).

    .\\scripts\\docs\\make_testing_guide.ps1          (builds, fills the contents with Word, counts
                                                      pages and reads the guide back)
    tools\\docs\\.venv\\Scripts\\python.exe tools\\docs\\build_testing_guide.py [--check]

Every on-screen label is looked up by its key in web/src/i18n/en.ts (the build stops if a key is
missing, so a renamed button cannot leave the guide out of date). Numbers come from the code and
configs named beside them (the EMG settings from web/src/emg/emgSettings.json, the game specs from
shared/game-specs.json). Screenshots come from docs/images/screens/.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt, RGBColor

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_report import IMAGES, ROOT, TEAL, Report, load_facts  # noqa: E402
from report_content import GAME_NOTES  # noqa: E402

OUT = ROOT / "docs" / "MuVi_Rehab_Testing_Guide.docx"
SECTIONS = [
    "Before you start", "Start the app", "Landing page, language and accessibility", "Login, roles and logout",
    "Admin area", "A patient session with the real webcam", "AI checks", "LLM report", "Progress and dashboards",
    "Simulated EMG", "Replay mode (testing without moving)", "Validation tools (for later)",
    "Hardware day summary", "Error cases", "Troubleshooting and reporting a problem", "Final checklist before v1.0.0",
]  # fmt: skip


class Guide(Report):
    def __init__(self, facts: Any) -> None:
        super().__init__(facts)
        section = self.doc.sections[0]
        section.left_margin = section.right_margin = Cm(1.7)
        self.tests_total = 0
        self.thumbnails = 0
        self.missing_keys: list[str] = []
        footer = section.footer.paragraphs[0]
        for run in footer.runs:
            if "technical report" in run.text:
                run.text = run.text.replace("technical report", "testing guide")

    # Labels from the app

    def s(self, key: str) -> str:
        """An on-screen text, quoted, exactly as the app shows it in English."""
        value = self.facts.strings.get(key)
        if value is None:
            self.missing_keys.append(key)
            return f"[missing {key}]"
        return f"“{value}”"

    def heading(self, number: int, title: str) -> None:
        if number > 0:
            self.page_break()
        self.chapter = number
        self.section = 0
        self.doc.add_heading(f"{number} {title}", level=1)

    def guide_title(self) -> None:
        p = self.facts.project
        for _ in range(4):
            self.doc.add_paragraph()
        for text, size, bold in (
            (p["name"], 34, True),
            ("Manual testing guide", 16, False),
            (p["researchTitle"], 12, True),
            (f"{p['department']}, {p['institution']}\nin collaboration with {p['collaborator']}", 11, False),
            (f"Version {self.facts.version}", 11, True),
        ):
            paragraph = self.doc.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = paragraph.add_run(text)
            run.bold, run.font.size = bold, Pt(size)
            if size > 30:
                run.font.color.rgb = TEAL
            self.doc.add_paragraph()
        note = self.doc.add_paragraph()
        note.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = note.add_run(
            "How to use: work through the sections in order. For each test, do exactly what the second column says, "
            "compare with the third, tick Pass or Fail and write anything odd in Notes. Report a failure with its ID "
            "(section 14). The screenshots were made in test mode, so names and numbers on your screen will differ."
        )
        r.italic, r.font.size = True, Pt(9.5)
        self.page_break()

    def tests(self, prefix: str, rows: list[tuple[str, str, str | None]]) -> None:
        """One table: ID, what to do, expected, screenshot (thumbnail), Pass/Fail, notes."""
        self.tables += 1
        cap = self.doc.add_paragraph(style="Caption")
        cap.add_run(f"Table {self.tables}. Tests {prefix}.1–{prefix}.{len(rows)}")
        cap.paragraph_format.keep_with_next = True
        widths = [1.25, 5.4, 5.5, 2.65, 1.6, 1.3]
        table = self.doc.add_table(rows=1, cols=6)
        table.style = "Table Grid"
        table.autofit = False
        for cell, text in zip(table.rows[0].cells, ["ID", "What to do", "Expected", "Screenshot", "Pass / Fail", "Notes"]):
            cell.text = ""
            run = cell.paragraphs[0].add_run(text)
            run.bold, run.font.size = True, Pt(8.5)
        for number, (do, expect, shot) in enumerate(rows, start=1):
            self.tests_total += 1
            cells = table.add_row().cells
            cells[0].text = ""
            cells[0].paragraphs[0].add_run(f"{prefix}.{number}").bold = True
            for cell, text in ((cells[1], do), (cells[2], expect)):
                cell.text = ""
                for index, line in enumerate(text.split("\n")):
                    paragraph = cell.paragraphs[0] if index == 0 else cell.add_paragraph()
                    self._rich(paragraph, line)
            cells[3].text = ""
            if shot:
                path = IMAGES / "screens" / f"{shot}.png"
                if path.exists():
                    cells[3].paragraphs[0].add_run().add_picture(str(path), width=Cm(2.4))
                    caption = cells[3].add_paragraph()
                    caption.add_run(f"{shot}.png").font.size = Pt(6.5)
                    self.thumbnails += 1
                else:
                    self.missing_images.append(f"screens/{shot}.png")
            cells[4].text = ""
            cells[4].paragraphs[0].add_run("☐ Pass\n☐ Fail").font.size = Pt(8.5)
            cells[5].text = ""
            for cell in cells:
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        # Code a little smaller than the text, so commands fit the column.
                        run.font.size = Pt(8) if run.font.name == "Consolas" else Pt(8.5)
        for row in table.rows:
            for cell, width in zip(row.cells, widths):
                cell.width = Cm(width)
        self.doc.add_paragraph()


def build(g: Guide) -> None:
    f = g.facts
    s = g.s
    emg = {key: rule["default"] for key, rule in f.emg_settings.items()}
    g.guide_title()
    g.contents()

    # 0 ---------------------------------------------------------------------------------------
    g.heading(0, SECTIONS[0])
    g.p("What you need, and the one-time set-up. Commands are for Windows PowerShell, from the repository folder (for example `e:\\EMG+CV Website`).")
    g.table(
        ["Item", "Needed for", "Check"],
        [
            ["Windows 10 or 11", "Everything", "—"],
            ["Google Chrome or Microsoft Edge", "The app; Web Serial (muscle sensor) works only in these", "`chrome://version`"],
            ["A webcam", "The camera check, warm-up and games", "Windows Camera app shows a picture"],
            ["Python 3.12 or newer", "The server (native)", "`python --version`"],
            ["Node.js 22 or newer", "The web app (native)", "`node --version`"],
            ["Ollama and the model `qwen3.5:4b`", "Feedback reports written by the model (without it: template reports)", "`ollama list` shows `qwen3.5:4b`"],
            ["Docker Desktop (optional)", "The release with one command", "`docker --version`"],
        ],
        "Requirements (docs/install.md)",
        [4.2, 7.5, 5.8],
    )
    g.tests("T0", [
        ("Copy the settings file:\n`copy server\\.env.example server\\.env`", "The file `server\\.env` exists.", None),
        ("Make a JWT secret:\n`-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 | % {[char]$_})`\nand paste it after `JWT_SECRET=` in `server\\.env`.", "A 64-character random value is in `server\\.env` (production needs 32 or more).", None),
        ("Set `ADMIN_EMAIL`, `ADMIN_NAME` and a strong `ADMIN_PASSWORD` (12 characters or more) in `server\\.env`, before the first start.", "Saved. (Changing it after the first start does not change an existing admin.)", None),
        ("Native install, once:\n`cd server; python -m venv .venv; .venv\\Scripts\\python.exe -m pip install -r requirements.txt; cd ..`\n`cd web; npm ci; cd ..`", "Both finish without errors.", None),
        ("Seed the demo data:\n`cd server; .venv\\Scripts\\python.exe scripts\\seed_demo_data.py; cd ..`", "It prints two demo patient logins (left and right side affected) with passwords; save them. Four weeks of sessions, progress, alerts and reports are created.", None),
        ("Reset the demo data when needed:\n`server\\.venv\\Scripts\\python.exe server\\scripts\\seed_demo_data.py --reset` (or `--clear` to only remove them).", "Old demo patients are removed and created again (new passwords). Only patients marked Demo are touched.", None),
        ("Start completely fresh (optional): stop the app and delete `data\\muvi.db`.", "On the next start the admin is created again; seed again.", None),
    ])

    # 1 ---------------------------------------------------------------------------------------
    g.heading(1, SECTIONS[1])
    g.p("Two ways: native (Python and Node on this computer) or Docker. Use one at a time.")
    g.tests("T1", [
        ("Native, one command: `.\\scripts\\start.ps1 -Native`", "It builds the web app, then prints `Started: http://localhost:8080 (server on 8000)`.", None),
        ("Native, by hand (for development): terminal 1 `cd server; .venv\\Scripts\\Activate.ps1; uvicorn app.main:app --reload --port 8000`; terminal 2 `cd web; npm run dev`.", "The server says `Uvicorn running on http://127.0.0.1:8000`; the web app is at `http://localhost:5173`.", None),
        ("Docker: `.\\scripts\\start.ps1 -Model ollama` (or `-Model gpu` with an NVIDIA GPU, or no `-Model` with host Ollama or `LLM_PROVIDER=mock`).", "Containers start; the app is at `http://localhost:8080`. The first build takes minutes; the model download about 3 GB.", None),
        ("Open the health check: `http://localhost:8000/api/health` (native) or `http://localhost:8080/api/health` (both).", "JSON: `{\"status\": \"ok\", \"app\": \"MuVi Rehab\", \"version\": \"" + f.version + "\"}`.", None),
        ("Open `/api/version` the same way.", "JSON with `app`, `version` (`" + f.version + "`) and `environment` (`development`, or `production` for Docker).", None),
        ("Open the app's address in Chrome or Edge.", "The landing page appears.", "landing"),
        ("Stop: `.\\scripts\\stop.ps1 -Native` (native) or `.\\scripts\\stop.ps1` (Docker).", "The pages stop loading; the data is kept.", None),
    ])

    # 2 ---------------------------------------------------------------------------------------
    g.heading(2, SECTIONS[2])
    g.tests("T2", [
        ("Open the landing page `/`.", f"The title {s('landing.hero.title') if 'landing.hero.title' in f.strings else 'and tagline'}, a Log in button, the research prototype badge (KUET × The University of Queensland), the games and the team.", "landing"),
        ("Press the language switch's {} button in the top bar.".format(s("languageSwitch.bn")), "Every text changes to Bangla at once; the button is highlighted. On a phone-width window the switch shows “বাং” and “EN”.", "bangla-ui"),
        ("Press {} again.".format(s("languageSwitch.en")), "Back to English.", None),
        ("Open `/about`.", "The research title, background, the system's parts (including personal feedback reports, without a “coming soon” badge), the people and privacy.", None),
        ("Log in as a patient (section 3), open Profile and find {}.".format(s("display.title")), f"Text size {s('display.size.normal')}/{s('display.size.large')}/{s('display.size.xlarge')}, {s('display.contrast')}, {s('display.motion')}, {s('display.sound')}, {s('display.voice')}.", "accessibility-settings"),
        ("Choose {} and turn on {}.".format(s("display.size.xlarge"), s("display.contrast")), "All text grows; colours get darker and lines stronger. Reload: the choice is kept.", None),
        ("Press Tab repeatedly from the top of a page.", "A visible focus ring moves through links and buttons in order; the first Tab offers a skip link to the main content.", None),
        ("Make the window narrow (or a phone in Chrome's device mode).", "No sideways scrolling; on patient pages the menu becomes a bar of tabs at the bottom.", None),
    ])

    # 3 ---------------------------------------------------------------------------------------
    g.heading(3, SECTIONS[3])
    g.tests("T3", [
        ("Open `/login` and log in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.", "The admin overview opens (`/admin`).", "login"),
        ("Log out with {}.".format(s("nav.logout")), "Back to the login page; the back button does not show admin pages.", None),
        ("Log in as a demo patient.", "The patient home opens (`/patient`) with " + s("nav.patient.startSession") + ".", "patient-dashboard"),
        ("As the patient, type `/admin` in the address bar.", "You are sent to the patient's own home: patients cannot open admin pages.", None),
        ("Log out, then log in with a wrong password.", s("login.error.invalid"), None),
        ("Fail 5 more times with the same email (within 15 minutes), then try the right password.", f"From the 6th try within 15 minutes: {s('apiError.tooMany')} (the server's limit, `server/app/services/login_limits.py`). It works again 15 minutes after the oldest failure.", None),
        ("Session expiry: logged in, open DevTools (F12) → Application → Local storage → delete `muvi_token`, then click any page.", "You are sent to the login page (a 401 clears the login). A real login lasts `JWT_EXPIRE_MINUTES` (720 minutes = 12 hours).", None),
    ])

    # 4 ---------------------------------------------------------------------------------------
    g.heading(4, SECTIONS[4])
    g.figure("screens/admin-dashboard.png", "The admin overview", 14)
    g.tests("T4", [
        ("Admin → Patients → Add patient. Fill the form (full name, email, password, affected side, dominant side, age band, months since stroke) and save.", "The patient appears in the list with a new code (P00n).", None),
        ("Open the patient → Programme tab. Turn a game off, set another's highest level (slider) and press {}.".format(s("programme.save")), f"A confirmation lists the changes; after {s('programme.confirm')} they show in {s('programme.history.title')} with your reason.", "patient-programme"),
        ("In Programme: change the session length, rest frequency and games per session.", "Values outside the limits show an error and cannot be saved; valid ones are kept.", None),
        ("In Programme: the warm-up section: tick only some exercises and choose {} or {}.".format(s("programme.preset.personal"), s("programme.preset.gentle")), "Saved; the patient's next warm-up has only those exercises.", None),
        ("In Programme: {} → choose {}, {} or {}.".format(s("programme.field.engine_mode"), s("adminLevels.mode.L0"), s("adminLevels.mode.L1"), s("adminLevels.mode.L2")), s("programme.ai.note"), None),
        ("In Programme: the muscle sensor's default site: {} / {}.".format(s("programme.site.flexors"), s("programme.site.extensors")), "Saved; the patient's EMG step starts with this site chosen.", None),
        ("Admin → System → {}: change {} to 480 and save; reload.".format(s("emgSettings.title"), s("emgSettings.key.minRateHz")), f"{s('emgSettings.saved')}; the field shows 480 with “{f.strings['emgSettings.changed']}” and {s('emgSettings.lastChanged').split('{')[0].strip('“ ')}… appears.", "emg-settings"),
        ("Type 4000 in {} .".format(s("emgSettings.key.saturationMv")), f"The field says {s('emgSettings.error.range').replace('{min}', '500').replace('{max}', '3,600')}; Save is disabled.", None),
        ("Press {}.".format(s("emgSettings.reset")), f"{s('emgSettings.resetDone')}; every field is back to its default (for example {s('emgSettings.key.minRateHz')} {emg['minRateHz']}).", None),
        ("Admin → Alerts. Open a demo alert, choose acknowledge then resolve with a note.", f"The status moves {s('alert.status.open')} → {s('alert.status.acknowledged')} → {s('alert.status.resolved')}; the badge count in the menu falls.", "alerts"),
        ("Admin → Research → Research consent: tick consent for a patient. New study: name, design, conditions (L0, L1, L2), sessions per condition, games; create; enrol the patient; Start study.", "The study shows Active with 1 participant; the participant's next session plays the study's game (locked plan).", "research-mode"),
        ("Research → Export all trials (CSV). Also a patient's Export metrics (CSV).", "CSV files download; patients appear by code only (no names or emails); Demo patients are left out.", None),
        ("Open a demo patient → Progress tab → measures table.", f"Each measure's change is marked against the MDC; the MDC column shows {s('adminMetrics.mdc.provisional')} (no measured MDCs yet).", None),
    ])

    # 5 ---------------------------------------------------------------------------------------
    g.heading(5, SECTIONS[5])
    g.p("Log in as a patient you created (section 4), sit about 1–1.5 m from the webcam, with the affected arm and both shoulders in view and a light in front of you.")
    g.tests("T5", [
        ("Patient home → {}.".format(s("nav.patient.startSession")), f"{s('setup.intro.title')} with {s('setup.intro.allow')}.", "patient-dashboard"),
        ("Press {}; the browser asks for the camera; choose Allow.".format(s("setup.intro.allow")), f"The checklist {s('setup.checklist.title')}: {s('setup.check.cameraOn')}, {s('setup.check.upperBody')}, the affected arm, {s('setup.check.enoughLight')}; a skeleton over you (landmarks only); FPS and GPU or CPU in the corner.", "camera-check"),
        ("Turn the room light off, or sit with a window behind you.", f"{s('setup.check.enoughLight')} turns red (average brightness below 60 of 255, `web/src/vision/setupChecks.ts`).", None),
        ("Lean so one shoulder leaves the picture; then move the affected arm out of view.", f"{s('setup.check.upperBody')} and then the arm check turn red; back in view they turn green.", None),
        ("Hold every check green.", f"{s('setup.checklist.hint')} Then Continue is enabled.", None),
        ("Calibration: press {} and after 3-2-1 reach your wrist out to each of the 8 stars.".format(s("calibrate.intro.start")), f"Each star lights when reached (0.6 shoulder widths, `web/src/features/session/calibration.ts`). The result: {s('calibrate.result.title')} and {s('calibrate.result.stars').replace('{count}', 'n').replace('{total}', '8')}, compared with last time.", "calibration"),
        ("Press {}.".format(s("calibrate.result.save")), "The warm-up starts.", None),
    ] + [
        (f"Warm-up {number}: {s(key)}. Do it slowly {'5 rounds' if 'thumb' in key else '10 times'}.", expect, shot)
        for number, (key, expect, shot) in enumerate([
            ("exercise.shoulderFlexion.name", "The counter rises by 1 per full repetition (rest below 30°, target 90° standard); a movement past 60% of the way is a partial repetition; 0.6–8 s per repetition.", "warmup-shoulder-flexion"),
            ("exercise.shoulderAbduction.name", "Counts sideways raises (30° to 80° standard).", "warmup-shoulder-abduction"),
            ("exercise.elbowFlexion.name", "Counts bends (140° straight to 70° bent, standard).", "warmup-elbow-flexion"),
            ("exercise.forwardReach.name", "Counts reaches (0.45 to 0.80 of arm length, standard).", "warmup-forward-reach"),
            ("exercise.handOpenClose.name", "Counts open-close cycles (1.2 to 1.6 palm lengths, standard).", "warmup-hand-open-close"),
            ("exercise.thumbOpposition.name", "Counts rounds of thumb touches in finger order (touch 0.25, release 0.40 palm lengths); the finger boxes tick in turn.", "warmup-thumb-opposition"),
        ], start=1)
    ] + [
        ("During an arm exercise, lean your trunk forward about 15° and hold it for a second.", f"Within about 0.3 s: {s('warmup.cue.back')} (lean over 10° from your starting posture, `web/src/warmup/compensationConfig.ts`).", "compensation-warning"),
        ("During an arm exercise, lift (hike) the affected shoulder.", f"{s('warmup.cue.shoulder')} (a rise over 0.08 shoulder widths). Cues are at least 5 s apart.", None),
        ("Finish the warm-up.", f"The plan page: games with {s('plan.why')} reasons; you can untick a game.", "session-plan"),
    ])
    rows = []
    for game in f.games:
        name = f.strings.get(game["name_key"], game["id"])
        _, control, _ = GAME_NOTES[game["id"]]
        harder = [f"{f.strings.get(p['label_key'], p['name'])} ({'higher' if p['harder'] == 'higher' else 'lower'})" for p in game["params"] if p["component"] != "fixed" and p["harder"]]
        rows.append((
            f"Play {name} (in a plan, or Admin programme to include it). {control}",
            f"The HUD shows Turn n of {game['trials_default']}, Score, Level n. Succeed twice in a row: {s('game.level.up')} may appear and the next turn is harder ({'; '.join(harder)}). Fail: {s('game.level.down')} and it eases. At the end: results with the level reached.",
            f"game-{game['id'].replace('_', '-')}",
        ))
    g.h2("The nine games")
    g.tests("T5G", rows)
    g.tests("T5E", [
        ("After the last game: the cool-down. Answer pain, tiredness, enjoyment, difficulty and new symptoms; press {}.".format(s("cooldown.submit")), f"The summary: {s('summary.wellDone')}, time spent moving, warm-up goals and repetitions, a card per game with the level reached, your reach map, and the feedback report below.", "session-end"),
        ("Press {}.".format(s("summary.home")), "Home shows the streak and this week's progress updated.", "patient-dashboard"),
        ("Start a session, close the tab during the warm-up, open the app again and press Start session.", f"{s('resume.title')} with {s('resume.continue')} and {s('resume.startOver')}; Continue returns to the same step.", None),
    ])

    # 6 ---------------------------------------------------------------------------------------
    g.heading(6, SECTIONS[6])
    g.p("The engine is set per patient (section 4, Programme). Patients see only the level (1–10) and occasional cues; the reasons are for the admin.")
    g.tests("T6", [
        (f"Set the patient's engine to {s('adminLevels.mode.L0')}; play a game with many successes and some failures.", "The level never changes; the settings stay at the admin's defaults; rest and finish cues can still appear.", None),
        (f"Set {s('adminLevels.mode.L1')}; succeed twice in a row, then fail once.", "After 2 successes one component gets harder (+0.06); after a failure the component it points at eases (−0.08). Over a game the success rate settles near 70–75%.", "level-display"),
        (f"Set {s('adminLevels.mode.L2')}; play Reach and squeeze (20 turns).", "Targets move between directions and distances, favouring where you succeed about 70% of the time; no direction more than twice in a row.", None),
        ("Admin → the patient → Sessions → open the session → find each game's {}.".format(s("adminAdaptation.title")), f"A chart of the level over trials and a table: {s('adminAdaptation.column.trial')}, {s('adminAdaptation.column.level')}, {s('adminAdaptation.column.decision')} (a reason in words), {s('adminAdaptation.column.override')}, {s('adminAdaptation.column.cue')}. For L2, a sector grid.", None),
        ("On the plan page press {} beside each game.".format(s("plan.why")), "A reason such as practising a weaker movement, variety, a favourite, or a lighter day.", "session-plan"),
        ("Safety, repeated failure: in a game, deliberately fail 3 turns in a row.", f"{s('game.cue.encourage')} and every component eases by 0.15; the decision log shows {s('adminAdaptation.flag.failures')}.", None),
        ("Safety, tiring: play well for the first 5 turns, then badly or slowly for the last 5.", f"Every component eases by 0.1 and {s('game.rest.title')} is offered; the log shows {s('adminAdaptation.flag.tiring')}.", None),
        ("Safety, session time: keep playing games for 25 minutes of active play (or set `SESSION_FINISH_SOON_MIN=2` and `SESSION_FINISH_MIN=3` in `server\\.env` for a quick test, then restart the server and set them back).", f"After 25 minutes: {s('game.cue.finishSoon')}; after 35: the session suggests finishing.", None),
        ("Safety, compensation: during a reaching game, lean the trunk in 2 of 3 turns.", f"The spatial difficulty does not increase; the log shows {s('adminAdaptation.flag.compensation')}.", None),
        ("Cap the level: in Programme set a game's highest level to {} and play it well.".format(s("programme.level.gentle")), "The level never goes above that cap, however well you play.", None),
    ])

    # 7 ---------------------------------------------------------------------------------------
    g.heading(7, SECTIONS[7])
    g.p("Needs Ollama running with `qwen3.5:4b` (`ollama list`), and `LLM_PROVIDER=ollama` in `server\\.env`.")
    g.tests("T7", [
        ("Finish a session (section 5). Watch the summary's feedback area; time it with a stopwatch.", "It shows that the report is being written, then the report. On the project laptop (RTX 3050, 4 GB) the model writes about 19 tokens per second (`docs/ai-engine.md`); a report must finish within `LLM_JOB_LIMIT_S` (120 s) or the template is used. Write your time in Notes.", "session-end"),
        ("Admin → the patient → Reports tab.", f"A row with {s('feedback.admin.column.status')} {s('feedback.admin.status.done')} (the model) or {s('feedback.admin.status.fallback')}, the {s('feedback.admin.column.model')} and the {s('feedback.admin.column.time')} it took.", None),
        ("Patient → Reports → open the report; press the report's own {} switch.".format(s("languageSwitch.bn")), "The same report in Bangla (a separate job; it may take a moment). Numbers match the English version.", "report-bn"),
        ("Read the English report.", "Every number matches the summary; no medical advice or diagnosis words; at most three tips.", "report-en"),
        ("Red flag: finish a session answering pain 4 or more (out of 10; `PAIN_FLAG_MIN = 4` in `server/app/services/safety.py`), or new symptoms Yes.", "A fixed safety notice appears that the model did not write: “Please stop practising for today and tell your therapist how you feel. If you notice sudden weakness, numbness, face drooping or difficulty speaking, call emergency services immediately.” (`shared/safety-notices.json`). An alert appears for the admin.", None),
        ("Stop Ollama (quit it from the tray), then finish a session.", f"The report still appears at once, written from the template; the admin's Reports tab shows {s('feedback.admin.status.fallback')}. After many template reports an alert {s('alert.type.llm_fallback_rate')} appears.", None),
        ("Rate the report: {} – choose stars, write a comment, {}.".format(s("feedback.rating.question"), s("feedback.rating.send")), s("feedback.rating.thanks"), None),
        ("Admin → System → Feedback model.", "Provider, model, Reachable and Model loaded (Yes when Ollama is running), Reports waiting.", None),
    ])

    # 8 ---------------------------------------------------------------------------------------
    g.heading(8, SECTIONS[8])
    g.tests("T8", [
        ("Log in as the demo patient Rahim → Progress.", "Charts of the measures over four weeks (reach area, time to reach, smoothness…), each with “higher/lower is better” and View as table.", "progress-charts"),
        ("Patient home.", "Streak, weekly goal ring and a 4-week calendar.", "patient-dashboard"),
        ("Admin → Rahim → Progress tab.", f"Reach maps over time, warm-up charts with every personalisation decision, and measures with their change in MDC units ({s('adminMetrics.mdc.provisional')} badges while MDCs are not measured).", None),
        ("For a new patient, check the measures after the 1st, 2nd and 3rd session.", "The baseline is the mean of the first two sessions; changes are judged from the 3rd: improved at +1 MDC or more, worse at −1 or less.", None),
        ("Admin → Overview.", "Totals, recent patients, open alerts by severity and recent sessions.", "admin-dashboard"),
        ("Admin → Alerts → filter by status, severity and type.", "The demo data includes a pain alert (Salma) and a template-reports alert.", "alerts"),
    ])

    # 9 ---------------------------------------------------------------------------------------
    g.heading(9, SECTIONS[9])
    g.p("For development builds (`npm run dev`). A production build offers the simulated sensor only after `localStorage.setItem(\"muvi-simulated-emg\", \"on\")` in DevTools.")
    g.tests("T9", [
        ("Start a session; on the camera check turn on {} and continue.".format(s("setup.useSensor")), f"The muscle sensor step: safety questions and the electrode site ({s('emgStep.site.flexors').split('(')[0].strip()} or extensors).", None),
        ("Tick the three safety answers and press {}.".format(s("emgStep.useSimulated")), f"The sensor check: nine items turn green; {s('emgStep.simulatedHint')}", "emg-readiness"),
        ("Press {} and hold M for 2 s.".format(s("emgStep.testSqueeze")), f"Item 9 turns green (peak at least {emg['squeezeMinRatio']} × the relaxed level); {s('emgStep.ready')}.", "emg-readiness"),
        ("Calibration: relax for the rest (10 s), then hold M through each of the 3 efforts.", "Each effort's bar fills; then the summary with the rest level and MVC; save.", "emg-calibration"),
        ("Play Grip and hold (flexors) or Bloom (extensors), controlling with M.", "The game shows the muscle sensor as the source; the kite or flower follows M (pressed = squeeze).", None),
        ("Simulate unplugging: in DevTools console run `window.__muviTest?.emg.unplug()` (test mode) or, in normal development, use `/dev/emg-monitor` → Use mock board → Unplug.", f"{s('game.emgPaused')}; the camera controls the game; the header dot {s('emgDot.paused')}. Plug back in: the sensor takes over again.", None),
        ("Open `/dev/emg-monitor` → Use mock board → move the contraction slider.", "The live plot and %MVC follow the slider; the nine readiness items; START/STOP/PING/SIM buttons work; SIM ON shows the Board simulation badge.", None),
    ])

    # 10 --------------------------------------------------------------------------------------
    g.heading(10, SECTIONS[10])
    g.p("Replay mode plays a recorded person instead of the camera, so you can test without moving. It exists only in a development build started in test mode; a production build never has it (`web/src/testing/testMode.ts`).")
    g.tests("T10", [
        ("Start the web app in test mode: `cd web; $env:VITE_TEST_MODE=\"true\"; npm run dev` (server as usual).", "The app runs at `http://localhost:5173` as normal.", None),
        ("Log in as a patient whose affected side is RIGHT (the recording `shadik_full` is of the right side). Start a session and on the camera page add `?replay=shadik_full&replayLoop=1` to the address, then reload.", "No camera permission is asked; the recorded person's landmarks appear and the checks pass.", "camera-check"),
        ("For a whole session (the address parameter is lost when the page changes): in DevTools console run\n`localStorage.setItem(\"muvi-test-replay\",\"shadik_full\"); localStorage.setItem(\"muvi-test-replay-loop\",\"1\"); localStorage.setItem(\"muvi-test-replay-side\",\"right\")` and reload.", "Every camera page replays the recording.", None),
        ("Use the synthetic person instead: `?replay=synth:still` (sitting still) or `?replay=synth:demo`.", "A synthetic body is shown; the camera check passes.", None),
        ("Turn replay off: `localStorage.removeItem(\"muvi-test-replay\")` and reload.", "The real camera is used again.", None),
    ])

    # 11 --------------------------------------------------------------------------------------
    g.heading(11, SECTIONS[11])
    g.p("For the validation session later (`docs/validation.md`, `docs/pending-manual-checks.md`). Development build (`npm run dev`).")
    g.tests("T11", [
        ("Open `/dev/latency`.", "Stage timings per frame and a flip square for the slow-motion video method; CSV download.", None),
        ("Open `/dev/angle-validation`.", "Live 3D and 2D angles (elbow, shoulder flexion, abduction) to compare with a phone clinometer; CSV.", None),
        ("Admin → a patient → {} → plan visit 1.".format(s("repeatability.button")), "The patient's next session is the camera check, calibration and the 6 warm-up exercises with standard targets, then it finishes. Repeat for visits 2 and 3 on different days; export the CSV.", None),
        ("Analysis: `server\\.venv\\Scripts\\python.exe analysis\\validation\\run_validation.py` (add `--demo` for a synthetic example) then `analysis\\validation\\render_docs.py`.", "Results in `analysis\\results\\validation\\`; `docs\\validation.md` and `docs\\results-summary.md` updated; missing data stays PENDING.", None),
        ("EMG: record with `/dev/emg-monitor` → Record 30 s CSV, then `server\\.venv\\Scripts\\python.exe analysis\\emg\\emg_validation.py`.", "Rate, gaps, rest, MVC CV% and onset latency in `docs\\validation.md`; mock or SIM recordings are left out.", None),
    ])

    # 12 --------------------------------------------------------------------------------------
    g.heading(12, SECTIONS[12])
    g.p("The full runbook is `docs/hardware-day.md` (safety first: laptop on battery with the charger unplugged whenever electrodes are on; the sensor on its two 9 V batteries only). Expected readiness with a good set-up (defaults from `web/src/emg/emgSettings.json`):")
    g.table(
        ["Item", "Expected (default)"],
        [
            ["1 Web Serial", "Chrome or Edge at localhost"],
            ["2 Connected", "The ESP32's port chosen"],
            ["3 Responding", f"PONG within {emg['pongTimeoutMs']} ms"],
            ["4 Rate", f"{emg['minRateHz']}–{emg['maxRateHz']} samples/s over {emg['rateWindowMs']} ms"],
            ["5 Gaps", f"under {emg['maxGapsPct']}% over {emg['gapsWindowMs']} ms"],
            ["6 Contact", f"SD over {emg['contactWindowMs']} ms above {emg['minContactSdMv']} mV"],
            ["7 Saturation", f"no sample at or above {emg['saturationMv']} mV for {emg['saturationWindowMs']} ms"],
            ["8 Relaxed", f"SD ≤ {emg['relaxedMaxSdMv']} mV and mean ≤ {emg['relaxedMaxMeanMv']} mV over {emg['relaxedWindowMs']} ms"],
            ["9 Test squeeze", f"peak ≥ {emg['squeezeMinRatio']} × relaxed mean with an onset, over {emg['squeezeMs']} ms"],
        ],
        "Readiness items with a good set-up",
        [4, 12.5],
    )
    g.tests("T12", [
        ("Flash `firmware/emg_stream/emg_stream.ino`; Serial Monitor at 115200 baud, Newline; type `PING`.", "`PONG,1.0.0`; pressing EN/RESET prints `I,version=1.0.0,rate=500,mode=ADC,streaming=0,…`.", None),
        ("`server\\.venv\\Scripts\\python.exe analysis\\tools\\serial_rate.py --port COM5 --seconds 60` (your port).", "About 500 samples per second, 0 gaps, firmware drops 0.", None),
        ("`/dev/emg-monitor` → Connect ESP32 → readiness with electrodes on.", "All nine items green (table above); then calibration and an EMG game as in section 9.", "emg-readiness"),
    ])

    # 13 --------------------------------------------------------------------------------------
    g.heading(13, SECTIONS[13])
    g.tests("T13", [
        ("Camera blocked: in the address bar's camera icon choose Block, reload the camera check and press {}.".format(s("setup.intro.allow")), f"{s('setup.error.title')}: {s('setup.error.permissionDenied')}", None),
        ("No camera: unplug the webcam (or disable it in Device Manager) and start the camera check.", s("setup.error.noCamera"), None),
        ("Camera in use: open the Windows Camera app, then start the camera check.", s("setup.error.cameraInUse"), None),
        ("Ollama off: stop Ollama and finish a session.", "The template report appears; no error for the patient (section 7).", None),
        ("Server off: stop the server and click around the patient pages.", f"Pages show a friendly error with Retry; during a session, trials wait and are sent when the server is back. With the network off: {s('offline.banner')}", None),
        ("Slow computer: open many heavy programs and run a game.", "The FPS on the camera check falls; the games keep their fixed timestep; tracking may lag. Note the FPS.", None),
        ("Wrong browser for Web Serial: open the muscle sensor step in Firefox.", s("emg.error.notSupported"), None),
        ("Production safety: in `server\\.env` set `APP_ENV=production` with the example password, then start the server.", "The server refuses to start: “Refusing to start in production: …”. Set a real password and secret.", None),
    ])

    # 14 --------------------------------------------------------------------------------------
    g.heading(14, SECTIONS[14])
    g.table(
        ["Problem", "What to do"],
        [
            ["“Refusing to start in production”", "Set a real `ADMIN_PASSWORD` (12+) and `JWT_SECRET` (32+) in `server\\.env`"],
            ["Camera blocked or black", "Allow the camera for the site (lock icon); close other apps using it; check the Windows privacy settings for the camera"],
            ["Checks stay red", "More light in front of you; sit 1–1.5 m away; shoulders and the affected arm in view; plain background"],
            ["Reports always from the template", "Ollama running? `ollama list` shows `qwen3.5:4b`; `LLM_PROVIDER=ollama`; with Docker and host Ollama set `OLLAMA_URL=http://host.docker.internal:11434`"],
            ["No Connect for the muscle sensor", "Use Chrome or Edge at localhost; install the CP210x or CH340 driver; close the Serial Monitor"],
            ["Port 8080 or 5173 in use", "Stop the other program, or set `WEB_PORT` (Docker)"],
            ["Blank page after an update", "Hard refresh (Ctrl+F5); rebuild (`start.ps1`)"],
            ["Login says too many attempts", "Wait 15 minutes after the oldest failed attempt, or restart the server (the limit is in memory)"],
        ],
        "Troubleshooting (docs/install.md, docs/hardware-day.md)",
        [5, 11.5],
    )
    g.h2("How to report a problem")
    g.numbered([
        "The test ID (for example T5G.4) and what you did just before.",
        "What you expected (the Expected column) and what happened instead, word for word.",
        "A screenshot (Windows + Shift + S).",
        "The browser console: F12 → Console → right-click → Save as… (or copy the red lines).",
        "For server problems, the server window's last lines (native) or `docker compose logs server` (Docker).",
        "The app version (`/api/version`), the browser and its version, and native or Docker.",
    ])

    # 15 --------------------------------------------------------------------------------------
    g.heading(15, SECTIONS[15])
    g.tests("T15", [
        ("All automated checks: `.\\scripts\\check.ps1 -E2E`.", "Every step PASS (backend tests, web tests, lint, build, smoke test, end-to-end).", None),
        ("Every test in sections 1–13 of this guide.", "Pass, or a known issue recorded in `docs/known-issues.md`.", None),
        ("Security: `cd web; npm run build; npm run scan:bundle; npm audit --omit=dev` and `server\\.venv\\Scripts\\python.exe -m pip_audit -r server\\requirements.txt`.", "0 findings and 0 vulnerabilities (`docs/security.md`).", None),
        ("Docker release: `docker compose config -q` then `.\\scripts\\start.ps1 -Model ollama`, a full session, `.\\scripts\\backup.ps1`.", "Valid configuration; the session works at :8080; a backup file in `backups\\`.", None),
        ("Version: change `1.0.0-rc1` to `1.0.0` in `web/package.json`, `server/pyproject.toml` and `server/app/__init__.py`; run the release tests (`server\\tests\\test_release.py`).", "The footer, Admin → System and `/api/version` show 1.0.0.", None),
        ("Documents: `CHANGELOG.md` has a 1.0.0 entry; `docs/release-notes-v1.0.md` and `docs/known-issues.md` are current; the README's links pass (`python scripts\\docs\\check_readme_links.py`).", "All up to date; the link check says OK.", None),
        ("The model's licence is checked and the VERIFY mark removed from `THIRD_PARTY_NOTICES.md`.", "Done.", None),
        ("Tag the release (your git step): `git tag v1.0.0`.", "The tag exists on the commit you tested.", None),
    ])


def check(path: Path = OUT) -> int:
    doc = Document(str(path))
    headings = [p.text for p in doc.paragraphs if p.style.name == "Heading 1"]
    images = len(doc.inline_shapes)
    tests = 0
    for table in doc.tables:
        if table.rows and table.rows[0].cells[0].text == "ID":
            tests += len(table.rows) - 1
    problems = [f"missing section {n} {title}" for n, title in enumerate(SECTIONS) if f"{n} {title}" not in headings]
    print(f"Read back {path.relative_to(ROOT)}:")
    print(f"  sections: {len(headings)}; tables: {len(doc.tables)}; tests: {tests}; images: {images}")
    for title in headings:
        print(f"    {title}")
    for problem in problems:
        print(f"  PROBLEM: {problem}")
    return 1 if problems or images == 0 or tests == 0 else 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    if "--check" in sys.argv:
        return check()
    guide = Guide(load_facts())
    build(guide)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    guide.doc.save(OUT)
    print(f"Wrote {OUT.relative_to(ROOT)}: {guide.tests_total} tests, {guide.tables} tables, "
          f"{guide.figures} figures, {guide.thumbnails} screenshot thumbnails")
    problems = 0
    if guide.missing_keys:
        print("Missing string keys: " + ", ".join(sorted(set(guide.missing_keys))))
        problems += 1
    if guide.missing_images:
        print("Missing images: " + ", ".join(sorted(set(guide.missing_images))))
        problems += 1
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
