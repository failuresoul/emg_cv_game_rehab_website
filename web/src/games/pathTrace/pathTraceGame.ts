import {
  DETAIL_BEST_SPARC,
  DETAIL_MEAN_IN_CORRIDOR,
  DETAIL_TOTAL_STARS,
} from "@/features/games/results";
import { CompensationTally } from "@/games/shared/compensationTally";
import { Encourager } from "@/games/shared/encourage";
import { summariseTrials } from "@/games/shared/metrics";
import { defaultHull } from "@/games/shared/playArea";
import { TrajectoryRecorder } from "@/games/shared/trajectoryRecorder";
import type {
  GameContext,
  GameHudItem,
  GameInstance,
  GameParams,
  GameResult,
} from "@/games/shared/types";
import { closestPointOnPath, pointAtDistance } from "@/metrics/paths";
import type { TrialCreate } from "@/types/api";
import { distance, type Point } from "@/vision/geometry";

import { type PathTraceParams, readParams } from "./params";
import { type PathPlacement, placePath } from "./placement";
import {
  drawBackground,
  drawCorridor,
  drawLadybird,
  drawStars,
  drawStart,
  drawTrail,
  type TrailDot,
} from "./render";
import { START_RADIUS_SW, TraceMachine } from "./traceMachine";
import {
  buildTraceRecord,
  NO_TRACE,
  stretchIndex,
  traceMetrics,
  traceScore,
  traceStars,
} from "./trialRecord";

const TRAIL_LIFE_MS = 1200;
/** The ladybird is this wide, in SW, and looks this far ahead along the path to face its way. */
const LADYBIRD_SW = 0.13;
const HEADING_LOOKAHEAD_SW = 0.03;

interface ActiveTrace {
  no: number;
  params: GameParams;
  settings: PathTraceParams;
  placement: PathPlacement;
  machine: TraceMachine;
  recorder: TrajectoryRecorder;
  compensation: CompensationTally;
  /** Stretches of the path followed inside the corridor, from the on-screen cursor. */
  filled: Set<number>;
  /** Stars won, once the trace is over. */
  stars: number | null;
  outcomeAt: number | null;
}

export function createPathTraceGame(context: GameContext): GameInstance {
  // RAW calibration: the reach the patient actually showed.
  const calibrated = context.calibration?.hull_sw.map(([x, y]) => ({ x, y })) ?? [];
  const hull = calibrated.length >= 3 ? calibrated : defaultHull();
  const records: TrialCreate[] = [];
  const encourager = new Encourager(context.rng.next);
  let score = 0;
  let starsTotal = 0;
  let trace: ActiveTrace | null = null;
  let trail: TrailDot[] = [];
  let paused = false;
  let started = false;
  let nowMs = 0;

  function spawn(no: number, at: number): void {
    const params = context.params.next(no);
    const settings = readParams(params);
    const placement = placePath({
      shape: settings.shape,
      hull,
      pathLengthFrac: settings.pathLengthFrac,
      ringFrac: settings.ringFrac,
      outward: settings.outward,
    });
    const recorder = new TrajectoryRecorder();
    recorder.start(at);
    trace = {
      no,
      params,
      settings,
      placement,
      machine: new TraceMachine(
        {
          pathLengthSw: placement.lengthSw,
          guideSpeedSwS: settings.guideSpeedSwS,
          startHoldMs: settings.startHoldMs,
          restMs: settings.restMs,
        },
        at,
      ),
      recorder,
      compensation: new CompensationTally(),
      filled: new Set(),
      stars: null,
      outcomeAt: null,
    };
    trail = [];
    context.emit({ key: "game.path_trace.prompt.start", tone: "neutral" });
  }

  function finishTrial(current: ActiveTrace, at: number): void {
    const { machine, placement, settings } = current;
    const { moments } = machine;
    const metrics =
      machine.startTimedOut || moments.traceStart === null
        ? NO_TRACE
        : traceMetrics(current.recorder.toArray(), {
            path: placement.points,
            traceStartMs: moments.traceStart - moments.spawn,
            traceEndMs: (moments.traceEnd ?? at) - moments.spawn,
            guideSpeedSwS: settings.guideSpeedSwS,
            corridorWidthSw: settings.corridorWidthSw,
          });
    const record = buildTraceRecord({
      trialNo: current.no,
      params: current.params,
      shape: settings.shape,
      path: placement.points,
      moments,
      startTimedOut: machine.startTimedOut,
      metrics,
      compensation: current.compensation.toRecord(),
      trajectory: current.recorder.toArray(),
    });
    records.push(record);
    context.logger.log(record);
    current.outcomeAt = at;

    if (machine.startTimedOut) {
      context.emit({ key: "game.path_trace.prompt.startTimeout", tone: "gentle" });
      return;
    }
    const stars = traceStars(metrics.timeInCorridorPct);
    current.stars = stars;
    starsTotal += stars;
    score += traceScore(metrics);
    // A soft note, a little higher for more stars.
    context.audio.success(stars + 2);
    context.emit(record.outcome === "success" ? encourager.success() : encourager.miss());
  }

  return {
    start() {
      started = true;
    },

    update(_dtMs, now) {
      nowMs = now;
      if (!started || paused) return;
      if (!trace) {
        if (records.length >= context.trialsPlanned) return;
        spawn(records.length + 1, now);
      }
      const current = trace as ActiveTrace;
      const { machine, placement, settings } = current;
      const tracking = context.getTracking();

      if (machine.isLive) current.recorder.add(tracking.timestamp, tracking.rawSw);
      if (machine.phase === "TRACE") {
        const reading = context.compensation.reading;
        current.compensation.add(reading.sustained, reading.values);
      }

      // What the patient sees decides the start and the colours; saved measures use raw points.
      const cursor = tracking.smoothSw;
      const startPoint = placement.points[0];
      const events = machine.update({
        nowMs: now,
        distanceToStartSw: cursor ? distance(cursor, startPoint) : null,
      });

      if (machine.phase === "TRACE" && cursor) {
        const closest = closestPointOnPath(placement.points, cursor);
        const inside = closest.distance <= settings.corridorWidthSw / 2;
        // Only the path behind the guide fills in.
        if (inside && closest.along <= machine.guideDistance(now)) {
          current.filled.add(stretchIndex(placement.points, closest.along));
        }
        trail.push({ at: cursor, inside, ms: now });
      }
      while (trail.length > 0 && now - trail[0].ms >= TRAIL_LIFE_MS) trail.shift();

      for (const event of events) {
        if (event.type === "entered") context.audio.tick();
        if (event.type === "phase" && event.phase === "TRACE") {
          context.emit({ key: "game.path_trace.prompt.follow", tone: "neutral" });
        }
        if (event.type === "traceDone" || event.type === "startTimeout") finishTrial(current, now);
      }
      if (machine.phase === "DONE") {
        trace = null;
        trail = [];
      }
    },

    renderBackground(context2d) {
      drawBackground(context2d, context.width, context.height);
    },

    render(context2d) {
      if (!trace) return;
      const { machine, placement, settings } = trace;
      const pixels = context.pixelsPerSw;
      const screenPath = placement.points.map((point) => context.toScreen(point));
      const done = machine.phase === "OUTCOME" || machine.phase === "REST";
      if (machine.phase === "REST") return;

      drawCorridor(context2d, screenPath, settings.corridorWidthSw * pixels, trace.filled);
      if (machine.phase === "START") {
        drawStart(context2d, screenPath[0], START_RADIUS_SW * pixels, machine.holdProgress);
      }
      drawTrail(
        context2d,
        trail.map((dot) => ({ ...dot, at: context.toScreen(dot.at) })),
        nowMs,
        TRAIL_LIFE_MS,
        Math.max(4, 0.025 * pixels),
      );

      if (!done) {
        const along = machine.guideDistance(nowMs);
        const here = pointAtDistance(placement.points, along);
        const ahead = pointAtDistance(placement.points, along + HEADING_LOOKAHEAD_SW);
        const behind = pointAtDistance(placement.points, along - HEADING_LOOKAHEAD_SW);
        const from: Point = context.toScreen(behind);
        const to: Point = context.toScreen(ahead);
        drawLadybird(
          context2d,
          context.toScreen(here),
          Math.max(28, LADYBIRD_SW * pixels),
          Math.atan2(to.y - from.y, to.x - from.x),
        );
      }

      if (machine.phase === "OUTCOME" && trace.stars !== null && trace.outcomeAt !== null) {
        drawStars(
          context2d,
          { x: context.width / 2, y: 150 },
          Math.max(40, context.width * 0.04),
          trace.stars,
          (nowMs - trace.outcomeAt) / 1000,
        );
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // A trace cut short by a pause starts again, with a new start circle.
      if (trace?.machine.isLive) trace = null;
      trail = [];
    },

    isFinished: () => records.length >= context.trialsPlanned && trace === null,

    getSummary(): GameResult {
      const traced = records
        .map((record) => record.metrics.time_in_corridor_pct)
        .filter((value): value is number => typeof value === "number");
      const smoothness = records
        .map((record) => record.metrics.sparc)
        .filter((value): value is number => typeof value === "number");
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: {
          ...summariseTrials(records),
          details: {
            [DETAIL_MEAN_IN_CORRIDOR]:
              traced.length > 0
                ? Math.round(
                    (traced.reduce((total, value) => total + value, 0) / traced.length) * 10,
                  ) / 10
                : null,
            [DETAIL_TOTAL_STARS]: starsTotal,
            // SPARC is 0 or less: the best (smoothest) is the one closest to 0.
            [DETAIL_BEST_SPARC]: smoothness.length > 0 ? Math.max(...smoothness) : null,
          },
        },
      };
    },

    getHudItems(): GameHudItem[] {
      return [{ key: "game.hud.stars", params: { n: starsTotal } }];
    },

    destroy() {
      trace = null;
      trail = [];
    },
  };
}
