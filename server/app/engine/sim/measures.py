"""Outcome measures for a simulation, each a pure function of the trials.

- **Rolling success:** the success rate over the last WINDOW trials (full windows only).
- **Challenge error:** the mean |rolling success - TARGET|.
- **Time in zone:** the share of rolling values within ZONE (0.6-0.8).
- **Trials to converge:** the first trial from which the rolling success stays in the zone for
  STAY consecutive values, as a trial number; None if it never does.
- **Compensation rate:** the share of trials with compensation.
- **Workspace coverage:** sectors visited at least MIN_VISITS times.
- **Learning gain:** the mean change of every ability (eight reaches, activation, speed and
  precision) between two snapshots.

Rolling measures are computed per run (one patient's session) and then averaged, so one
session's end never mixes with the next one's start.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from statistics import fmean

from app.engine.sim.patient import Abilities
from app.engine.sim.runner import SimResult, SimTrial

WINDOW = 10
TARGET = 0.7
ZONE = (0.6, 0.8)
STAY = 10
MIN_VISITS = 3
#: 8 directions x 3 rings.
SECTOR_COUNT = 24
EPSILON = 1e-9


def rolling_success(successes: Sequence[bool], window: int = WINDOW) -> list[float]:
    """The success rate of each full window, ending at trial `window`, `window` + 1, ..."""
    values: list[float] = []
    running = 0
    for index, success in enumerate(successes):
        running += success
        if index >= window:
            running -= successes[index - window]
        if index >= window - 1:
            values.append(running / window)
    return values


def in_zone(value: float, zone: tuple[float, float] = ZONE) -> bool:
    return zone[0] - EPSILON <= value <= zone[1] + EPSILON


def challenge_error(rolling: Sequence[float], target: float = TARGET) -> float | None:
    return fmean(abs(value - target) for value in rolling) if rolling else None


def time_in_zone(rolling: Sequence[float], zone: tuple[float, float] = ZONE) -> float | None:
    return sum(in_zone(value, zone) for value in rolling) / len(rolling) if rolling else None


def trials_to_converge(
    rolling: Sequence[float],
    window: int = WINDOW,
    stay: int = STAY,
    zone: tuple[float, float] = ZONE,
) -> int | None:
    """The trial number at which the rolling success enters the zone and stays there for `stay`
    consecutive values; None if it never does."""
    run = 0
    for index, value in enumerate(rolling):
        run = run + 1 if in_zone(value, zone) else 0
        if run == stay:
            first = index - stay + 1
            # rolling[i] ends at trial i + window.
            return first + window
    return None


def compensation_rate(flags: Sequence[bool]) -> float | None:
    return sum(flags) / len(flags) if flags else None


def workspace_coverage(sectors: Iterable[str | None], min_visits: int = MIN_VISITS) -> int:
    """How many sectors were visited at least `min_visits` times."""
    counts = Counter(sector for sector in sectors if sector is not None)
    return sum(count >= min_visits for count in counts.values())


def learning_gain(before: Abilities, after: Abilities) -> float:
    return fmean(b - a for a, b in zip(before.values(), after.values(), strict=True))


@dataclass(frozen=True)
class RunMeasures:
    """The measures of one patient's session."""

    patient: int
    session: int
    trials: int
    success_rate: float
    challenge_error: float | None
    time_in_zone: float | None
    trials_to_converge: int | None
    compensation_rate: float | None
    coverage: int
    mean_level: float


def runs(trials: Iterable[SimTrial]) -> dict[tuple[int, int], list[SimTrial]]:
    grouped: dict[tuple[int, int], list[SimTrial]] = defaultdict(list)
    for trial in trials:
        grouped[(trial.patient, trial.session)].append(trial)
    return dict(grouped)


def measure_run(trials: Sequence[SimTrial]) -> RunMeasures:
    successes = [trial.success for trial in trials]
    rolling = rolling_success(successes)
    return RunMeasures(
        patient=trials[0].patient,
        session=trials[0].session,
        trials=len(trials),
        success_rate=sum(successes) / len(successes),
        challenge_error=challenge_error(rolling),
        time_in_zone=time_in_zone(rolling),
        trials_to_converge=trials_to_converge(rolling),
        compensation_rate=compensation_rate([trial.compensated for trial in trials]),
        coverage=workspace_coverage(trial.sector for trial in trials),
        mean_level=fmean(trial.level for trial in trials),
    )


def _mean(values: Iterable[float | None]) -> float | None:
    found = [value for value in values if value is not None]
    return fmean(found) if found else None


@dataclass(frozen=True)
class Summary:
    """A simulation's measures, averaged over every patient's sessions."""

    engine: str
    profile: str
    game_id: str
    runs: int
    success_rate: float
    challenge_error: float | None
    time_in_zone: float | None
    #: The mean over the runs that converged, and the share of runs that did.
    trials_to_converge: float | None
    converged_share: float
    compensation_rate: float | None
    coverage: float
    learning_gain: float | None


def summarise(result: SimResult) -> Summary:
    measured = [measure_run(trials) for trials in runs(result.trials).values()]
    gains = [learning_gain(history[0], history[-1]) for history in result.abilities if history]
    converged = [run.trials_to_converge for run in measured if run.trials_to_converge is not None]
    return Summary(
        engine=result.engine,
        profile=result.profile,
        game_id=result.game_id,
        runs=len(measured),
        success_rate=fmean(run.success_rate for run in measured),
        challenge_error=_mean(run.challenge_error for run in measured),
        time_in_zone=_mean(run.time_in_zone for run in measured),
        trials_to_converge=fmean(converged) if converged else None,
        converged_share=len(converged) / len(measured) if measured else 0.0,
        compensation_rate=_mean(run.compensation_rate for run in measured),
        coverage=fmean(run.coverage for run in measured),
        learning_gain=fmean(gains) if gains else None,
    )
