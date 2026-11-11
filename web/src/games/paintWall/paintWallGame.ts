import { DETAIL_BEST_RANGE_DEG, DETAIL_MEAN_RANGE_DEG } from "@/features/games/results";
import { CompensationTally } from "@/games/shared/compensationTally";
import { Encourager } from "@/games/shared/encourage";
import { summariseTrials } from "@/games/shared/metrics";
import { TrajectoryRecorder } from "@/games/shared/trajectoryRecorder";
import type {
  GameContext,
  GameHudItem,
  GameInstance,
  GameParams,
  GameResult,
} from "@/games/shared/types";
import { t } from "@/i18n";
import type { TrialCreate } from "@/types/api";

import { brushHeight } from "./elbowRange";
import { type PaintWallParams, readParams } from "./params";
import {
  drawBrush,
  drawCoats,
  drawCounter,
  drawRoomAndWall,
  drawTarget,
  heightY,
  STRIPE_COLOURS,
  stripeRect,
  wallRect,
} from "./render";
import { type Coat, StripeMachine } from "./stripeMachine";
import {
  AngleRecorder,
  buildStripeRecord,
  stripeMetrics,
  stripeScore,
  withUpperArm,
} from "./trialRecord";

/** The brush on screen follows the elbow with light smoothing; saved angles stay raw. */
const BRUSH_SMOOTHING = 0.35;
/** The upper-arm reminder shows at most this often. */
const UPPER_ARM_REMINDER_MS = 6000;

interface ActiveStripe {
  no: number;
  /** Its place on the wall, from 0 at the left. */
  index: number;
  params: GameParams;
  settings: PaintWallParams;
  machine: StripeMachine;
  recorder: TrajectoryRecorder;
  angles: AngleRecorder;
  compensation: CompensationTally;
}

export function createPaintWallGame(context: GameContext): GameInstance {
  const records: TrialCreate[] = [];
  const encourager = new Encourager(context.rng.next);
  /** Every finished stripe's paint, by its place on the wall: the mural so far. */
  const painted = new Map<number, Coat[]>();
  let score = 0;
  let stripe: ActiveStripe | null = null;
  let brush: number | null = null;
  let lastReminderAt = -Infinity;
  let paused = false;
  let started = false;
  let nowMs = 0;

  const colourOf = (index: number) => STRIPE_COLOURS[index % STRIPE_COLOURS.length];

  function spawn(no: number, at: number): void {
    const params = context.params.next(no);
    const settings = readParams(params);
    const recorder = new TrajectoryRecorder();
    recorder.start(at);
    stripe = {
      no,
      index: no - 1,
      params,
      settings,
      machine: new StripeMachine(
        {
          targetHeight: settings.requiredRangeFrac,
          sweepsNeeded: settings.sweepsNeeded,
          timeLimitMs: settings.timeLimitMs,
          restMs: settings.restMs,
        },
        at,
      ),
      recorder,
      angles: new AngleRecorder(),
      compensation: new CompensationTally(),
    };
    context.emit({ key: "game.paint_wall.prompt.paint", tone: "neutral" });
  }

  function finishTrial(current: ActiveStripe): void {
    const { machine } = current;
    const outcome = machine.outcome;
    if (!outcome) return;
    const metrics = stripeMetrics(
      current.angles.toArray(),
      machine.sweeps,
      machine.upperArmMotionDeg,
    );
    const record = buildStripeRecord({
      trialNo: current.no,
      params: current.params,
      stripeIndex: current.index,
      targetFrac: machine.targetHeight,
      outcome,
      spawnMs: machine.spawnMs,
      endMs: machine.endMs ?? nowMs,
      metrics,
      compensation: withUpperArm(
        current.compensation.toRecord(),
        machine.upperArmFlagged,
        machine.upperArmMotionDeg,
      ),
      trajectory: current.recorder.toArray(),
    });
    records.push(record);
    context.logger.log(record);
    // The paint stays, finished or not.
    painted.set(current.index, [...machine.coats]);
    score += stripeScore(metrics, outcome);
    if (outcome === "success") {
      context.audio.success(records.filter((item) => item.outcome === "success").length % 8);
      context.emit(encourager.success());
    } else {
      context.emit(encourager.miss());
    }
  }

  return {
    start() {
      started = true;
    },

    update(_dtMs, now) {
      nowMs = now;
      if (!started || paused) return;
      if (!stripe) {
        if (records.length >= context.trialsPlanned) return;
        spawn(records.length + 1, now);
      }
      const current = stripe as ActiveStripe;
      const { machine, settings } = current;
      const tracking = context.getTracking();
      const elbow = tracking.elbowFlexionDeg;
      const height = elbow === null ? null : brushHeight(elbow, settings.range);

      if (machine.isLive) {
        current.recorder.add(tracking.timestamp, tracking.rawSw);
        current.angles.add(tracking.timestamp, elbow);
        const reading = context.compensation.reading;
        current.compensation.add(reading.sustained, reading.values);
      }
      if (height !== null) {
        brush = brush === null ? height : BRUSH_SMOOTHING * height + (1 - BRUSH_SMOOTHING) * brush;
      }

      const events = machine.update({
        nowMs: now,
        height,
        armElevationDeg: tracking.armElevationDeg,
      });
      for (const event of events) {
        if (event.type === "sweep") {
          if (event.sweep.kind === "full") context.audio.success(machine.fullSweeps);
          else context.audio.tick();
        }
        if (event.type === "upperArmMoved" && now - lastReminderAt >= UPPER_ARM_REMINDER_MS) {
          lastReminderAt = now;
          context.emit({ key: "game.paint_wall.keepArmStill", tone: "gentle" });
        }
        if (event.type === "outcome") finishTrial(current);
      }
      if (machine.phase === "DONE") stripe = null;
    },

    renderBackground(context2d) {
      drawRoomAndWall(context2d, context.width, context.height);
    },

    render(context2d) {
      const wall = wallRect(context.width, context.height);
      const count = context.trialsPlanned;
      for (const [index, coats] of painted) {
        if (index !== stripe?.index)
          drawCoats(context2d, stripeRect(wall, index, count), coats, colourOf(index));
      }
      if (!stripe) return;
      const { machine, settings, index } = stripe;
      const rect = stripeRect(wall, index, count);
      drawCoats(context2d, rect, machine.coats, colourOf(index));
      if (machine.phase === "REST") return;
      if (machine.isLive) drawTarget(context2d, rect, machine.targetHeight);
      drawCounter(
        context2d,
        rect,
        t("game.paint_wall.counter", { done: machine.fullSweeps, needed: settings.sweepsNeeded }),
      );
      if (machine.isLive && brush !== null) {
        drawBrush(
          context2d,
          rect.x + rect.width / 2,
          heightY(rect, brush),
          Math.max(48, rect.width * 0.9),
          colourOf(index),
        );
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // A stripe cut short by a pause starts again, with fresh paint.
      if (stripe?.machine.isLive) stripe = null;
      brush = null;
    },

    isFinished: () => records.length >= context.trialsPlanned && stripe === null,

    getSummary(): GameResult {
      const ranges = records
        .map((record) => record.metrics.achieved_range_deg)
        .filter((value): value is number => typeof value === "number");
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: {
          ...summariseTrials(records),
          details: {
            [DETAIL_MEAN_RANGE_DEG]:
              ranges.length > 0
                ? Math.round(
                    (ranges.reduce((total, value) => total + value, 0) / ranges.length) * 10,
                  ) / 10
                : null,
            [DETAIL_BEST_RANGE_DEG]: ranges.length > 0 ? Math.max(...ranges) : null,
          },
        },
      };
    },

    getHudItems(): GameHudItem[] {
      return [
        {
          key: "game.hud.stripes",
          params: { n: records.filter((record) => record.outcome === "success").length },
        },
      ];
    },

    destroy() {
      stripe = null;
      painted.clear();
    },
  };
}
