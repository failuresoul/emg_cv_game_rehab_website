from typing import cast

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.models import PatientProfile, SessionFeedback
from app.models import Session as SessionRecord
from app.models.user import utc_now
from app.schemas.session_feedback import (
    SafetyFlag,
    SessionFeedbackCreate,
    SessionFeedbackRead,
)
from app.services import safety, session_metrics


class DuplicateFeedbackError(Exception):
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
    # The answers are part of the session's measures (P1-P3); never fails the request.
    session_metrics.compute_quietly(session, record.id)
    # A safety flag is an alert for the admins.
    from app.services import alerts

    alerts.quietly(alerts.questionnaire_alerts, session, record)
    session.refresh(feedback)
    return feedback
