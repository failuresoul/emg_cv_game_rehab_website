"""The feedback report: its Pydantic model, its word limits and the JSON schema given to Ollama
as `format`, which keeps the model's answer to this shape."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ReportLanguage = Literal["en", "bn"]

#: The most words each text may have.
WORD_LIMITS = {
    "patient_summary": 120,
    "highlights.text": 20,
    "suggestions.text": 35,
    "next_session_text": 40,
    "therapist_summary": 150,
}
MAX_HIGHLIGHTS = 3
MAX_SUGGESTIONS = 3


class Highlight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_id: str
    text: str = Field(min_length=1)


class SuggestionText(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: A suggestion id from the session's candidates (rules.candidates).
    id: str
    text: str = Field(min_length=1)


class Report(BaseModel):
    """What the model writes (or the fallback builds). Patient text is in `language`; the
    therapist summary is always English."""

    model_config = ConfigDict(extra="forbid")

    language: ReportLanguage
    patient_summary: str = Field(min_length=1)
    highlights: list[Highlight] = Field(max_length=MAX_HIGHLIGHTS)
    #: 1-3 when the session has candidates; the validator checks the minimum.
    suggestions: list[SuggestionText] = Field(max_length=MAX_SUGGESTIONS)
    next_session_text: str = Field(min_length=1)
    therapist_summary: str = Field(min_length=1)


def _string_or_enum(values: list[str]) -> dict[str, Any]:
    return {"type": "string", "enum": values} if values else {"type": "string"}


def report_json_schema(
    language: ReportLanguage, candidate_ids: list[str], metric_ids: list[str]
) -> dict[str, Any]:
    """The JSON schema for Ollama's `format`, flat (no $ref) so every model's grammar can use
    it. Suggestion and metric ids are limited to this session's."""
    metric_ids = list(dict.fromkeys(metric_ids))
    return {
        "type": "object",
        "properties": {
            "language": {"type": "string", "enum": [language]},
            "patient_summary": {"type": "string"},
            "highlights": {
                "type": "array",
                "maxItems": MAX_HIGHLIGHTS if metric_ids else 0,
                "items": {
                    "type": "object",
                    "properties": {
                        "metric_id": _string_or_enum(metric_ids),
                        "text": {"type": "string"},
                    },
                    "required": ["metric_id", "text"],
                },
            },
            "suggestions": {
                "type": "array",
                "minItems": 1 if candidate_ids else 0,
                "maxItems": min(MAX_SUGGESTIONS, len(candidate_ids)),
                "items": {
                    "type": "object",
                    "properties": {
                        "id": _string_or_enum(candidate_ids),
                        "text": {"type": "string"},
                    },
                    "required": ["id", "text"],
                },
            },
            "next_session_text": {"type": "string"},
            "therapist_summary": {"type": "string"},
        },
        "required": [
            "language",
            "patient_summary",
            "highlights",
            "suggestions",
            "next_session_text",
            "therapist_summary",
        ],
    }
