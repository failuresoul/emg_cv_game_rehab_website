"""Every alert in one place: what raises each one, and acknowledging and resolving them.

Generators (each idempotent: an alert's `cause_key` is unique, so running a generator again never
makes a second alert for the same cause):

- **pain, new_symptoms** (high) and **high_fatigue** (medium): the questionnaire's safety flags,
  one alert per flag and session.
- **sharp_decline** (high): the feedback module's red-flag rule (app/feedback/rules.py) on the
  session's facts, when the session ends.
- **missed_sessions** (low): no completed session for MISSED_DAYS days or more while the weekly
  goal is above 0 (active patients only). One alert per "last completed session", so a patient
  who comes back and then stops again gets a new one. Checked when the server starts and when
  the admin overview loads.
- **repeated_device_problems** (low): DEVICE_STREAK sessions in a row with a device problem
  (see device_problems). One alert per streak.
- **llm_fallback_rate** (low, system-wide): more than 30% of the last 10 finished reports used
  the template. At most one unresolved at a time.

Questionnaire alerts and the session's review: when the last unresolved questionnaire alert of a
session is resolved, the session is marked reviewed with the note (the session page shows it).
"""

import logging
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import Engine, func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.models import Alert, GameRun, LlmReport, PatientProfile, SessionFeedback, Trial, User
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.alert import AlertCounts, AlertRead
from app.schemas.common import as_utc

logger = logging.getLogger(__name__)

SEVERITY: dict[str, str] = {
    "pain": "high",
    "new_symptoms": "high",
    "high_fatigue": "medium",
    "sharp_decline": "high",
    "missed_sessions": "low",
    "repeated_device_problems": "low",
    "llm_fallback_rate": "low",
}
QUESTIONNAIRE_TYPES = ("pain", "new_symptoms", "high_fatigue")
MISSED_DAYS = 4
DEVICE_STREAK = 3
#: The camera is a problem below this frame rate.
MIN_FPS = 15.0
LLM_WINDOW = 10
LLM_MAX_FALLBACK_SHARE = 0.3
UNRESOLVED = ("open", "acknowledged")


class AlertNotFoundError(LookupError):
    pass


class AlertStateError(ValueError):
    """The alert cannot move to that status (resolved is final; acknowledged only once)."""


def _create(
    session: Session,
    *,
    type: str,
    cause_key: str,
    patient_id: int | None,
    session_id: int | None = None,
    details: dict[str, Any] | None = None,
    created_at: datetime | None = None,
    status: str = "open",
    resolved_at: datetime | None = None,
    note: str | None = None,
) -> Alert | None:
    """Adds the alert unless one with the same cause exists; returns it if it was added."""
    if session.exec(select(Alert.id).where(Alert.cause_key == cause_key)).first() is not None:
        return None
    alert = Alert(
        type=type,
        severity=SEVERITY[type],
        cause_key=cause_key,
        patient_id=patient_id,
        session_id=session_id,
        details=details or {},
        created_at=created_at or utc_now(),
        status=status,
        resolved_at=resolved_at,
        note=note,
    )
    session.add(alert)
    try:
        session.commit()
    except IntegrityError:
        # The same cause at the same moment: the first one stands.
        session.rollback()
        return None
    session.refresh(alert)
    return alert


# ---- Generators ---------------------------------------------------------------------------------


def questionnaire_alerts(session: Session, record: SessionRecord) -> list[Alert]:
    """One alert per safety flag of the session's questionnaire. A session already reviewed (from
    before Day 17) gets its alerts resolved, with the review's note and time."""
    assert record.id is not None
    feedback = session.exec(
        select(SessionFeedback).where(SessionFeedback.session_id == record.id)
    ).first()
    made = []
    for flag in record.flags or []:
        if flag not in QUESTIONNAIRE_TYPES:
            continue
        details: dict[str, Any] = {}
        if feedback is not None:
            details = {
                "pain_0_10": feedback.pain_0_10,
                "fatigue_0_10": feedback.fatigue_0_10,
                "new_symptoms": feedback.new_symptoms,
            }
        reviewed = record.reviewed_at is not None
        alert = _create(
            session,
            type=flag,
            cause_key=f"questionnaire:{record.id}:{flag}",
            patient_id=record.patient_id,
            session_id=record.id,
            details=details,
            created_at=feedback.created_at if feedback else record.started_at,
            status="resolved" if reviewed else "open",
            resolved_at=record.reviewed_at,
            note=record.review_note if reviewed else None,
        )
        if alert is not None:
            made.append(alert)
    return made


def migrate_session_flags(target: Engine | Session) -> int:
    """Alert rows for every flagged session (the questionnaire alerts before Day 17)."""
    def run(session: Session) -> int:
        records = session.exec(
            select(SessionRecord).where(col(SessionRecord.needs_review).is_(True))
        ).all()
        return sum(len(questionnaire_alerts(session, record)) for record in records)

    if isinstance(target, Session):
        return run(target)
    with Session(target) as session:
        return run(session)


def sharp_decline_alert(session: Session, record: SessionRecord) -> Alert | None:
    """The feedback module's sharp-decline red flag, on the session's facts."""
    from app.feedback.rules import red_flags
    from app.services.session_facts import build_facts

    assert record.id is not None
    facts = build_facts(session, record)
    flag = next((f for f in red_flags(facts) if f.code == "sharp_decline"), None)
    if flag is None:
        return None
    return _create(
        session,
        type="sharp_decline",
        cause_key=f"sharp_decline:{record.id}",
        patient_id=record.patient_id,
        session_id=record.id,
        details={"metrics": [evidence.as_dict() for evidence in flag.evidence]},
    )


def _last_completed(session: Session, patient_id: int) -> SessionRecord | None:
    return session.exec(
        select(SessionRecord)
        .where(SessionRecord.patient_id == patient_id, SessionRecord.status == "completed")
        .order_by(col(SessionRecord.started_at).desc())
    ).first()


def missed_sessions_alerts(session: Session, now: datetime | None = None) -> list[Alert]:
    """Active patients with a weekly goal and no completed session for MISSED_DAYS days."""
    from app.services import programme as programmes

    now = as_utc(now or utc_now())
    made = []
    rows = session.exec(
        select(PatientProfile, User)
        .join(User, col(User.id) == col(PatientProfile.user_id))
        .where(col(User.is_active).is_(True))
    ).all()
    for profile, _user in rows:
        assert profile.id is not None
        if programmes.programme_for(session, profile).weekly_goal <= 0:
            continue
        last = _last_completed(session, profile.id)
        since = as_utc(last.ended_at or last.started_at) if last else as_utc(profile.created_at)
        days = (now - since).total_seconds() / 86_400
        if days < MISSED_DAYS:
            continue
        alert = _create(
            session,
            type="missed_sessions",
            cause_key=f"missed_sessions:{profile.id}:{last.id if last else 'none'}",
            patient_id=profile.id,
            session_id=last.id if last else None,
            details={
                "days_since": int(days),
                "last_session_at": since.isoformat() if last else None,
            },
        )
        if alert is not None:
            made.append(alert)
    return made


def device_problems(session: Session, record: SessionRecord) -> list[str]:
    """Why a finished session counts as having device problems; empty when it does not.

    - "session_aborted" / "game_aborted": the session or one of its games was stopped early;
    - "emg_fallback": a game started with the muscle sensor had trials the sensor did not drive
      (it paused, so the camera took over);
    - "low_fps": the camera ran below MIN_FPS frames per second.
    """
    problems: list[str] = []
    if record.status == "aborted":
        problems.append("session_aborted")
    runs = session.exec(select(GameRun).where(GameRun.session_id == record.id)).all()
    if any(run.status == "aborted" for run in runs):
        problems.append("game_aborted")
    emg_runs = [run.id for run in runs if run.input_source == "emg" and run.id is not None]
    if emg_runs:
        # A trial the sensor did not drive has no EMG record (stored as JSON null, so checked
        # here rather than in SQL).
        records = session.exec(select(Trial.emg).where(col(Trial.game_run_id).in_(emg_runs))).all()
        if any(not record for record in records):
            problems.append("emg_fallback")
    fps = (record.device_info or {}).get("fps")
    if isinstance(fps, int | float) and fps < MIN_FPS:
        problems.append("low_fps")
    return problems


def device_problem_alert(session: Session, patient_id: int) -> Alert | None:
    """DEVICE_STREAK finished sessions in a row, the latest included, with device problems."""
    records = session.exec(
        select(SessionRecord)
        .where(SessionRecord.patient_id == patient_id, SessionRecord.status != "active")
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
    ).all()
    streak: list[tuple[SessionRecord, list[str]]] = []
    for record in records:
        problems = device_problems(session, record)
        if not problems:
            break
        streak.append((record, problems))
    if len(streak) < DEVICE_STREAK:
        return None
    first = streak[-1][0]
    return _create(
        session,
        type="repeated_device_problems",
        # The streak's first session: the same streak, however long, raises one alert.
        cause_key=f"repeated_device_problems:{patient_id}:{first.id}",
        patient_id=patient_id,
        session_id=streak[0][0].id,
        details={
            "sessions": [
                {"session_id": record.id, "problems": problems} for record, problems in reversed(streak)
            ]
        },
    )


def llm_fallback_alert(session: Session) -> Alert | None:
    """More than 30% of the last LLM_WINDOW finished patient reports used the template."""
    reports = session.exec(
        select(LlmReport)
        .where(
            col(LlmReport.status).in_(["done", "fallback"]),
            col(LlmReport.review_set_id).is_(None),
        )
        .order_by(col(LlmReport.finished_at).desc(), col(LlmReport.id).desc())
        .limit(LLM_WINDOW)
    ).all()
    if len(reports) < LLM_WINDOW:
        return None
    share = sum(report.status == "fallback" for report in reports) / len(reports)
    if share <= LLM_MAX_FALLBACK_SHARE:
        return None
    unresolved = session.exec(
        select(Alert.id).where(
            Alert.type == "llm_fallback_rate", col(Alert.status).in_(UNRESOLVED)
        )
    ).first()
    if unresolved is not None:
        return None
    oldest = min(report.id or 0 for report in reports)
    return _create(
        session,
        type="llm_fallback_rate",
        cause_key=f"llm_fallback_rate:{oldest}",
        patient_id=None,
        details={"fallback_share": round(share, 2), "reports": len(reports)},
    )


def after_session_end(session: Session, record: SessionRecord) -> None:
    """The alerts a finished session can raise; never fails the request."""
    try:
        if record.status == "completed":
            sharp_decline_alert(session, record)
        device_problem_alert(session, record.patient_id)
    except Exception:
        session.rollback()
        logger.exception("Alerts for session %s could not be checked", record.id)


def quietly(action: Any, *args: Any) -> None:
    """Runs a generator, logging rather than raising."""
    try:
        action(*args)
    except Exception:
        logger.exception("An alert check failed")


def daily_checks(target: Engine | Session, now: datetime | None = None) -> None:
    """Missed sessions and the template rate: at start-up and when the admin overview loads."""
    def run(session: Session) -> None:
        missed_sessions_alerts(session, now)
        llm_fallback_alert(session)

    if isinstance(target, Session):
        run(target)
        return
    with Session(target) as session:
        run(session)


# ---- Reading and changing -------------------------------------------------------------------------


def _codes(session: Session, ids: Iterable[int | None]) -> dict[int, str]:
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = session.exec(select(PatientProfile).where(col(PatientProfile.id).in_(wanted))).all()
    return {row.id: row.patient_code for row in rows if row.id is not None}


def to_reads(session: Session, alerts: Sequence[Alert]) -> list[AlertRead]:
    codes = _codes(session, (a.patient_id for a in alerts))
    return [
        AlertRead.model_validate(alert).model_copy(
            update={"patient_code": codes.get(alert.patient_id) if alert.patient_id else None}
        )
        for alert in alerts
    ]


def list_alerts(
    session: Session,
    status: Sequence[str] | None = None,
    type: Sequence[str] | None = None,
    severity: Sequence[str] | None = None,
    patient_id: int | None = None,
    session_id: int | None = None,
    limit: int = 500,
) -> list[Alert]:
    """Newest first; high before medium before low on the same moment."""
    statement = select(Alert)
    if status:
        statement = statement.where(col(Alert.status).in_(list(status)))
    if type:
        statement = statement.where(col(Alert.type).in_(list(type)))
    if severity:
        statement = statement.where(col(Alert.severity).in_(list(severity)))
    if patient_id is not None:
        statement = statement.where(Alert.patient_id == patient_id)
    if session_id is not None:
        statement = statement.where(Alert.session_id == session_id)
    statement = statement.order_by(col(Alert.created_at).desc(), col(Alert.id).desc()).limit(limit)
    return list(session.exec(statement).all())


def get(session: Session, alert_id: int) -> Alert:
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise AlertNotFoundError
    return alert


def _sync_session_review(session: Session, alert: Alert) -> None:
    """A session's questionnaire is reviewed once none of its questionnaire alerts is left."""
    if alert.type not in QUESTIONNAIRE_TYPES or alert.session_id is None:
        return
    left = session.exec(
        select(Alert.id).where(
            Alert.session_id == alert.session_id,
            col(Alert.type).in_(QUESTIONNAIRE_TYPES),
            col(Alert.status).in_(UNRESOLVED),
        )
    ).first()
    record = session.get(SessionRecord, alert.session_id)
    if left is None and record is not None and record.reviewed_at is None:
        record.reviewed_at = alert.resolved_at or utc_now()
        record.review_note = alert.note
        session.add(record)
        session.commit()


def acknowledge(session: Session, alert: Alert, admin_id: int | None, note: str | None) -> Alert:
    """Seen and being dealt with: open -> acknowledged."""
    if alert.status != "open":
        raise AlertStateError(f"A {alert.status} alert cannot be acknowledged")
    alert.status = "acknowledged"
    alert.acknowledged_by = admin_id
    alert.acknowledged_at = utc_now()
    if note:
        alert.note = note
    session.add(alert)
    session.commit()
    session.refresh(alert)
    return alert


def resolve(session: Session, alert: Alert, admin_id: int | None, note: str | None) -> Alert:
    """Dealt with: open or acknowledged -> resolved, which is final."""
    if alert.status == "resolved":
        raise AlertStateError("The alert is already resolved")
    alert.status = "resolved"
    alert.resolved_by = admin_id
    alert.resolved_at = utc_now()
    if note:
        alert.note = note
    session.add(alert)
    session.commit()
    session.refresh(alert)
    _sync_session_review(session, alert)
    return alert


def resolve_session(
    session: Session, session_id: int, admin_id: int | None, note: str | None
) -> list[Alert]:
    """Resolves every unresolved alert of one session (the session page's "Mark reviewed")."""
    alerts = list_alerts(session, status=UNRESOLVED, session_id=session_id)
    if not alerts:
        raise AlertNotFoundError
    return [resolve(session, alert, admin_id, note) for alert in alerts]


def counts(session: Session) -> AlertCounts:
    rows = session.exec(
        select(Alert.status, Alert.severity, func.count())
        .where(col(Alert.status).in_(UNRESOLVED))
        .group_by(Alert.status, Alert.severity)
    ).all()
    out = AlertCounts()
    for status, severity, n in rows:
        if status == "acknowledged":
            out.acknowledged += n
            continue
        out.open += n
        if severity == "high":
            out.open_high += n
        elif severity == "medium":
            out.open_medium += n
        else:
            out.open_low += n
    return out


__all__ = [
    "AlertNotFoundError",
    "AlertStateError",
    "acknowledge",
    "after_session_end",
    "counts",
    "daily_checks",
    "device_problem_alert",
    "device_problems",
    "llm_fallback_alert",
    "list_alerts",
    "migrate_session_flags",
    "missed_sessions_alerts",
    "questionnaire_alerts",
    "resolve",
    "resolve_session",
    "sharp_decline_alert",
    "to_reads",
]
