import { CompensationTally } from "@/games/shared/compensationTally";
import { drawActivationRing, drawHandGrab } from "@/games/shared/drawing";
import { summariseTrials } from "@/games/shared/metrics";
import type { ScreenBounds } from "@/games/shared/targetPlacement";
import { TrajectoryRecorder } from "@/games/shared/trajectoryRecorder";
import type {
  GameContext,
  GameHudItem,
  GameInstance,
  GameParams,
  GameResult,
} from "@/games/shared/types";
import type { TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";

import { BalloonMachine, POP_MS } from "./balloonMachine";
import { type BalloonPopParams, readParams } from "./params";
import { type BalloonPlacement, balloonPosition, placeBalloon } from "./placement";
import { BALLOON_COLOURS, drawBalloon, drawPop, drawSky } from "./render";
import { PeakTracker, balloonScore, buildBalloonRecord } from "./trialRecord";

/** Room kept clear around balloons, in pixels: the top bar, and the screen's edges. */
const MARGIN_TOP = 96;
const MARGIN_EDGE = 32;
/** A missed balloon floats this far up, in SW: off the top of the screen. */
const FLOAT_AWAY_SW = 4;

interface ActiveBalloon {
  no: number;
  params: GameParams;
  settings: BalloonPopParams;
  placement: BalloonPlacement;
  colour: string;
  machine: BalloonMachine;
  recorder: TrajectoryRecorder;
  compensation: CompensationTally;
  elevation: PeakTracker;
}

export function createBalloonPopGame(context: GameContext): GameInstance {
  const records: TrialCreate[] = [];
  let score = 0;
  let popped = 0;
  let balloon: ActiveBalloon | null = null;
  let paused = false;
  let started = false;
  let nowMs = 0;
  let pop: { centreSw: Point; radiusSw: number; colour: string; startMs: number } | null = null;

  const bounds = (): ScreenBounds => ({
    width: context.width,
    height: context.height,
    top: MARGIN_TOP,
    right: MARGIN_EDGE,
    bottom: MARGIN_EDGE,
    left: MARGIN_EDGE,
  });

  function spawn(no: number, at: number): void {
    const params = context.params.next();
    const settings = readParams(params);
    const recorder = new TrajectoryRecorder();
    recorder.start(at);
    balloon = {
      no,
      params,
      settings,
      placement: placeBalloon({
        directionDeg: settings.directionDeg,
        directionIndex: settings.directionIndex,
        heightFrac: settings.heightFrac,
        radiusSw: settings.balloonRadiusSw,
        reachRadiiSw: context.calibration?.reach_radii_sw ?? null,
        transform: context,
        bounds: bounds(),
      }),
      colour: BALLOON_COLOURS[(no - 1) % BALLOON_COLOURS.length],
      machine: new BalloonMachine(settings, at),
      recorder,
      compensation: new CompensationTally(),
      elevation: new PeakTracker(),
    };
  }

  /** Where the balloon is drawn now, sway and floating away included. */
  function positionOf(current: ActiveBalloon, at: number): Point {
    const { machine } = current;
    return balloonPosition(
      current.placement,
      machine.riseProgress(at),
      machine.waitedMs(at),
      machine.floatProgress(at),
      FLOAT_AWAY_SW,
    );
  }

  function finishTrial(current: ActiveBalloon, at: number): void {
    const { machine } = current;
    const outcome = machine.outcome;
    if (!outcome) return;
    const activation = machine.activation;
    const record = buildBalloonRecord({
      trialNo: current.no,
      params: current.params,
      placement: current.placement,
      outcome,
      moments: machine.moments,
      activation:
        current.settings.popMode === "touch_squeeze" && activation
          ? { latencyMs: activation.latencyMs, peakLevel: activation.peakLevel }
          : null,
      peakArmElevationDeg: current.elevation.value,
      compensation: current.compensation.toRecord(),
      trajectory: current.recorder.toArray(),
    });
    records.push(record);
    context.logger.log(record);
    score += balloonScore(outcome, machine.moments, current.settings.hoverMs);

    if (outcome === "success") {
      popped++;
      context.audio.success(popped % 8);
      pop = {
        centreSw: positionOf(current, at),
        radiusSw: current.placement.radiusSw,
        colour: current.colour,
        startMs: at,
      };
      context.emit({ key: "game.feedback.popped", tone: "positive" });
    } else {
      context.emit({ key: "game.feedback.floatedAway", tone: "gentle" });
    }
  }

  return {
    start() {
      started = true;
    },

    update(_dtMs, now) {
      nowMs = now;
      if (!started || paused) return;
      if (!balloon) {
        if (records.length >= context.trialsPlanned) return;
        spawn(records.length + 1, now);
      }
      const current = balloon as ActiveBalloon;
      const { machine } = current;
      const tracking = context.getTracking();

      if (machine.isLive) {
        current.recorder.add(tracking.timestamp, tracking.rawSw);
        current.elevation.add(tracking.armElevationDeg);
        const reading = context.compensation.reading;
        current.compensation.add(reading.sustained, reading.values);
      }

      // What the patient sees decides touching; saved measures use raw positions.
      const centre = positionOf(current, now);
      const cursor = tracking.smoothSw;
      const distanceRatio = cursor
        ? Math.hypot(cursor.x - centre.x, cursor.y - centre.y) / current.placement.radiusSw
        : null;
      const events = machine.update({
        nowMs: now,
        distanceRatio,
        level: context.activation.getLevel(),
      });

      for (const event of events) {
        if (event.type === "phase" && event.phase === "SQUEEZE") {
          context.audio.tick();
          context.emit({ key: "game.feedback.squeeze", tone: "neutral" });
        }
        if (event.type === "outcome") finishTrial(current, now);
      }
      if (machine.phase === "DONE") balloon = null;
    },

    renderBackground(context2d) {
      drawSky(context2d, context.width, context.height, nowMs);
    },

    render(context2d) {
      const radiusPx = (sw: number) => sw * context.pixelsPerSw;
      if (balloon && balloon.machine.phase !== "POPPED" && balloon.machine.phase !== "REST") {
        const { machine, placement, settings } = balloon;
        const centre = context.toScreen(positionOf(balloon, nowMs));
        const radius = radiusPx(placement.radiusSw);
        drawBalloon(context2d, { centre, radius, colour: balloon.colour });
        if (machine.phase === "SQUEEZE") {
          const ringWidth = Math.max(8, radius * 0.12);
          drawHandGrab(context2d, centre, radius * 0.9);
          drawActivationRing(
            context2d,
            centre,
            radius * 1.15 + ringWidth,
            ringWidth,
            context.activation.getLevel(),
            settings.activationDemand,
          );
        }
      }
      if (pop) {
        const alive = drawPop(
          context2d,
          context.toScreen(pop.centreSw),
          radiusPx(pop.radiusSw),
          pop.colour,
          nowMs - pop.startMs,
          POP_MS,
        );
        if (!alive) pop = null;
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // A balloon cut short by a pause comes again from the start, with the same settings.
      if (balloon?.machine.isLive) balloon = null;
    },

    isFinished: () => records.length >= context.trialsPlanned && balloon === null,

    getSummary(): GameResult {
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: summariseTrials(records),
      };
    },

    getHudItems(): GameHudItem[] {
      return [{ key: "game.hud.popped", params: { n: popped } }];
    },

    destroy() {
      balloon = null;
      pop = null;
    },
  };
}
