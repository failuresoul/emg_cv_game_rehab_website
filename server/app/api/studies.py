"""Research mode (admin only): studies, enrolment, progress, results and the study export."""

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import SessionDep, require_admin
from app.models import PatientProfile, Study
from app.schemas.study import (
    EnrolRequest,
    ParticipantRead,
    StudyCreate,
    StudyProgress,
    StudyRead,
    StudyResults,
    StudyUpdate,
)
from app.services import studies

router = APIRouter(prefix="/admin/studies", tags=["research"], dependencies=[Depends(require_admin)])


def _study_or_404(session: SessionDep, study_id: int) -> Study:
    study = session.get(Study, study_id)
    if study is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Study not found")
    return study


def _conflict(error: studies.StudyError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))


@router.get("")
def list_studies(session: SessionDep) -> list[StudyRead]:
    return [studies.to_read(session, study) for study in studies.list_studies(session)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_study(payload: StudyCreate, session: SessionDep) -> StudyRead:
    return studies.to_read(session, studies.create(session, payload))


@router.get("/{study_id}")
def get_study(study_id: int, session: SessionDep) -> StudyRead:
    return studies.to_read(session, _study_or_404(session, study_id))


@router.patch("/{study_id}")
def update_study(study_id: int, payload: StudyUpdate, session: SessionDep) -> StudyRead:
    study = _study_or_404(session, study_id)
    try:
        return studies.to_read(session, studies.update(session, study, payload))
    except studies.StudyError as error:
        raise _conflict(error) from None


@router.delete("/{study_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_study(study_id: int, session: SessionDep) -> Response:
    study = _study_or_404(session, study_id)
    try:
        studies.delete(session, study)
    except studies.StudyError as error:
        raise _conflict(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{study_id}/participants", status_code=status.HTTP_201_CREATED)
def enrol(study_id: int, payload: EnrolRequest, session: SessionDep) -> ParticipantRead:
    """Enrols a patient whose research consent is recorded."""
    study = _study_or_404(session, study_id)
    profile = session.get(PatientProfile, payload.patient_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    try:
        participant = studies.enrol(session, study, profile)
    except studies.StudyError as error:
        raise _conflict(error) from None
    return studies.participant_read(participant, profile.patient_code)


@router.post("/{study_id}/participants/{participant_id}/withdraw")
def withdraw(study_id: int, participant_id: int, session: SessionDep) -> ParticipantRead:
    study = _study_or_404(session, study_id)
    participant = studies.get_participant(session, study, participant_id)
    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    participant = studies.withdraw(session, participant)
    profile = session.get(PatientProfile, participant.patient_id)
    return studies.participant_read(participant, profile.patient_code if profile else "?")


@router.get("/{study_id}/progress")
def study_progress(study_id: int, session: SessionDep) -> StudyProgress:
    """Per participant: completed sessions per condition and the next condition."""
    return studies.progress(session, _study_or_404(session, study_id))


@router.get("/{study_id}/results")
def study_results(study_id: int, session: SessionDep) -> StudyResults:
    """Per condition, with 95% confidence intervals over participants."""
    return studies.results(session, _study_or_404(session, study_id))


@router.get("/{study_id}/export.csv", response_class=Response)
def export_study(study_id: int, session: SessionDep) -> Response:
    """Every trial of the study's completed sessions, patients by code only."""
    study = _study_or_404(session, study_id)
    return Response(
        content=studies.export_csv(session, study),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="study-{study.id}.csv"'},
    )
