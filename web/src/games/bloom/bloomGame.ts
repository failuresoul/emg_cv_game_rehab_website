import { DETAIL_BEST_OPENNESS, DETAIL_MEAN_TIME_TO_OPEN } from "@/features/games/results";
import { CompensationTally } from "@/games/shared/compensationTally";
import { arc, drawHandGrab, drawHandOpen, drawLevelBar, TRACK_COLOR } from "@/games/shared/drawing";
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
import type { Point } from "@/vision/geometry";

import { BloomMachine } from "./bloomMachine";
import { FLOWER_COLOURS, gardenSlots, plantedCount } from "./garden";
import { type BloomParams, readParams } from "./params";
import {
  basketMouth,
  BED_TOP_SHARE,
  drawBasket,
  drawFlower,
  drawGardenBackground,
  drawSeed,
  drawSparkle,
  flowerHead,
  seedPosition,
} from "./render";
import { bloomMetrics, bloomScore, buildBloomRecord } from "./trialRecord";

const HOLD_RING_COLOR = "#F7D774";
const ICON_BACKDROP = "rgba(0, 0, 0, 0.25)";

interface ActiveFlower {
  no: number;
  params: GameParams;
  settings: BloomParams;
  machine: BloomMachine;
  compensation: CompensationTally;
  colour: string;
  /** The last openness seen while opening, so a missed bud fades from where it was. */
  lastOpenness: number;
}

/** Sizes and places in canvas pixels, worked out from the screen size each frame. */
interface Layout {
  base: Point;
  stemHeight: number;
  radius: number;
  basketBase: Point;
  basketSize: number;
  spacing: number;
}

function layoutFor(width: number, height: number): Layout {
  const radius = Math.max(36, Math.min(width, height) * 0.11);
  const bedTop = height * BED_TOP_SHARE;
  return {
    base: { x: width / 2, y: bedTop - height * 0.02 },
    stemHeight: height * 0.26,
    radius,
    basketBase: { x: width * 0.82, y: bedTop + height * 0.02 },
    basketSize: Math.max(60, radius * 1.4),
    spacing: Math.min(110, Math.max(56, width / 14)),
  };
}

export function createBloomGame(context: GameContext): GameInstance {
  const records: TrialCreate[] = [];
  const encourager = new Encourager(context.rng.next);
  let score = 0;
  let flowers = 0;
  let trial: ActiveFlower | null = null;
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
      machine: new BloomMachine(settings, at),
      compensation: new CompensationTally(),
      colour: FLOWER_COLOURS[flowers % FLOWER_COLOURS.length],
      lastOpenness: 0,
    };
    context.emit({ key: "game.bloom.prompt.open", tone: "neutral" });
  }

  function finishTrial(current: ActiveFlower): void {
    const { machine } = current;
    const outcome = machine.outcome;
    if (!outcome) return;
    const metrics = bloomMetrics(machine.moments, machine.opennessSamples, machine.peakGrip);
    const record = buildBloomRecord({
      trialNo: current.no,
      params: current.params,
      outcome,
      failedPhase: machine.failedPhase,
      moments: machine.moments,
      metrics,
      compensation: current.compensation.toRecord(),
    });
    records.push(record);
    context.logger.log(record);
    score += bloomScore(outcome, metrics.timeToOpenMs, current.settings.phaseTimeLimitMs);
    if (outcome === "success") {
      flowers++;
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
      if (!trial) {
        if (records.length >= context.trialsPlanned) return;
        spawn(records.length + 1, now);
      }
      const current = trial as ActiveFlower;
      const { machine } = current;
      const openness = context.hand.getOpenness();
      if (machine.phase === "OPEN") current.lastOpenness = openness;

      // Posture counts while the flower is being played, the frame that ends it included.
      if (machine.isLive) {
        const reading = context.compensation.reading;
        current.compensation.add(reading.sustained, reading.values);
      }
      const events = machine.update({ nowMs: now, openness, grip: context.activation.getLevel() });

      for (const event of events) {
        if (event.type === "bloomed") context.audio.success(flowers % 8);
        if (event.type === "phase" && event.phase === "CLOSE") {
          context.audio.tick();
          context.emit({ key: "game.bloom.prompt.close", tone: "neutral" });
        }
        if (event.type === "outcome") finishTrial(current);
      }
      if (machine.phase === "DONE") trial = null;
    },

    renderBackground(context2d) {
      drawGardenBackground(context2d, context.width, context.height);
    },

    render(context2d) {
      const layout = layoutFor(context.width, context.height);
      const phase = trial?.machine.phase;

      const planted = plantedCount(flowers, phase ?? null);
      const size = layout.spacing;
      for (const flower of gardenSlots(planted, {
        width: context.width,
        height: context.height,
        spacing: size,
      })) {
        drawFlower(context2d, {
          base: flower.base,
          stemHeight: size * 0.55,
          radius: size * 0.3,
          openness: 1,
          colour: flower.colour,
        });
      }
      drawBasket(context2d, layout.basketBase, layout.basketSize);

      if (!trial || phase === "REST" || phase === "DONE") return;
      const { machine, settings } = trial;
      const progress = machine.phaseProgress(nowMs);
      const flower = {
        base: layout.base,
        stemHeight: layout.stemHeight,
        radius: layout.radius,
        colour: trial.colour,
      };
      const head = flowerHead(flower);

      if (phase === "MISSED") {
        drawFlower(context2d, {
          ...flower,
          openness: machine.failedPhase === "open" ? trial.lastOpenness : 1,
          alpha: 1 - progress,
          droop: layout.radius * 0.6 * progress,
        });
        return;
      }

      const opening = phase === "OPEN";
      const openness = opening ? context.hand.getOpenness() : 1;
      drawFlower(context2d, { ...flower, openness });
      if (phase === "BLOOMED") drawSparkle(context2d, head, layout.radius, progress);
      if (phase === "CLOSE") drawSeed(context2d, head, layout.radius * 0.12);
      if (phase === "COLLECTED") {
        const mouth = basketMouth(layout.basketBase, layout.basketSize);
        drawSeed(context2d, seedPosition(head, mouth, progress), layout.radius * 0.12);
        return;
      }

      if (opening || phase === "CLOSE") {
        const ringRadius = layout.radius * 1.35;
        const ringWidth = Math.max(6, layout.radius * 0.08);
        arc(context2d, head, ringRadius, 1, TRACK_COLOR, ringWidth);
        if (machine.holdProgress > 0) {
          arc(context2d, head, ringRadius, machine.holdProgress, HOLD_RING_COLOR, ringWidth);
        }

        const barHeight = layout.radius * 2.6;
        drawLevelBar(context2d, {
          x: head.x + layout.radius * 1.9,
          y: head.y - barHeight / 2,
          width: Math.max(20, layout.radius * 0.24),
          height: barHeight,
          level: opening ? openness : context.activation.getLevel(),
          demand: opening ? settings.openDemand : settings.closeDemand,
        });

        const iconCentre = { x: head.x - layout.radius * 2.2, y: head.y };
        const iconSize = Math.max(40, layout.radius * 0.8);
        context2d.fillStyle = ICON_BACKDROP;
        context2d.beginPath();
        context2d.arc(iconCentre.x, iconCentre.y, iconSize * 0.8, 0, Math.PI * 2);
        context2d.fill();
        if (opening) drawHandOpen(context2d, iconCentre, iconSize);
        else drawHandGrab(context2d, iconCentre, iconSize);
      }
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      // A flower cut short by a pause grows again from a bud, with the same settings.
      if (trial?.machine.isLive) trial = null;
    },

    isFinished: () => records.length >= context.trialsPlanned && trial === null,

    getSummary(): GameResult {
      const times = records
        .filter((record) => record.outcome === "success")
        .map((record) => record.metrics.time_to_open_ms)
        .filter((value): value is number => typeof value === "number");
      const peaks = records
        .map((record) => record.metrics.peak_openness)
        .filter((value): value is number => typeof value === "number");
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: {
          ...summariseTrials(records),
          details: {
            [DETAIL_MEAN_TIME_TO_OPEN]:
              times.length > 0
                ? Math.round(times.reduce((total, value) => total + value, 0) / times.length)
                : null,
            [DETAIL_BEST_OPENNESS]: peaks.length > 0 ? Math.max(...peaks) : null,
          },
        },
      };
    },

    getHudItems(): GameHudItem[] {
      return [{ key: "game.hud.flowers", params: { n: flowers } }];
    },

    destroy() {
      trial = null;
    },
  };
}
