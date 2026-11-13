"""The muscle-sensor (EMG) calibration API."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.common import UtcDatetime

EmgSite = Literal["flexors", "extensors"]
EmgSourceKind = Literal["serial", "simulated"]
#: The ADC's range at the ESP32's pin.
Millivolts = Annotated[float, Field(ge=0, le=3600)]
#: Onset threshold: rest mean + THRESHOLD_SD x rest SD.
THRESHOLD_SD = 3


def threshold_mv(rest_mean_mv: float, rest_sd_mv: float) -> float:
    return round(rest_mean_mv + THRESHOLD_SD * rest_sd_mv, 2)


class EmgDeviceInfo(BaseModel):
    """The sensor as the session used it (in the session's device_info)."""

    model_config = ConfigDict(extra="forbid")

    connected: bool
    source: EmgSourceKind | None = None
    site: EmgSite | None = None
    firmware_version: Annotated[str, StringConstraints(max_length=32)] | None = None


class EmgCalibrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    site: EmgSite
    source: EmgSourceKind
    firmware_version: Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)] | None = None
    sample_rate: float = Field(ge=50, le=2000)
    rest_mean_mv: Millivolts
    rest_sd_mv: float = Field(ge=0, le=1000)
    mvc_mv: Millivolts
    mvc_attempts: list[Millivolts] = Field(min_length=1, max_length=6)
    readiness: dict[str, Any] = Field(default_factory=dict)
    quality: dict[str, Any] = Field(default_factory=dict)
    battery_ok: bool
    gain_note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None = None

    @model_validator(mode="after")
    def mvc_above_threshold(self) -> "EmgCalibrationCreate":
        threshold = threshold_mv(self.rest_mean_mv, self.rest_sd_mv)
        if self.mvc_mv <= threshold:
            raise ValueError(
                f"mvc_mv ({self.mvc_mv}) must be above rest_mean_mv + 3 x rest_sd_mv ({threshold})"
            )
        # The safety rule: a real sensor on a person only with the laptop on battery.
        if self.source == "serial" and not self.battery_ok:
            raise ValueError("battery_ok must be true with a real sensor (laptop on battery)")
        return self


class EmgCalibrationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    site: EmgSite
    source: EmgSourceKind
    firmware_version: str | None
    sample_rate: float
    rest_mean_mv: float
    rest_sd_mv: float
    mvc_mv: float
    mvc_attempts: list[float]
    threshold_mv: float
    readiness: dict[str, Any]
    quality: dict[str, Any]
    battery_ok: bool
    gain_note: str | None
    created_at: UtcDatetime
