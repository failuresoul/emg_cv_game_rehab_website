"""The blind human evaluation of the feedback (admins): review sets, rating, results."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep, require_admin
from app.feedback import review
from app.feedback.jobs import report_jobs
from app.models import LlmReport, ReportRating, ReviewItem, ReviewSet
from app.schemas.feedback_report import RatingRead
from app.schemas.review import (
    BlindItem,
    BlindItemSummary,
    ReviewRatingCreate,
    ReviewResults,
    ReviewSetCreate,
    ReviewSetRead,
)

router = APIRouter(
    prefix="/admin/review-sets", tags=["review"], dependencies=[Depends(require_admin)]
)


def _set_or_404(db: SessionDep, review_id: int) -> ReviewSet:
    found = db.get(ReviewSet, review_id)
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review set not found")
    return found


def _read(db: SessionDep, found: ReviewSet, user_id: int) -> ReviewSetRead:
    assert found.id is not None
    items = review.items_with_reports(db, found.id)
    return ReviewSetRead(
        id=found.id,
        name=found.name,
        language=found.language,  # type: ignore[arg-type]
        sessions=found.sessions,
        items=len(items),
        ready_items=sum(review.is_ready(report) for _, report in items),
        status=review.set_status(items),  # type: ignore[arg-type]
        my_ratings=len(review.rated_codes(db, found.id, user_id)),
        created_at=found.created_at,
    )


def _ready_items(db: SessionDep, found: ReviewSet) -> list[tuple[ReviewItem, LlmReport]]:
    """The items raters may see: only once every report is written (a report still being
    written would give its version away), and never one that could not be written."""
    assert found.id is not None
    items = review.items_with_reports(db, found.id)
    if review.set_status(items) != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="The reports are still being written"
        )
    return [(item, report) for item, report in items if review.is_ready(report)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_set(payload: ReviewSetCreate, db: SessionDep, user: CurrentUser) -> ReviewSetRead:
    """Chooses sessions (real and demo), writes the template reports now and queues the LLM
    reports behind patients' reports."""
    assert user.id is not None
    try:
        found, jobs = review.create_review_set(
            db, payload.size, payload.language, user.id, payload.name
        )
    except review.NoSessionsError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="No completed sessions to review"
        ) from None
    for report_id in jobs:
        report_jobs.enqueue(report_id, background=True)
    return _read(db, found, user.id)


@router.get("")
def list_sets(db: SessionDep, user: CurrentUser) -> list[ReviewSetRead]:
    assert user.id is not None
    sets = db.exec(select(ReviewSet).order_by(col(ReviewSet.id).desc())).all()
    return [_read(db, found, user.id) for found in sets]


@router.get("/{review_id}")
def get_set(review_id: int, db: SessionDep, user: CurrentUser) -> ReviewSetRead:
    assert user.id is not None
    return _read(db, _set_or_404(db, review_id), user.id)


@router.get("/{review_id}/items")
def list_items(review_id: int, db: SessionDep, user: CurrentUser) -> list[BlindItemSummary]:
    """The items in their shuffled order, by code only."""
    found = _set_or_404(db, review_id)
    assert user.id is not None
    mine = review.rated_codes(db, review_id, user.id)
    return [
        BlindItemSummary(code=item.code, position=item.position, rated_by_me=item.code in mine)
        for item, _ in _ready_items(db, found)
    ]


def _item_or_404(db: SessionDep, found: ReviewSet, code: str) -> tuple[ReviewItem, LlmReport]:
    for item, report in _ready_items(db, found):
        if item.code == code:
            return item, report
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")


@router.get("/{review_id}/items/{code}")
def get_item(review_id: int, code: str, db: SessionDep, user: CurrentUser) -> BlindItem:
    """One report, blind: its facts sheet, the fixed notices and the patient's text."""
    found = _set_or_404(db, review_id)
    item, stored = _item_or_404(db, found, code)
    mine = db.exec(
        select(ReportRating).where(
            ReportRating.report_id == item.report_id,
            ReportRating.rater_user_id == user.id,
            ReportRating.review_set_id == review_id,
        )
    ).first()
    return BlindItem(
        code=item.code,
        position=item.position,
        total=len(_ready_items(db, found)),
        facts=review.blind_facts(stored.facts),
        safety_notices=stored.safety_notices,
        report=review.blind_report(stored),
        my_rating=RatingRead.model_validate(mine) if mine else None,
    )


@router.post("/{review_id}/items/{code}/rating", status_code=status.HTTP_201_CREATED)
def rate_item(
    review_id: int, code: str, payload: ReviewRatingCreate, db: SessionDep, user: CurrentUser
) -> RatingRead:
    """The rubric's scores, "unsafe" and any unsupported sentence; once per rater per item."""
    found = _set_or_404(db, review_id)
    item, _ = _item_or_404(db, found, code)
    assert user.id is not None
    already = db.exec(
        select(ReportRating).where(
            ReportRating.report_id == item.report_id, ReportRating.rater_user_id == user.id
        )
    ).first()
    if already is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already rated")
    rating = ReportRating(
        report_id=item.report_id,
        rater=payload.rater,
        rater_user_id=user.id,
        scores=payload.scores.model_dump(),
        comment=payload.comment or None,
        review_set_id=review_id,
        unsafe=payload.unsafe,
        unsupported_text=payload.unsupported or None,
    )
    db.add(rating)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already rated") from None
    db.refresh(rating)
    return RatingRead.model_validate(rating)


@router.get("/{review_id}/results")
def get_results(review_id: int, db: SessionDep) -> ReviewResults:
    """Means per version and dimension, % unsafe and agreement between raters."""
    _set_or_404(db, review_id)
    return ReviewResults.model_validate(review.results(db, review_id))


@router.get("/{review_id}/export.csv", response_class=Response)
def export_ratings(review_id: int, db: SessionDep) -> Response:
    """Every rating with its item's version: the data behind the results."""
    _set_or_404(db, review_id)
    return Response(
        content=review.export_csv(db, review_id),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="muvi-report-review-{review_id}.csv"'
        },
    )
