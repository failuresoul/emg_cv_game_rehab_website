import { DETAIL_BEST_HOLD_MS, DETAIL_MEAN_IN_BAND_PCT } from "@/features/games/results";
import { CompensationTally } from "@/games/shared/compensationTally";
import { Encourager } from "@/games/shared/encourage";
import { summariseTrials } from "@/games/shared/metrics";
import type {
  GameContext,
  GameHudItem,
  GameInstance,
  GameParams,
  GameResult,
} from "@/games/shared/types";
import type { TrialCreate } from "@/types/api";

import { HoldMachine } from "./holdMachine";
import { type GripHoldParams, readParams } from "./params";
import {
  drawBand,
  drawHoldRing,
  drawKite,
  drawRelaxLine,
  drawSky,
  levelToY,
  MEADOW_TOP_SHARE,
} from "./render";
import { buildHoldRecord, holdMetrics, holdScore } from "./trialRecord";

interface ActiveHold {
  no: number;
  params: GameParams;
  settings: GripHoldParams;
  machine: HoldMachine;
  compensation: CompensationTally;
}

export function createGripHoldGame(context: GameContext): GameInstance {
  const records: TrialCreate[] = [];
  const encourager = new Encourager(context.rng.next);
  let score = 0;
  let holds = 0;
  let trial: ActiveHold | null = null;
  let paused = false;
  let started = false;
  let nowMs = 0;

  function spawn(no: number, at: number): void {
    const params = context.params.next(no);
    const settings = readParams(params);
    trial = {
      no,
      params,
      settings,
      machine: new HoldMachine(settings, at),
      compensation: new CompensationTally(),
    };
    context.emit({ key: "game.grip_hold.prompt.hold", tone: "neutral" });
  }

  function finishTrial(current: ActiveHold): void {
    const { machine, settings } = current;
    const outcome = machine.outcome;
    if (!outcome) return;
    const metrics = holdMetrics(machine.moments, machine.tally);
    const record = buildHoldRecord({
      trialNo: current.no,
      params: current.params,
      bandCenter: settings.bandCenter,
      bandWidth: settings.bandWidth,
      outcome,
      failedPhase: machine.failedPhase,
      moments: machine.moments,
      metrics,
      // The same game reads a muscle sensor from Day 15; each trial says which one it used.
      inputSource: context.activation.sourceId,
      compensation: current.compensation.toRecord(),
    });
    records.push(record);
    context.logger.log(record);
    score += holdScore(outcome, metrics);
    if (outcome === "success") {
      holds++;
      context.audio.success(holds % 8);
      context.emit(encourager.success());
    } else if (machine.failedPhase === "relax") {
      context.emit({ key: "game.grip_hold.prompt.relaxMissed", tone: "gentle" });
    } else {
      context.emit({ key: "game.grip_hold.prompt.holdMissed", tone: "gentle" });
    }
  }

  return {
    start() {
      started = true;
    },

    update(_dtMs, now) {
      nowMs = now;
      if (!started || paused) return;
      if (!trial) {
        if (records.length >= context.trialsPlanned) return;
        spawn(records.length + 1, now);
      }
      const current = trial as ActiveHold;
      const { machine } = current;

      // Posture counts while the hold is being played, the frame that ends it included.
      if (machine.isLive) {
        const reading = context.compensation.reading;
        current.compensation.add(reading.sustained, reading.values);
      }
      const events = machine.update(now, context.activation.getLevel());
      for (const event of events) {
        if (event.type === "enteredBand") context.audio.tick();
        if (event.type === "holdDone") {
          context.audio.tick();
          context.emit({ key: "game.grip_hold.prompt.relax", tone: "neutral" });
        }
        if (event.type === "outcome") finishTrial(current);
      }
      if (machine.phase === "DONE") trial = null;
    },

    renderBackground(context2d) {
      drawSky(context2d, context.width, context.height);
    },

    render(context2d) {
      const { width, height } = context;
      if (!trial || trial.machine.phase === "REST" || trial.machine.phase === "DONE") return;
      const { machine, settings } = trial;
      const phase = machine.phase;
      const { low, high } = machine.band;
      const level = context.activation.getLevel();

      drawBand(context2d, width, height, low, high, phase === "HOLD" && machine.inBand);
      if (phase === "RELAX") drawRelaxLine(context2d, width, height, settings.relaxBelow);

      const size = Math.max(70, Math.min(width, height) * 0.13);
      const centre = { x: width * 0.45, y: levelToY(level, height) };
      const outcome = machine.outcomeProgress(nowMs);
      drawKite(context2d, {
        centre,
        size,
        anchor: { x: width * 0.3, y: height * MEADOW_TOP_SHARE + 10 },
        glow: phase === "SUCCESS" ? 1 - outcome : 0,
        alpha: phase === "MISSED" ? 1 - 0.5 * outcome : 1,
      });
      if (phase === "HOLD" || phase === "RELAX") {
        drawHoldRing(
          context2d,
          { x: centre.x + size * 1.3, y: centre.y },
          size * 0.38,
          machine.holdProgress,
        );
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // A hold cut short by a pause starts again, with the same settings.
      if (trial?.machine.isLive) trial = null;
    },

    isFinished: () => records.length >= context.trialsPlanned && trial === null,

    getSummary(): GameResult {
      const inBand = records
        .map((record) => record.metrics.time_in_band_pct)
        .filter((value): value is number => typeof value === "number");
      const runs = records
        .map((record) => record.metrics.longest_continuous_hold_ms)
        .filter((value): value is number => typeof value === "number");
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: {
          ...summariseTrials(records),
          details: {
            [DETAIL_MEAN_IN_BAND_PCT]:
              inBand.length > 0
                ? Math.round(
                    (inBand.reduce((total, value) => total + value, 0) / inBand.length) * 10,
                  ) / 10
                : null,
            [DETAIL_BEST_HOLD_MS]: runs.length > 0 ? Math.max(...runs) : null,
          },
        },
      };
    },

    getHudItems(): GameHudItem[] {
      const items: GameHudItem[] = [{ key: "game.hud.holds", params: { n: holds } }];
      // The camera only sees the hand closing; a muscle sensor measures the effort itself.
      if (context.activation.sourceId === "cv_grip") {
        items.push({ key: "game.grip_hold.webcamNote" });
      }
      return items;
    },

    destroy() {
      trial = null;
    },
  };
}
