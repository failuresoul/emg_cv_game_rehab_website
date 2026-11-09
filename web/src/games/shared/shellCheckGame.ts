import { ActivationDetector } from "@/input/activationDetector";
import type { TrialCompensation, TrialCreate, TrialOutcome } from "@/types/api";
import type { Point } from "@/vision/geometry";

import { DEFAULT_REACH_SW } from "./playArea";
import { pathMetrics, summariseTrials } from "./metrics";
import { TrajectoryRecorder } from "./trajectoryRecorder";
import type { GameContext, GameInstance, GameParams, GameResult } from "./types";

/**
 * TEMPORARY: a minimal reach-and-squeeze game that exercises the shell, logger and provider end to
 * end. The full reach_activate game replaces it in the registry.
 */

const GAP_MS = 1000;
const POINTS_PER_SUCCESS = 100;
const TARGET_FILL = "rgba(15, 92, 92, 0.55)";
const TARGET_RING = "#E8F2F1";
const TARGET_ACTIVE_RING = "#D9682B";
const PROGRESS_COLOR = "#F2C94C";

type Phase = "reach" | "activate" | "gap" | "done";

interface Trial {
  no: number;
  params: GameParams;
  centre: Point;
  radiusSw: number;
  directionDeg: number;
  distanceFrac: number;
  spawnMs: number;
  enterMs: number | null;
  insideSinceMs: number | null;
  dwellDoneMs: number | null;
  compensation: TrialCompensation;
}

export function createShellCheckGame(context: GameContext): GameInstance {
  const recorder = new TrajectoryRecorder();
  const trials: TrialCreate[] = [];
  let phase: Phase = "gap";
  let phaseEndsMs = 0;
  let trial: Trial | null = null;
  let detector: ActivationDetector | null = null;
  let progress = 0;
  let paused = false;
  let lastNow = 0;

  function spawn(no: number, now: number): void {
    const params = context.params.next();
    const directionIndex = params.direction_index ?? 0;
    const directionDeg = params.direction_deg ?? 0;
    const distanceFrac = params.distance_frac ?? 0.7;
    const reach = context.calibration?.reach_radii_sw[directionIndex] ?? DEFAULT_REACH_SW;
    const radians = (directionDeg * Math.PI) / 180;
    const distance = distanceFrac * reach;
    trial = {
      no,
      params,
      centre: { x: distance * Math.cos(radians), y: distance * Math.sin(radians) },
      radiusSw: params.target_radius_sw ?? 0.25,
      directionDeg,
      distanceFrac,
      spawnMs: now,
      enterMs: null,
      insideSinceMs: null,
      dwellDoneMs: null,
      compensation: { flagged: false, type: null, max_values: {} },
    };
    detector = null;
    progress = 0;
    recorder.start(now);
    phase = "reach";
  }

  function finish(outcome: TrialOutcome, now: number): void {
    if (!trial) return;
    const current = trial;
    const trajectory = recorder.toArray();
    const state = detector?.current;
    const rel = (ms: number | null) => (ms === null ? null : Math.round(ms - current.spawnMs));
    const enter = rel(current.enterMs);
    const path = pathMetrics(trajectory, enter ?? Infinity);
    const activationStart =
      state?.onsetMs != null && current.dwellDoneMs !== null
        ? rel(current.dwellDoneMs + state.onsetMs)
        : null;
    const activationDone =
      state?.doneMs != null && current.dwellDoneMs !== null
        ? rel(current.dwellDoneMs + state.doneMs)
        : null;
    const record: TrialCreate = {
      trial_no: current.no,
      params: current.params,
      target: {
        x_sw: current.centre.x,
        y_sw: current.centre.y,
        radius_sw: current.radiusSw,
        direction_deg: current.directionDeg,
        distance_frac: current.distanceFrac,
        sector: `D${(current.params.direction_index ?? 0) + 1}R1`,
      },
      outcome,
      timings: {
        spawn: 0,
        move_onset: path.moveOnsetMs,
        enter,
        dwell_done: rel(current.dwellDoneMs),
        activation_start: activationStart,
        activation_done: activationDone,
        end: rel(now),
      },
      metrics: {
        reaction_ms: path.moveOnsetMs,
        movement_ms: enter !== null && path.moveOnsetMs !== null ? enter - path.moveOnsetMs : enter,
        path_length_sw: path.pathLengthSw,
        straight_dist_sw: path.straightDistSw,
        path_efficiency: path.pathEfficiency,
        peak_speed_sw_s: path.peakSpeedSwS,
        activation_latency_ms: state?.latencyMs ?? null,
        activation_peak: state ? state.peakLevel : null,
      },
      compensation: current.compensation,
      trajectory,
    };
    trials.push(record);
    context.logger.log(record);

    if (outcome === "success") {
      context.audio.success(trials.filter((item) => item.outcome === "success").length % 8);
      context.emit({ key: "game.feedback.wellDone", tone: "positive" });
    } else {
      context.emit({ key: "game.feedback.nextOne", tone: "gentle" });
    }
    trial = null;
    phase = trials.length >= context.trialsPlanned ? "done" : "gap";
    phaseEndsMs = now + GAP_MS;
  }

  function watchCompensation(): void {
    if (!trial) return;
    const reading = context.compensation.reading;
    if (reading.sustained.length > 0) {
      trial.compensation.flagged = true;
      trial.compensation.type = reading.sustained.join("+");
    }
    if (reading.values) {
      const max = trial.compensation.max_values;
      for (const [key, value] of Object.entries(reading.values)) {
        max[key] = Math.max(max[key] ?? -Infinity, value);
      }
    }
  }

  return {
    start() {
      phase = "gap";
      phaseEndsMs = 0;
    },

    update(_dtMs, nowMs) {
      lastNow = nowMs;
      if (paused || phase === "done") return;
      if (phase === "gap") {
        if (nowMs >= phaseEndsMs) spawn(trials.length + 1, nowMs);
        return;
      }
      if (!trial) return;
      const tracking = context.getTracking();
      recorder.add(tracking.timestamp, tracking.rawSw);
      watchCompensation();

      if (phase === "reach") {
        const cursor = tracking.smoothSw;
        const inside =
          cursor !== null &&
          Math.hypot(cursor.x - trial.centre.x, cursor.y - trial.centre.y) <= trial.radiusSw;
        if (inside) {
          trial.insideSinceMs ??= nowMs;
          trial.enterMs ??= nowMs;
          const dwell = trial.params.dwell_ms ?? 500;
          progress = Math.min(1, (nowMs - trial.insideSinceMs) / dwell);
          if (nowMs - trial.insideSinceMs >= dwell) {
            trial.dwellDoneMs = nowMs;
            detector = new ActivationDetector({
              demand: trial.params.demand ?? 0.5,
              holdMs: trial.params.hold_ms ?? 400,
              windowMs: trial.params.activation_window_ms ?? 4000,
            });
            detector.start(nowMs);
            progress = 0;
            phase = "activate";
            context.audio.tick();
            context.emit({ key: "game.feedback.squeeze", tone: "neutral" });
          }
        } else {
          trial.insideSinceMs = null;
          progress = 0;
        }
        if (phase === "reach" && nowMs - trial.spawnMs >= (trial.params.reach_timeout_ms ?? 8000)) {
          finish("reach_fail", nowMs);
        }
        return;
      }

      if (phase === "activate" && detector) {
        const state = detector.update(context.activation.getLevel(), nowMs);
        progress = state.holdProgress;
        if (state.status === "activated") finish("success", nowMs);
        else if (state.status === "failed") finish("activation_fail", nowMs);
      }
    },

    render(context2d) {
      if (!trial) return;
      const centre = context.toScreen(trial.centre);
      const radius = trial.radiusSw * context.pixelsPerSw;
      context2d.fillStyle = TARGET_FILL;
      context2d.strokeStyle = phase === "activate" ? TARGET_ACTIVE_RING : TARGET_RING;
      context2d.lineWidth = 6;
      context2d.beginPath();
      context2d.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      context2d.fill();
      context2d.stroke();
      if (progress > 0) {
        context2d.strokeStyle = PROGRESS_COLOR;
        context2d.lineWidth = 10;
        context2d.beginPath();
        context2d.arc(
          centre.x,
          centre.y,
          radius + 12,
          -Math.PI / 2,
          -Math.PI / 2 + progress * 2 * Math.PI,
        );
        context2d.stroke();
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // The interrupted trial starts again with the same number, after a short gap.
      if (trial) {
        trial = null;
        phase = "gap";
        phaseEndsMs = lastNow + GAP_MS;
      }
    },

    isFinished: () => phase === "done",

    getSummary(): GameResult {
      const summary = summariseTrials(trials);
      return {
        score: summary.successes * POINTS_PER_SUCCESS,
        trialsDone: trials.length,
        trialsPlanned: context.trialsPlanned,
        summary,
      };
    },

    destroy() {
      trial = null;
      detector = null;
    },
  };
}
