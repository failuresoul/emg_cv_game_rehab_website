"""Parameter engines: they set each trial's difficulty within the game's spec bounds and the
admin's limits, and explain every change in plain words.

- L0 (l0_fixed): always the admin's defaults.
- L1 (l1_staircase): a transformed up-down staircase per difficulty component.
- L2 (l2_bayes): Bayesian beliefs per workspace sector and difficulty level, with Thompson
  sampling (docs/ai-engine.md).
"""

from app.engine.base import Engine
from app.engine.l0_fixed import FixedEngine
from app.engine.l1_staircase import StaircaseEngine
from app.engine.l2_bayes import BayesEngine

ENGINE_MODES = ("L0", "L1", "L2")


def get_engine(mode: str) -> Engine:
    """The engine for a patient's engine_mode; an unknown mode is L1."""
    if mode == "L0":
        return FixedEngine()
    if mode == "L2":
        return BayesEngine()
    return StaircaseEngine(name="L1")
