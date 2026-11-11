"""Parameter engines: they set each trial's difficulty within the game's spec bounds and the
admin's limits, and explain every change in plain words.

- L0 (l0_fixed): always the admin's defaults.
- L1 (l1_staircase): a transformed up-down staircase per difficulty component.
- L2: arrives on Day 13; until then it behaves like L1.
"""

from app.engine.base import Engine
from app.engine.l0_fixed import FixedEngine
from app.engine.l1_staircase import StaircaseEngine

ENGINE_MODES = ("L0", "L1", "L2")


def get_engine(mode: str) -> Engine:
    """The engine for a patient's engine_mode; an unknown mode is L1."""
    if mode == "L0":
        return FixedEngine()
    # L2 behaves like L1 until Day 13, but keeps its own name and state.
    return StaircaseEngine(name="L2" if mode == "L2" else "L1")
