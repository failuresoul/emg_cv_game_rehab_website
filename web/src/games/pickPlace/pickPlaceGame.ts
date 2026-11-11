import { DETAIL_MEAN_TRANSPORT_MS, DETAIL_TOTAL_DROPS } from "@/features/games/results";
import { FRUIT_KINDS, type FruitKind } from "@/games/fruitCatch/render";
import { CompensationTally } from "@/games/shared/compensationTally";
import { Encourager } from "@/games/shared/encourage";
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

import { CarryMachine } from "./carryMachine";
import { type PickPlaceParams, readParams } from "./params";
import { insideBox, type PickPlacePlacement, placePickPlace } from "./placement";
import {
  drawBackground,
  drawBox,
  drawHandCursor,
  drawObject,
  drawShelf,
  drawStartSpot,
  SHELF_GAP_PX,
} from "./render";
import { buildCarryRecord, carryScore } from "./trialRecord";

/** Room kept clear around the object and the box, in pixels: the top bar, the shelf, the edges. */
const MARGIN_TOP = 96;
const MARGIN_EDGE = 32;
const MARGIN_BOTTOM = SHELF_GAP_PX + 56;
/** The hand cursor's size, in SW, and never smaller than this many pixels. */
const CURSOR_SW = 0.22;
const CURSOR_MIN_PX = 40;

/** The screen space the object and the box must stay inside, in pixels. */
export function screenBounds(width: number, height: number): ScreenBounds {
  return {
    width,
    height,
    top: MARGIN_TOP,
    right: MARGIN_EDGE,
    bottom: MARGIN_BOTTOM,
    left: MARGIN_EDGE,
  };
}

interface ActiveTrial {
  no: number;
  params: GameParams;
  settings: PickPlaceParams;
  placement: PickPlacePlacement;
  machine: CarryMachine;
  recorder: TrajectoryRecorder;
  compensation: CompensationTally;
  kind: FruitKind;
}

export function createPickPlaceGame(context: GameContext): GameInstance {
  const records: TrialCreate[] = [];
  const encourager = new Encourager(context.rng.next);
  const collected: FruitKind[] = [];
  let score = 0;
  let trial: ActiveTrial | null = null;
  let paused = false;
  let started = false;
  let nowMs = 0;

  const bounds = () => screenBounds(context.width, context.height);

  function spawn(no: number, at: number): void {
    const params = context.params.next(no);
    const settings = readParams(params);
    const placement = placePickPlace({
      ...settings,
      reachRadiiSw: context.calibration?.reach_radii_sw ?? null,
      transform: context,
      bounds: bounds(),
    });
    const recorder = new TrajectoryRecorder();
    recorder.start(at);
    trial = {
      no,
      params,
      settings,
      placement,
      machine: new CarryMachine(
        {
          pick: placement.pick,
          place: placement.place,
          objectRadiusSw: settings.objectRadiusSw,
          boxSizeSw: settings.boxSizeSw,
          timeLimitMs: settings.timeLimitMs,
          restMs: settings.restMs,
        },
        at,
      ),
      recorder,
      compensation: new CompensationTally(),
      kind: FRUIT_KINDS[(no - 1) % FRUIT_KINDS.length],
    };
    context.emit({ key: "game.pick_place.prompt.reach", tone: "neutral" });
  }

  function finishTrial(current: ActiveTrial): void {
    const { machine, placement, settings } = current;
    const outcome = machine.outcome;
    if (!outcome) return;
    const record = buildCarryRecord({
      trialNo: current.no,
      params: current.params,
      pick: placement.pick,
      place: placement.place,
      objectRadiusSw: settings.objectRadiusSw,
      boxSizeSw: settings.boxSizeSw,
      outcome,
      moments: machine.moments,
      drops: machine.drops,
      // Saved data uses the RAW pinch point.
      releaseRawSw: outcome === "success" ? context.hand.getPinch().pointRawSw : null,
      compensation: current.compensation.toRecord(),
      trajectory: current.recorder.toArray(),
    });
    records.push(record);
    context.logger.log(record);
    score += carryScore(outcome, machine.moments, machine.drops, settings.timeLimitMs);

    if (outcome === "success") {
      collected.push(current.kind);
      context.audio.success(collected.length % 8);
      context.emit(encourager.success());
    } else {
      context.emit({ key: "game.pick_place.prompt.timeout", tone: "gentle" });
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
      const current = trial as ActiveTrial;
      const { machine } = current;
      const pinch = context.hand.getPinch();

      if (machine.isLive) {
        current.recorder.add(pinch.t, pinch.pointRawSw);
        const reading = context.compensation.reading;
        current.compensation.add(reading.sustained, reading.values);
      }

      // What the patient sees decides grasping and placing; saved measures use raw points.
      const events = machine.update({
        nowMs: now,
        point: pinch.ready ? pinch.pointSmoothSw : null,
        pinching: pinch.ready ? pinch.pinching : null,
      });
      for (const event of events) {
        if (event.type === "reached") context.audio.tick();
        if (event.type === "grasped") {
          context.audio.tick();
          context.emit({ key: "game.pick_place.prompt.carry", tone: "neutral" });
        }
        if (event.type === "openFirst") {
          context.emit({ key: "game.pick_place.prompt.openFirst", tone: "neutral" });
        }
        if (event.type === "dropped") {
          context.audio.plop();
          context.emit({ key: "game.pick_place.prompt.dropped", tone: "gentle" });
        }
        if (event.type === "placed" || event.type === "timeout") finishTrial(current);
      }
      if (machine.phase === "DONE") trial = null;
    },

    renderBackground(context2d) {
      drawBackground(context2d, context.width, context.height);
      drawShelf(context2d, context.width, context.height, collected);
    },

    render(context2d) {
      const pinch = context.hand.getPinch();
      const pixels = context.pixelsPerSw;
      if (trial && trial.machine.phase !== "REST") {
        const { machine, placement, settings } = trial;
        const objectRadiusPx = settings.objectRadiusSw * pixels;
        const success = machine.outcome === "success";
        const over =
          machine.holding && insideBox(machine.objectPosition, placement.place, settings.boxSizeSw);
        drawBox(context2d, {
          centre: context.toScreen(placement.place),
          size: settings.boxSizeSw * pixels,
          closed: success ? machine.outcomeProgress(nowMs) : 0,
          ready: over,
        });
        if (machine.isLive) {
          if (machine.holding)
            drawStartSpot(context2d, context.toScreen(placement.pick), objectRadiusPx);
          drawObject(
            context2d,
            trial.kind,
            context.toScreen(machine.objectPosition),
            objectRadiusPx,
            machine.holding,
          );
        } else if (success && machine.outcomeProgress(nowMs) < 0.6) {
          // The fruit sinks into the box as the lid swings shut.
          const sink = machine.outcomeProgress(nowMs) / 0.6;
          const at = context.toScreen(machine.placedAt ?? placement.place);
          drawObject(context2d, trial.kind, at, objectRadiusPx * (1 - 0.5 * sink), false);
        }
      }
      if (pinch.ready && pinch.pointSmoothSw) {
        drawHandCursor(
          context2d,
          context.toScreen(pinch.pointSmoothSw),
          Math.max(CURSOR_MIN_PX, CURSOR_SW * pixels),
          pinch.pinching,
        );
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // A trial cut short by a pause starts again, with the object back in place.
      if (trial?.machine.isLive) trial = null;
    },

    isFinished: () => records.length >= context.trialsPlanned && trial === null,

    getSummary(): GameResult {
      const transport = records
        .map((record) => record.metrics.transport_ms)
        .filter((value): value is number => typeof value === "number");
      const drops = records.reduce((total, record) => total + (record.metrics.drops ?? 0), 0);
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: {
          ...summariseTrials(records),
          details: {
            [DETAIL_MEAN_TRANSPORT_MS]:
              transport.length > 0
                ? Math.round(
                    transport.reduce((total, value) => total + value, 0) / transport.length,
                  )
                : null,
            [DETAIL_TOTAL_DROPS]: drops,
          },
        },
      };
    },

    getHudItems(): GameHudItem[] {
      return [{ key: "game.hud.placed", params: { n: collected.length } }];
    },

    destroy() {
      trial = null;
    },
  };
}
