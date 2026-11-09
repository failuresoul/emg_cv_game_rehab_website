import { CompensationTally } from "@/games/shared/compensationTally";
import { bestOfSuccesses, DETAIL_WIDEST_CATCH } from "@/features/games/results";
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
import type { TrialCreate } from "@/types/api";

import { FruitTrial } from "./fruitTrial";
import {
  BASKET_LINE_Y_SW,
  basketX,
  FRUIT_RADIUS_SW,
  fruitX,
  type LateralRange,
  lateralRange,
} from "./lateral";
import { type FruitCatchParams, readParams } from "./params";
import { drawBasket, drawFruit, drawGarden, FRUIT_KINDS, type FruitKind } from "./render";
import { buildFruitRecord, POINTS_PER_CATCH } from "./trialRecord";

/** Fruits appear just below the top bar; the ground is this far above the bottom edge. */
const TOP_PX = 110;
const GROUND_PX = 56;
/** At least this long between one fruit finishing and the next appearing, so it never rushes. */
const MIN_GAP_MS = 600;
/** After a pause, the next fruit appears this soon. */
const AFTER_PAUSE_MS = 1000;

interface ActiveFruit {
  no: number;
  params: GameParams;
  settings: FruitCatchParams;
  kind: FruitKind;
  trial: FruitTrial;
  recorder: TrajectoryRecorder;
  compensation: CompensationTally;
}

export function createFruitCatchGame(context: GameContext): GameInstance {
  const range: LateralRange = lateralRange(context.calibration?.reach_radii_sw ?? null);
  const records: TrialCreate[] = [];
  const encourager = new Encourager(context.rng.next);
  let fruits: ActiveFruit[] = [];
  /** The next fruit's number and settings, fetched once so spawning can use its timing. */
  let pending: { no: number; params: GameParams; settings: FruitCatchParams } | null = null;
  let spawned = 0;
  let caught = 0;
  let score = 0;
  let lastSpawnAt = -Infinity;
  let lastDoneAt = -Infinity;
  /** The basket's centre from the RAW fingertip, for catching; kept when the hand drops out. */
  let rawBasket: number | null = null;
  /** The basket's width on screen: the latest fruit's setting. */
  let basketWidthSw = readParams({}).basketWidthSw;
  let nowMs = 0;
  let started = false;
  let paused = false;

  const yAtScreen = (px: number) => context.toBody({ x: 0, y: px }).y;

  function nextPending() {
    if (!pending && spawned < context.trialsPlanned) {
      const no = spawned + 1;
      const params = context.params.next(no);
      pending = { no, params, settings: readParams(params) };
    }
    return pending;
  }

  function trySpawn(at: number): void {
    const next = nextPending();
    if (!next) return;
    let onScreen = 0;
    for (const fruit of fruits) if (fruit.trial.phase !== "DONE") onScreen++;
    if (onScreen >= next.settings.maxOnScreen) return;
    if (at < lastSpawnAt + next.settings.spawnIntervalMs || at < lastDoneAt + MIN_GAP_MS) return;

    const { no, params, settings } = next;
    const recorder = new TrajectoryRecorder();
    recorder.start(at);
    fruits.push({
      no,
      params,
      settings,
      kind: FRUIT_KINDS[(no - 1) % FRUIT_KINDS.length],
      trial: new FruitTrial(
        {
          x: fruitX(settings.side, settings.targetFrac, settings.spreadFrac, range),
          startY: yAtScreen(TOP_PX),
          groundY: yAtScreen(context.height - GROUND_PX),
          speedSwS: settings.fallSpeedSwS,
          basketWidthSw: settings.basketWidthSw,
        },
        at,
      ),
      recorder,
      compensation: new CompensationTally(),
    });
    spawned = no;
    pending = null;
    lastSpawnAt = at;
    basketWidthSw = settings.basketWidthSw;
  }

  function record(fruit: ActiveFruit): void {
    const outcome = fruit.trial.outcome;
    if (!outcome) return;
    const trial = buildFruitRecord({
      trialNo: fruit.no,
      params: fruit.params,
      side: fruit.settings.side,
      x: fruit.trial.setup.x,
      range,
      outcome,
      moments: fruit.trial.moments,
      compensation: fruit.compensation.toRecord(),
      trajectory: fruit.recorder.toArray(),
    });
    records.push(trial);
    context.logger.log(trial);
    if (outcome === "success") {
      caught++;
      score += POINTS_PER_CATCH;
      context.audio.success(caught % 8);
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
      const tracking = context.getTracking();
      if (tracking.rawSw) rawBasket = basketX(tracking.rawSw.x, range);

      trySpawn(now);
      const reading = context.compensation.reading;
      let anyDone = false;
      for (const fruit of fruits) {
        if (fruit.trial.isLive) {
          fruit.recorder.add(tracking.timestamp, tracking.rawSw);
          // Leaning sideways is the usual compensation here; every kind is checked.
          fruit.compensation.add(reading.sustained, reading.values);
        }
        for (const event of fruit.trial.update(now, rawBasket)) {
          if (event.type === "outcome") record(fruit);
          if (event.type === "landed") context.audio.plop();
          if (event.type === "done") {
            lastDoneAt = now;
            anyDone = true;
          }
        }
      }
      if (anyDone) fruits = fruits.filter((fruit) => fruit.trial.phase !== "DONE");
    },

    renderBackground(context2d) {
      drawGarden(context2d, context.width, context.height, context.height - GROUND_PX);
    },

    render(context2d) {
      const pixels = (sw: number) => sw * context.pixelsPerSw;
      const radius = pixels(FRUIT_RADIUS_SW);
      for (const fruit of fruits) {
        const { trial } = fruit;
        const at = context.toScreen({ x: trial.setup.x, y: trial.y(nowMs) });
        // A landed fruit settles on the ground and fades as it goes.
        const alpha = trial.phase === "LANDED" ? 0.6 : 1;
        // A caught fruit sits a little into the basket.
        const shown = trial.phase === "CAUGHT" ? { ...at, y: at.y - radius * 0.2 } : at;
        drawFruit(context2d, fruit.kind, shown, radius, alpha);
      }
      // The basket follows the smoothed cursor on screen; catching uses the raw fingertip.
      const smooth = context.getTracking().smoothSw;
      const shownX = smooth ? basketX(smooth.x, range) : rawBasket;
      if (shownX !== null) {
        const rim = context.toScreen({ x: shownX, y: BASKET_LINE_Y_SW });
        drawBasket(context2d, rim, pixels(basketWidthSw));
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // Fruits cut short by a pause fall again from the top, with the same numbers and settings.
      fruits = fruits.filter((fruit) => !fruit.trial.isLive);
      spawned = records.length;
      pending = null;
      lastSpawnAt = nowMs + AFTER_PAUSE_MS - (nextPending()?.settings.spawnIntervalMs ?? 0);
    },

    isFinished: () => records.length >= context.trialsPlanned && fruits.length === 0,

    getSummary(): GameResult {
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: {
          ...summariseTrials(records),
          details: {
            // The furthest caught, out or across, as a share of that side's reach.
            [DETAIL_WIDEST_CATCH]: bestOfSuccesses(
              records.map((trial) => ({
                outcome: trial.outcome,
                value: trial.target?.distance_frac,
              })),
            ),
          },
        },
      };
    },

    getHudItems(): GameHudItem[] {
      return [{ key: "game.hud.caught", params: { n: caught } }];
    },

    destroy() {
      fruits = [];
      pending = null;
    },
  };
}
