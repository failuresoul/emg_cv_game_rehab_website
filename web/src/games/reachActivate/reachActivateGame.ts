import { Encourager } from "@/games/shared/encourage";
import { summariseTrials } from "@/games/shared/metrics";
import { TrajectoryRecorder } from "@/games/shared/trajectoryRecorder";
import type { GameContext, GameInstance, GameParams, GameResult } from "@/games/shared/types";
import type { TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";

import { readParams } from "./params";
import { placeTarget, type ScreenBounds, type TargetPlacement } from "./placement";
import { drawBurst, drawTarget, drawTrail, type TrailPoint } from "./render";
import { CompensationTally, buildTrialRecord, trialScore } from "./trialRecord";
import { ReachTrialMachine } from "./trialMachine";

/** Room kept clear around targets, in pixels: the top bar, and the screen's edges. */
const MARGIN_TOP = 96;
const MARGIN_EDGE = 32;
const TRAIL_LIFE_MS = 900;

interface ActiveTrial {
  no: number;
  params: GameParams;
  target: TargetPlacement;
  machine: ReachTrialMachine;
  recorder: TrajectoryRecorder;
  compensation: CompensationTally;
}

export function createReachActivateGame(context: GameContext): GameInstance {
  const records: TrialCreate[] = [];
  const encourager = new Encourager(context.rng.next);
  let score = 0;
  let trial: ActiveTrial | null = null;
  let paused = false;
  let started = false;
  let nowMs = 0;
  let trail: TrailPoint[] = [];
  let burst: { centreSw: Point; radiusSw: number; startMs: number } | null = null;

  const bounds = (): ScreenBounds => ({
    width: context.width,
    height: context.height,
    top: MARGIN_TOP,
    right: MARGIN_EDGE,
    bottom: MARGIN_EDGE,
    left: MARGIN_EDGE,
  });

  function spawn(no: number, at: number): void {
    const params = context.params.next(no);
    const settings = readParams(params);
    const target = placeTarget({
      directionDeg: settings.directionDeg,
      directionIndex: settings.directionIndex,
      distanceFrac: settings.distanceFrac,
      radiusSw: settings.targetRadiusSw,
      reachRadiiSw: context.calibration?.reach_radii_sw ?? null,
      transform: context,
      bounds: bounds(),
    });
    const recorder = new TrajectoryRecorder();
    recorder.start(at);
    trial = {
      no,
      params,
      target,
      machine: new ReachTrialMachine(settings, at),
      recorder,
      compensation: new CompensationTally(),
    };
    trail = [];
  }

  function finishTrial(current: ActiveTrial): void {
    const { machine } = current;
    const outcome = machine.outcome;
    if (!outcome) return;
    const activation = machine.activation;
    const record = buildTrialRecord({
      trialNo: current.no,
      params: current.params,
      target: current.target,
      outcome,
      moments: machine.moments,
      activation:
        activation && machine.moments.dwellDone !== null
          ? { latencyMs: activation.latencyMs, peakLevel: activation.peakLevel }
          : null,
      compensation: current.compensation.toRecord(),
      trajectory: current.recorder.toArray(),
    });
    records.push(record);
    context.logger.log(record);

    const settings = readParams(current.params);
    score += trialScore(outcome, machine.moments, settings.reachTimeLimitMs);
    if (outcome === "success") {
      const successes = records.filter((item) => item.outcome === "success").length;
      context.audio.success(successes % 8);
      burst = {
        centreSw: current.target.centreSw,
        radiusSw: current.target.radiusSw,
        startMs: nowMs,
      };
      context.emit(encourager.success());
    } else {
      context.emit(encourager.miss());
    }
    trail = [];
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
      const current = trial as ActiveTrial;
      const { machine, target } = current;
      const tracking = context.getTracking();

      if (machine.isLive) current.recorder.add(tracking.timestamp, tracking.rawSw);

      // What the patient sees decides entering and leaving; saved measures use raw positions.
      const cursor = tracking.smoothSw;
      const distanceRatio = cursor
        ? Math.hypot(cursor.x - target.centreSw.x, cursor.y - target.centreSw.y) / target.radiusSw
        : null;
      const events = machine.update({
        nowMs: now,
        distanceRatio,
        level: context.activation.getLevel(),
      });

      if (machine.phase === "REACH" || machine.phase === "DWELL") {
        const reading = context.compensation.reading;
        current.compensation.add(reading.sustained, reading.values);
        if (cursor) trail.push({ at: cursor, ms: now });
      }
      // Oldest first, so expired points are all at the front.
      while (trail.length > 0 && now - trail[0].ms >= TRAIL_LIFE_MS) trail.shift();

      for (const event of events) {
        if (event.type === "entered") context.audio.tick();
        if (event.type === "phase" && event.phase === "ACTIVATE") {
          context.emit({ key: "game.feedback.squeeze", tone: "neutral" });
        }
        if (event.type === "outcome") finishTrial(current);
      }
      if (machine.phase === "DONE") trial = null;
    },

    render(context2d) {
      const radiusPx = (sw: number) => sw * context.pixelsPerSw;
      if (trail.length > 1) {
        drawTrail(
          context2d,
          trail,
          nowMs,
          TRAIL_LIFE_MS,
          Math.max(4, radiusPx(0.05)),
          context.toScreen,
        );
      }
      if (trial?.machine.isLive) {
        const { machine, target } = trial;
        const activation = machine.phase === "ACTIVATE" ? machine.activation : null;
        drawTarget(context2d, {
          centre: context.toScreen(target.centreSw),
          radius: radiusPx(target.radiusSw),
          dwell: machine.phase === "DWELL" ? machine.dwellProgress : 0,
          activation: activation
            ? {
                level: context.activation.getLevel(),
                demand: readParams(trial.params).activationDemand,
                holdProgress: activation.holdProgress,
              }
            : null,
        });
      }
      if (burst) {
        const alive = drawBurst(
          context2d,
          context.toScreen(burst.centreSw),
          radiusPx(burst.radiusSw),
          nowMs - burst.startMs,
        );
        if (!alive) burst = null;
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // A trial cut short by a pause is played again from the start, with the same settings.
      if (trial?.machine.isLive) trial = null;
      trail = [];
    },

    isFinished: () => records.length >= context.trialsPlanned && trial === null,

    getSummary(): GameResult {
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: summariseTrials(records),
      };
    },

    destroy() {
      trial = null;
      trail = [];
      burst = null;
    },
  };
}
