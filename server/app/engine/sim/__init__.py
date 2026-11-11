"""Simulated patients that play the games through the real engines, offline.

For comparing engines (L0, L1, L2) on measures such as challenge error and time in the
60-80% success zone, without patients. Results describe the engines' behaviour on a model of a
patient, not clinical effect.

    from app.engine.sim import simulate, summarise
    summary = summarise(simulate("L1", "moderate", n_patients=20, sessions=5,
                                 trials_per_session=40))
"""

from app.engine.sim.measures import Summary, summarise
from app.engine.sim.patient import PROFILES, Abilities, Attempt, Profile, SimPatient
from app.engine.sim.runner import SimDecision, SimResult, SimTrial, simulate

__all__ = [
    "PROFILES",
    "Abilities",
    "Attempt",
    "Profile",
    "SimDecision",
    "SimPatient",
    "SimResult",
    "SimTrial",
    "Summary",
    "simulate",
    "summarise",
]
