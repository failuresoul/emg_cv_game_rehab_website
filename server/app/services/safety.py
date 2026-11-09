"""Safety flags raised by the cool-down questionnaire.

Every rule lives here, so the thresholds can be changed in one place. A flag only asks a
therapist to look at the session: it is not a diagnosis.
"""

from typing import Protocol

from app.schemas.session_feedback import SafetyFlag

# To be confirmed with supervisor.
PAIN_FLAG_MIN = 4
# To be confirmed with supervisor.
HIGH_FATIGUE_FLAG_MIN = 8


class QuestionnaireAnswers(Protocol):
    pain_0_10: int
    fatigue_0_10: int
    new_symptoms: bool


def flags_for(answers: QuestionnaireAnswers) -> list[SafetyFlag]:
    """The flags in a fixed order: pain, new_symptoms, high_fatigue."""
    flags: list[SafetyFlag] = []
    if answers.pain_0_10 >= PAIN_FLAG_MIN:
        flags.append("pain")
    if answers.new_symptoms:
        flags.append("new_symptoms")
    if answers.fatigue_0_10 >= HIGH_FATIGUE_FLAG_MIN:
        flags.append("high_fatigue")
    return flags


def needs_review(flags: list[SafetyFlag]) -> bool:
    return len(flags) > 0
