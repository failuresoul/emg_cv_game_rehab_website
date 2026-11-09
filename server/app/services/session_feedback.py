from typing import cast

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.models import PatientProfile, SessionFeedback
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.session_feedback import (
    AdminAlert,
    SafetyFlag,
    SessionFeedbackCreate,
    SessionFeedbackRead,
)
from app.services import safety


class DuplicateFeedbackError(Exception):
    pass


class AlertNotFoundError(Exception):
    pass


class AlreadyReviewedError(Exception):
    pass


def _flags(record: SessionRecord) -> list[SafetyFlag]:
    return cast(list[SafetyFlag], list(record.flags or []))


def to_read(feedback: SessionFeedback, record: SessionRecord) -> SessionFeedbackRead:
    # getattr, unlike model_dump(), reloads the fields that a commit has expired.
    fields = {name: getattr(feedback, name) for name in SessionFeedback.model_fields}
    return SessionFeedbackRead(
        **fields,
        flags=_flags(record),
        needs_review=record.needs_review,
    )


def get_feedback(session: Session, session_id: int) -> SessionFeedback | None:
    return session.exec(
        select(SessionFeedback).where(SessionFeedback.session_id == session_id)
    ).first()


def save_feedback(
    session: Session, record: SessionRecord, payload: SessionFeedbackCreate
) -> SessionFeedback:
    """Saves the questionnaire once, and sets the session's safety flags from it.

    Allowed whatever the session's status: the answers matter even if the session ended first.
    """
    assert record.id is not None
    if get_feedback(session, record.id) is not None:
        raise DuplicateFeedbackError

    feedback = SessionFeedback(**payload.model_dump(), session_id=record.id)
    flags = safety.flags_for(payload)
    record.flags = list(flags)
    record.needs_review = safety.needs_review(flags)
    session.add(feedback)
    session.add(record)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise DuplicateFeedbackError from None
    return feedback


def _alert(record: SessionRecord, profile: PatientProfile) -> AdminAlert:
    assert record.id is not None
    return AdminAlert(
        session_id=record.id,
        patient_id=record.patient_id,
        patient_code=profile.patient_code,
        date=record.started_at,
        flags=_flags(record),
        reviewed=record.reviewed_at is not None,
        reviewed_at=record.reviewed_at,
        review_note=record.review_note,
    )


def list_alerts(session: Session, reviewed: bool | None = None) -> list[AdminAlert]:
    """Sessions that need review, newest first. reviewed=None lists both kinds."""
    statement = (
        select(SessionRecord, PatientProfile)
        .join(PatientProfile, col(PatientProfile.id) == col(SessionRecord.patient_id))
        .where(col(SessionRecord.needs_review).is_(True))
        .order_by(col(SessionRecord.started_at).desc(), col(SessionRecord.id).desc())
    )
    if reviewed is True:
        statement = statement.where(col(SessionRecord.reviewed_at).is_not(None))
    elif reviewed is False:
        statement = statement.where(col(SessionRecord.reviewed_at).is_(None))
    return [_alert(record, profile) for record, profile in session.exec(statement).all()]


def review_alert(session: Session, session_id: int, note: str | None) -> AdminAlert:
    record = session.get(SessionRecord, session_id)
    if record is None or not record.needs_review:
        raise AlertNotFoundError
    if record.reviewed_at is not None:
        raise AlreadyReviewedError
    record.reviewed_at = utc_now()
    record.review_note = note
    session.add(record)
    session.commit()
    profile = session.get(PatientProfile, record.patient_id)
    assert profile is not None
    return _alert(record, profile)


def count_open_alerts(session: Session) -> int:
    statement = (
        select(func.count())
        .select_from(SessionRecord)
        .where(
            col(SessionRecord.needs_review).is_(True),
            col(SessionRecord.reviewed_at).is_(None),
        )
    )
    return session.exec(statement).one()
