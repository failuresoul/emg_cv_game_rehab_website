import math
import random
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import PATIENT_PASSWORD, Headers
from fastapi.testclient import TestClient
from sqlmodel import Session, col, func, select

from app.models import (
    AdaptationLog,
    Calibration,
    EngineState,
    GameRun,
    PatientProfile,
    SessionFeedback,
    Trial,
    User,
    WarmupResult,
)
from app.models import Session as SessionRecord
from app.schemas.game import GameSummary, TrialCreate
from app.schemas.session import DIRECTIONS_DEG, CalibrationCreate
from app.schemas.session_feedback import SessionFeedbackCreate
from app.schemas.warmup import WarmupResultCreate
from app.services.levels import run_levels
from app.services.users import authenticate
from scripts import seed_demo_data as demo

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)


def count(session: Session, model: Any) -> int:
    return session.exec(select(func.count()).select_from(model)).one()


def revalidate(model: Any) -> None:
    """Valid against its schema even after a round trip through JSON, as the API would see it."""
    type(model).model_validate_json(model.model_dump_json())


# The generators


@pytest.mark.parametrize("progress", [0.0, 0.5, 1.0])
def test_calibration_is_valid_and_consistent(progress: float) -> None:
    calibration = demo.make_calibration(random.Random(1), "left", progress, 1.0)

    revalidate(calibration)
    assert isinstance(calibration, CalibrationCreate)
    for radius, (x, y), degrees in zip(
        calibration.reach_radii_sw, calibration.reach_points_sw, DIRECTIONS_DEG, strict=True
    ):
        assert math.isclose(math.hypot(x, y), radius, abs_tol=1e-3)
        assert math.isclose(math.degrees(math.atan2(y, x)) % 360, degrees, abs_tol=0.5)
    assert len(calibration.hull_sw) >= 3
    area = demo.polygon_area(calibration.hull_sw)
    assert calibration.hull_area_sw2 == pytest.approx(area, abs=1e-4)


def test_reach_grows_more_for_rahim_than_salma() -> None:
    def area(progress: float, improvement: float) -> float:
        return demo.make_calibration(random.Random(3), "left", progress, improvement).hull_area_sw2

    rahim_gain = area(1, 1.0) / area(0, 1.0)
    salma_gain = area(1, 0.4) / area(0, 0.4)
    assert rahim_gain > 1.3
    assert 1.0 < salma_gain < rahim_gain


def test_warmup_results_are_valid_for_every_exercise() -> None:
    rng = random.Random(2)
    histories: dict[Any, demo.ExerciseHistory] = {}
    for session_index in range(8):
        results = demo.make_warmup(rng, session_index / 7, 1.0, histories)
        assert [result.exercise_id for result in results] == [
            spec.exercise_id for spec in demo.EXERCISES
        ]
        for result in results:
            revalidate(result)
            assert isinstance(result, WarmupResultCreate)
            assert result.full_reps + result.partial_reps == len(result.reps)
            assert result.compensated_reps == sum(rep.compensated for rep in result.reps)
            assert result.personalisation is not None
            if session_index == 0:
                assert result.preset == "standard"
                assert result.personalisation.previous_high is None
            else:
                assert result.preset == "personal"
                assert result.personalisation.previous_high is not None


def test_personal_goals_rise_after_good_sets() -> None:
    spec = demo.EXERCISES[0]  # Shoulder flexion, up from 90 degrees.
    good = demo.ExerciseHistory(
        full_reps=10, target_reps=10, compensation_rate=0.05, target=90, best_peak=96
    )
    hard = demo.ExerciseHistory(
        full_reps=4, target_reps=10, compensation_rate=0.1, target=90, best_peak=80
    )
    compensating = demo.ExerciseHistory(
        full_reps=10, target_reps=10, compensation_rate=0.4, target=90, best_peak=96
    )

    assert demo.next_target(spec, good) == (95, "raised: 10/10 reps, 5% compensated")
    assert demo.next_target(spec, hard)[0] == 85
    assert demo.next_target(spec, compensating)[1].startswith("lowered for compensation")
    # Never more than 15% past the standard target.
    high = demo.ExerciseHistory(
        full_reps=10, target_reps=10, compensation_rate=0, target=103.5, best_peak=110
    )
    assert demo.next_target(spec, high) == (
        103.5,
        "adjusted: 10/10 reps, 0% compensated; limited by standard max",
    )


def test_rahims_warmup_improves() -> None:
    rng = random.Random(demo.SEED)
    histories: dict[Any, demo.ExerciseHistory] = {}
    sessions = [demo.make_warmup(rng, index / 7, 1.0, histories) for index in range(8)]

    def mean_compensation(results: list[WarmupResultCreate]) -> float:
        return sum(result.compensation_rate for result in results) / len(results)

    first, last = sessions[0], sessions[-1]
    assert sum(r.full_reps for r in last) > sum(r.full_reps for r in first)
    assert mean_compensation(last) < mean_compensation(first)
    # Goals rose: the last shoulder-flexion target is above the standard 90 degrees.
    assert last[0].thresholds.high > 90


@pytest.mark.parametrize("game_id", demo.REACH_GAMES)
def test_game_trials_are_valid_and_inside_the_reach(game_id: demo.GameName) -> None:
    calibration = demo.make_calibration(random.Random(4), "right", 0.5, 1.0)
    radii = calibration.reach_radii_sw

    trials = demo.make_game_trials(random.Random(5), game_id, radii, 0.5, 1.0)

    assert [trial.trial_no for trial in trials] == list(range(1, 21))
    for trial in trials:
        revalidate(trial)
        assert isinstance(trial, TrialCreate)
        assert trial.target is not None
        assert 3 <= len(trial.trajectory) <= 50
        times = [point[0] for point in trial.trajectory]
        assert times == sorted(times)
        direction = DIRECTIONS_DEG.index(int(trial.target.direction_deg))
        if game_id == "fruit_catch":
            # Fruit falls along the basket line, within the sideways reach.
            assert abs(trial.target.x_sw) <= radii[direction] + 1e-6
        else:
            assert math.hypot(trial.target.x_sw, trial.target.y_sw) <= radii[direction] + 1e-6
        if trial.outcome == "success":
            assert trial.metrics.movement_ms is not None
    outcomes = {trial.outcome for trial in trials}
    assert "success" in outcomes
    assert len(outcomes) > 1  # Some misses too.

    summary = demo.summarise_trials(game_id, trials)
    revalidate(summary)
    assert isinstance(summary, GameSummary)
    assert summary.successes == sum(trial.outcome == "success" for trial in trials)
    if game_id != "reach_activate":
        assert next(iter(summary.details.values())) is not None


@pytest.mark.parametrize("game_id", demo.HAND_GAMES)
def test_hand_game_trials_are_valid(game_id: demo.GameName) -> None:
    trials = demo.make_game_trials(random.Random(5), game_id, demo.BASE_RADII, 0.5, 1.0)

    assert [trial.trial_no for trial in trials] == list(
        range(1, demo.TRIAL_COUNTS[game_id] + 1)
    )
    for trial in trials:
        revalidate(trial)
        assert trial.trajectory == []
        assert trial.target is not None
        assert trial.target.x_sw is None
        if not trial.compensation.flagged:
            continue
        assert trial.compensation.type == "trunk"
    outcomes = {trial.outcome for trial in trials}
    assert outcomes == {"success", "miss"}

    summary = demo.summarise_trials(game_id, trials)
    revalidate(summary)
    if game_id == "bloom":
        assert {trial.target.kind for trial in trials if trial.target} == {"bloom"}
        for trial in trials:
            if trial.outcome == "success":
                assert trial.metrics.failed_phase is None
                assert trial.metrics.time_to_close_ms is not None
            else:
                assert trial.metrics.failed_phase in {"open", "close"}
        peaks = [trial.metrics.peak_openness for trial in trials]
        assert summary.details["best_openness"] == max(p for p in peaks if p is not None)
    else:
        for trial in trials:
            metrics = trial.metrics
            assert trial.target is not None and trial.target.kind == "sequence"
            notes = trial.target.notes or []
            assert set(notes) == set(demo.FINGERS)
            assert all(notes[i : i + 3] != [notes[i]] * 3 for i in range(len(notes)))
            assert metrics.hits is not None and metrics.notes_total == len(notes)
            assert metrics.hits + (metrics.wrong_finger or 0) + (metrics.missed or 0) == len(notes)
            success = metrics.hits / len(notes) >= demo.PIANO_SUCCESS_RATE
            assert trial.outcome == ("success" if success else "miss")
        assert summary.details["best_finger"] in demo.FINGERS
        assert 0 < summary.details["note_hit_rate"] <= 1  # type: ignore[operator]


@pytest.mark.parametrize("game_id", demo.MOVEMENT_GAMES)
def test_movement_game_trials_are_valid(game_id: demo.GameName) -> None:
    trials = demo.make_game_trials(random.Random(5), game_id, demo.BASE_RADII, 0.5, 1.0)

    assert [trial.trial_no for trial in trials] == list(
        range(1, demo.TRIAL_COUNTS[game_id] + 1)
    )
    for trial in trials:
        revalidate(trial)
        assert trial.target is not None and trial.target.x_sw is None
        metrics = trial.metrics
        if game_id == "path_trace":
            assert trial.target.kind == "path"
            assert trial.target.shape in demo.PATH_SHAPES
            assert 2 <= len(trial.target.points or []) <= 200
            assert len(trial.trajectory) > 30
            assert metrics.sparc is not None and metrics.sparc <= 0
            assert metrics.time_in_corridor_pct is not None
            assert (trial.outcome == "success") == (metrics.time_in_corridor_pct >= 70)
        else:
            assert trial.target.kind == "stripe"
            assert trial.target.index == trial.trial_no - 1
            assert metrics.achieved_range_deg is not None
            assert metrics.max_straight_deg is not None and metrics.max_bend_deg is not None
            assert metrics.max_straight_deg - metrics.max_bend_deg == pytest.approx(
                metrics.achieved_range_deg, abs=0.11
            )
            assert (trial.outcome == "success") == (metrics.full_sweeps == 3)
            assert trial.compensation.flagged == (trial.compensation.type == "upper_arm")
    summary = demo.summarise_trials(game_id, trials)
    revalidate(summary)
    if game_id == "path_trace":
        stars = summary.details["total_stars"]
        assert isinstance(stars, int | float) and 10 <= stars <= 30
        assert summary.details["best_sparc"] == max(t.metrics.sparc for t in trials)  # type: ignore[type-var]
    else:
        assert summary.details["best_range_deg"] == max(
            t.metrics.achieved_range_deg for t in trials  # type: ignore[type-var]
        )


@pytest.mark.parametrize("game_id", demo.FUNCTION_GAMES)
def test_pick_place_and_grip_hold_trials_are_valid(game_id: demo.GameName) -> None:
    trials = demo.make_game_trials(random.Random(9), game_id, demo.BASE_RADII, 0.5, 1.0)

    assert len(trials) == demo.TRIAL_COUNTS[game_id]
    for trial in trials:
        revalidate(trial)
        assert trial.target is not None and trial.target.x_sw is None
        metrics = trial.metrics
        if game_id == "pick_place":
            assert trial.target.kind == "pick_place"
            assert trial.target.pick is not None and trial.target.place is not None
            for point in (trial.target.pick, trial.target.place):
                # Inside the reach in the point's own direction.
                degrees = math.degrees(math.atan2(point[1], point[0]))
                assert math.hypot(*point) <= demo.reach_toward(demo.BASE_RADII, degrees) + 1e-6
            assert metrics.drops is not None and metrics.drops >= 0
            assert (trial.outcome == "success") == (metrics.transport_ms is not None)
            assert (trial.outcome == "success") == (metrics.release_error_sw is not None)
            assert len(trial.trajectory) > 10
        else:
            assert trial.target.kind == "grip_band"
            assert metrics.input_source == "cv_grip"
            assert metrics.steadiness is not None and 0 < metrics.steadiness < 0.2
            assert (trial.outcome == "success") == (metrics.failed_phase is None)
            assert (trial.outcome == "success") == (metrics.relaxation_ms is not None)
            assert trial.trajectory == []
    summary = demo.summarise_trials(game_id, trials)
    revalidate(summary)
    if game_id == "pick_place":
        assert summary.details["total_drops"] == sum(t.metrics.drops or 0 for t in trials)
    else:
        assert summary.details["best_steadiness"] is not None
        assert summary.details["mean_relaxation_ms"] is not None
    assert demo.game_score(trials, game_id) >= 100 * summary.successes


def test_pick_place_and_grip_hold_improve_over_the_sessions() -> None:
    def summary(game_id: demo.GameName, progress: float) -> GameSummary:
        trials = [
            trial
            for seed in range(10)
            for trial in demo.make_game_trials(
                random.Random(seed), game_id, demo.BASE_RADII, progress, 1.0
            )
        ]
        return demo.summarise_trials(game_id, trials)

    first, last = summary("pick_place", 0), summary("pick_place", 1)
    assert last.details["mean_transport_ms"] < first.details["mean_transport_ms"]  # type: ignore[operator]
    assert last.details["total_drops"] < first.details["total_drops"]  # type: ignore[operator]
    first, last = summary("grip_hold", 0), summary("grip_hold", 1)
    assert last.details["best_steadiness"] < first.details["best_steadiness"]  # type: ignore[operator]
    assert last.details["mean_in_band_pct"] > first.details["mean_in_band_pct"]  # type: ignore[operator]
    assert last.success_rate > first.success_rate


def test_movement_quality_improves_over_the_sessions() -> None:
    def summary(game_id: demo.GameName, progress: float) -> GameSummary:
        trials = [
            trial
            for seed in range(10)
            for trial in demo.make_game_trials(
                random.Random(seed), game_id, demo.BASE_RADII, progress, 1.0
            )
        ]
        return demo.summarise_trials(game_id, trials)

    first, last = summary("path_trace", 0), summary("path_trace", 1)
    assert last.details["best_sparc"] > first.details["best_sparc"]  # type: ignore[operator]
    assert last.details["mean_in_corridor_pct"] > first.details["mean_in_corridor_pct"] + 15  # type: ignore[operator]
    first, last = summary("paint_wall", 0), summary("paint_wall", 1)
    assert last.details["mean_range_deg"] > first.details["mean_range_deg"] + 20  # type: ignore[operator]
    assert last.success_rate > first.success_rate + 0.5


def test_hand_games_improve_over_the_sessions() -> None:
    def summary(game_id: demo.GameName, progress: float) -> GameSummary:
        trials = [
            trial
            for seed in range(10)
            for trial in demo.make_game_trials(
                random.Random(seed), game_id, demo.BASE_RADII, progress, 1.0
            )
        ]
        return demo.summarise_trials(game_id, trials)

    first, last = summary("bloom", 0), summary("bloom", 1)
    assert last.success_rate > first.success_rate + 0.2
    assert last.details["mean_time_to_open_ms"] < first.details["mean_time_to_open_ms"]  # type: ignore[operator]
    first, last = summary("finger_piano", 0), summary("finger_piano", 1)
    assert last.details["note_hit_rate"] > first.details["note_hit_rate"] + 0.15  # type: ignore[operator]


def test_games_improve_over_the_sessions() -> None:
    radii = list(demo.BASE_RADII)

    def figures(progress: float) -> tuple[float, float]:
        trials = [
            trial
            for seed in range(10)
            for trial in demo.make_game_trials(
                random.Random(seed), "reach_activate", radii, progress, 1.0
            )
        ]
        summary = demo.summarise_trials("reach_activate", trials)
        assert summary.mean_movement_ms is not None
        return summary.success_rate, summary.mean_movement_ms

    first_rate, first_time = figures(0)
    last_rate, last_time = figures(1)
    assert last_rate > first_rate + 0.15
    assert last_time < first_time * 0.75


def test_questionnaire_is_valid_and_pain_raises_a_flag() -> None:
    calm = demo.make_questionnaire(random.Random(6), 0.5, 1.0, pain=False)
    pain = demo.make_questionnaire(random.Random(6), 0.5, 0.4, pain=True)

    for answers in (calm, pain):
        revalidate(answers)
        assert isinstance(answers, SessionFeedbackCreate)
    assert calm.pain_0_10 < 4
    assert calm.fatigue_0_10 < 8
    assert pain.pain_0_10 == 5


def test_convex_hull_and_area() -> None:
    square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.5, 0.5)]

    hull = demo.convex_hull(square)

    assert len(hull) == 4
    assert demo.polygon_area(hull) == pytest.approx(1.0)


# Seeding and clearing the database


def demo_profiles(session: Session) -> list[PatientProfile]:
    return list(session.exec(select(PatientProfile).where(col(PatientProfile.is_demo))).all())


def test_seed_creates_two_demo_patients_with_full_sessions(session: Session) -> None:
    logins = demo.seed_demo_data(session, now=NOW)

    profiles = {profile.affected_side: profile for profile in demo_profiles(session)}
    assert set(profiles) == {"left", "right"}
    for email, password in logins:
        assert authenticate(session, email, password) is not None

    expected = {"left": 8, "right": 6}
    for side, profile in profiles.items():
        records = session.exec(
            select(SessionRecord).where(SessionRecord.patient_id == profile.id)
        ).all()
        assert len(records) == expected[side]
        for record in records:
            started = record.started_at.replace(tzinfo=UTC)
            assert NOW - timedelta(days=14) <= started <= NOW
            assert record.status == "completed"
            assert record.ended_at is not None
            assert record.current_step == "summary"
    assert count(session, Calibration) == 14
    assert count(session, WarmupResult) == 14 * 6
    assert count(session, GameRun) == 14 * 9
    # 20 trials for each reaching game, 15 flowers, 12 melodies, 10 traces, 8 stripes, 12
    # objects and 8 holds.
    assert count(session, Trial) == 14 * (3 * 20 + 15 + 12 + 10 + 8 + 12 + 8)
    assert count(session, SessionFeedback) == 14


def test_salma_has_exactly_one_unreviewed_pain_alert(session: Session) -> None:
    demo.seed_demo_data(session, now=NOW)

    flagged = session.exec(select(SessionRecord).where(col(SessionRecord.needs_review))).all()

    assert len(flagged) == 1
    alert = flagged[0]
    assert alert.flags == ["pain"]
    assert alert.reviewed_at is None
    profile = session.get(PatientProfile, alert.patient_id)
    assert profile is not None and profile.affected_side == "right"
    feedback = session.exec(
        select(SessionFeedback).where(SessionFeedback.session_id == alert.id)
    ).one()
    assert feedback.pain_0_10 == 5


def session_levels(session: Session, profile: PatientProfile) -> list[float]:
    """The mean level reached over the games of each session, oldest first."""
    records = session.exec(
        select(SessionRecord)
        .where(SessionRecord.patient_id == profile.id)
        .order_by(col(SessionRecord.started_at))
    ).all()
    means = []
    for record in records:
        runs = session.exec(select(GameRun).where(GameRun.session_id == record.id)).all()
        levels = run_levels(session, [run.id for run in runs if run.id is not None])
        assert len(levels) == len(runs)
        means.append(sum(level.end for level in levels.values()) / len(levels))
    return means


def overrides_of(session: Session, profile: PatientProfile) -> list[str]:
    runs = session.exec(
        select(GameRun.id)
        .join(SessionRecord, col(GameRun.session_id) == col(SessionRecord.id))
        .where(SessionRecord.patient_id == profile.id)
    ).all()
    logs = session.exec(
        select(AdaptationLog).where(col(AdaptationLog.game_run_id).in_(list(runs)))
    ).all()
    return [log.safety_override for log in logs if log.safety_override]


def test_engine_decisions_follow_every_demo_trial(session: Session) -> None:
    demo.seed_demo_data(session, now=NOW)

    profiles = {profile.affected_side: profile for profile in demo_profiles(session)}
    for profile in profiles.values():
        assert profile.engine_mode == "L2"
        states = session.exec(
            select(EngineState).where(EngineState.patient_id == profile.id)
        ).all()
        assert sorted(state.game_id for state in states) == sorted(demo.GAMES)
        assert all(state.engine == "L2" and state.trials_seen > 0 for state in states)
        # Stored beliefs: Reach and squeeze's 32 workspace sectors, learned from the trials.
        reach = next(state for state in states if state.game_id == "reach_activate")
        extra = reach.state["extra"]
        assert len(extra["sectors"]) == 32
        assert sum(extra["seen"].values()) > 50
        assert extra["sectors"] != extra["sector_priors"]
    # A decision at the start of each run and after each of its trials, with L2's samples.
    for run in session.exec(select(GameRun)).all():
        assert run.engine == "L2"
        trial_nos = session.exec(
            select(Trial.trial_no).where(Trial.game_run_id == run.id).order_by(col(Trial.trial_no))
        ).all()
        logs = session.exec(
            select(AdaptationLog)
            .where(AdaptationLog.game_run_id == run.id)
            .order_by(col(AdaptationLog.trial_no))
        ).all()
        assert [log.trial_no for log in logs] == [0, *trial_nos]
        if run.game_id == "reach_activate":
            assert all(log.details and "target" in log.details for log in logs)
            assert all("sector_samples" in (log.details or {}) for log in logs[1:])

    # Salma tires and compensates, and the safety rules step in.
    salma = overrides_of(session, profiles["right"])
    assert any(override.startswith("Compensation") for override in salma)
    assert any("Signs of tiring" in override for override in salma)
    # Every level stays on the patient's scale.
    for profile in profiles.values():
        assert all(1 <= level <= 10 for level in session_levels(session, profile))


def test_demo_sessions_have_plans_with_reasons_and_overrides(session: Session) -> None:
    demo.seed_demo_data(session, now=NOW)

    records = session.exec(select(SessionRecord)).all()
    assert len(records) == 14
    reasons: set[str] = set()
    lighter = 0
    for record in records:
        assert record.plan is not None
        plan = record.plan
        assert 3 <= len(plan["games"]) <= 4
        reasons |= {game["reason_key"] for game in plan["games"]}
        lighter += any(note["key"] == "lighter_today" for note in plan["notes"])
        # Demo patients play every game: their change adds the rest to the plan.
        [override] = record.plan_overrides
        assert override["planned"] == [game["game_id"] for game in plan["games"]]
        assert override["games"] == list(demo.GAMES)
        assert sorted(override["added"]) == sorted(
            set(demo.GAMES) - set(override["planned"])
        )
        assert override["removed"] == []
    # The plans use several kinds of reason, and some are lighter.
    assert {"variety", "practise_weak_direction"} <= reasons
    assert any(reason.startswith("focus_") for reason in reasons)
    assert lighter >= 1


def _snapshot(session: Session) -> list[Any]:
    calibrations = session.exec(select(Calibration).order_by(Calibration.created_at)).all()
    trials = session.exec(select(Trial).order_by(Trial.created_at, Trial.trial_no)).all()
    return [
        [c.reach_radii_sw for c in calibrations],
        [(t.outcome, t.target, t.metrics) for t in trials[:60]],
    ]


def test_same_data_every_time(session: Session) -> None:
    demo.seed_demo_data(session, now=NOW)
    first = _snapshot(session)

    demo.seed_demo_data(session, now=NOW)

    assert _snapshot(session) == first
    assert len(demo_profiles(session)) == 2


def test_clear_removes_every_demo_row_and_keeps_real_patients(
    client: TestClient,
    session: Session,
    patient_headers: Headers,
) -> None:
    # A real patient with a session of their own.
    real_session = client.post("/api/sessions", headers=patient_headers).json()["id"]
    demo.seed_demo_data(session, now=NOW)

    removed = demo.clear_demo_data(session)

    assert removed == 2
    assert demo_profiles(session) == []
    assert session.exec(select(User).where(col(User.email).startswith("demo."))).all() == []
    assert count(session, SessionRecord) == 1
    assert session.exec(select(SessionRecord)).one().id == real_session
    for model in (
        Calibration,
        WarmupResult,
        GameRun,
        Trial,
        SessionFeedback,
        AdaptationLog,
        EngineState,
    ):
        assert count(session, model) == 0
    assert authenticate(session, "patient@example.com", PATIENT_PASSWORD) is not None
    assert demo.clear_demo_data(session) == 0


def test_clear_option_of_the_script(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    demo.seed_demo_data(session, now=NOW)
    # The script opens its own session on its engine; point it at the test database.
    monkeypatch.setattr(demo, "engine", session.get_bind())
    monkeypatch.setattr(demo, "create_db_and_tables", lambda: None)

    assert demo.main(["--clear"]) == 0

    session.expire_all()
    assert demo_profiles(session) == []
    assert count(session, Trial) == 0


def test_running_without_options_recreates(
    session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(demo, "engine", session.get_bind())
    monkeypatch.setattr(demo, "create_db_and_tables", lambda: None)

    assert demo.main([]) == 0
    assert demo.main([]) == 0

    session.expire_all()
    assert len(demo_profiles(session)) == 2
    assert count(session, SessionRecord) == 14
    output = capsys.readouterr().out
    assert "demo.rahim@example.com" in output
    assert "demo.salma@example.com" in output


def test_refuses_when_a_real_patient_uses_a_demo_email(
    session: Session, create_patient: Any
) -> None:
    create_patient(email="demo.rahim@example.com")

    with pytest.raises(demo.DemoEmailTakenError):
        demo.seed_demo_data(session, now=NOW)

    assert demo_profiles(session) == []
    assert count(session, SessionRecord) == 0


# What the dashboards then show


def test_dashboards_read_the_demo_data(
    client: TestClient, session: Session, admin_headers: Headers
) -> None:
    logins = dict(demo.seed_demo_data(session))
    rahim = client.post(
        "/api/auth/login",
        data={
            "username": "demo.rahim@example.com",
            "password": logins["demo.rahim@example.com"],
        },
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {rahim}"}

    progress = client.get("/api/patient/progress", headers=headers).json()
    assert len(progress["series"]) == 8
    series = progress["series"]
    assert series[-1]["hull_area_sw2"] > series[0]["hull_area_sw2"]
    assert series[-1]["game_success_rate"] > series[0]["game_success_rate"]
    assert progress["streak_days"] >= 1

    summary = client.get(f"/api/sessions/{series[-1]['session_id']}/summary", headers=headers)
    assert summary.status_code == 200
    body = summary.json()
    assert [game["game_id"] for game in body["games"]] == list(demo.GAMES)
    assert all(game["previous"] is not None for game in body["games"])
    bloom = body["games"][3]
    assert bloom["main_measure"]["name"] == "flowers_grown"
    assert bloom["extra_measures"][0]["value"] is not None
    piano = body["games"][4]
    assert piano["main_measure"]["name"] == "note_hit_rate"
    assert piano["extra_measures"][0]["value"] in demo.FINGERS
    trace, wall = body["games"][5], body["games"][6]
    assert trace["main_measure"]["name"] == "stars"
    assert [measure["name"] for measure in trace["extra_measures"]] == [
        "mean_in_corridor_pct",
        "best_sparc",
    ]
    assert wall["main_measure"]["name"] == "stripes_finished"
    assert wall["extra_measures"][0]["value"] is not None
    pick, grip = body["games"][7], body["games"][8]
    assert pick["main_measure"]["name"] == "objects_placed"
    assert [measure["name"] for measure in pick["extra_measures"]] == [
        "total_drops",
        "mean_transport_ms",
    ]
    assert grip["main_measure"]["name"] == "holds_completed"
    assert grip["extra_measures"][0]["value"] is not None
    # The admin progress tab's hand-game and movement-quality series.
    assert all(point["bloom_peak_openness"] is not None for point in series)
    assert series[-1]["piano_hit_rate"] > series[0]["piano_hit_rate"]
    assert series[-1]["path_sparc"] > series[0]["path_sparc"]  # Closer to 0: smoother.
    assert series[-1]["elbow_range_deg"] > series[0]["elbow_range_deg"]
    assert series[-1]["pick_transport_ms"] < series[0]["pick_transport_ms"]
    assert series[-1]["grip_steadiness"] < series[0]["grip_steadiness"]  # Smaller: steadier.
    assert series[-1]["grip_relaxation_ms"] < series[0]["grip_relaxation_ms"]
    assert body["previous_reach"] is not None

    patients = client.get("/api/admin/patients", headers=admin_headers).json()
    assert sorted(p["user"]["full_name"] for p in patients if p["is_demo"]) == [
        "Demo Rahim",
        "Demo Salma",
    ]
    alerts = client.get("/api/admin/alerts?reviewed=false", headers=admin_headers).json()
    assert len(alerts) == 1
    assert client.get("/api/admin/stats", headers=admin_headers).json()["open_alerts"] == 1
    detail = client.get(f"/api/admin/sessions/{series[-1]['session_id']}", headers=admin_headers)
    assert detail.status_code == 200
    assert len(detail.json()["games"][0]["trials"]) == 20
