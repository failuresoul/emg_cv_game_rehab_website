import { describe, expect, it, vi } from "vitest";

import { FixedProvider } from "@/ai/paramsProvider";
import { DETAIL_MEAN_TRANSPORT_MS, DETAIL_TOTAL_DROPS } from "@/features/games/results";
import { gameAudio } from "@/games/shared/audio";
import { createPlayArea } from "@/games/shared/playArea";
import { defaultParams, GAMES } from "@/games/shared/registry";
import { createRng } from "@/games/shared/rng";
import type { GameContext, GameFeedback, GameParams } from "@/games/shared/types";
import type { PinchState } from "@/input/pinch";
import type { TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";
import type { CompensationMonitor } from "@/warmup/compensation";

import { OUTCOME_MS } from "./carryMachine";
import { pickPlace } from "./index";
import { CARRY_DIRECTIONS, PICK_PLACE_PARAMS, readParams } from "./params";
import { screenBounds } from "./pickPlaceGame";
import { placePickPlace } from "./placement";
import { createPickPlaceGame } from "./pickPlaceGame";

const STEP = 1000 / 60;
const PARAMS: GameParams = defaultParams(PICK_PLACE_PARAMS);
const AREA = createPlayArea({ width: 1600, height: 900, affectedSide: "right", hull: null });
// Without a calibration, the game uses the default reach.
const PLACEMENT = placePickPlace({
  ...readParams(PARAMS),
  reachRadiiSw: null,
  transform: AREA,
  bounds: screenBounds(1600, 900),
});
const { pick: PICK, place: PLACE } = PLACEMENT;

/** What the hand does at a moment: where the pinch point is, and whether it pinches. */
type Script = (t: number) => { point: Point | null; pinching: boolean };

const lerp = (a: Point, b: Point, share: number): Point => ({
  x: a.x + (b.x - a.x) * Math.min(1, Math.max(0, share)),
  y: a.y + (b.y - a.y) * Math.min(1, Math.max(0, share)),
});

function setUp(script: Script, trialsPlanned = 1) {
  let now = 0;
  const logged: TrialCreate[] = [];
  const feedback: GameFeedback[] = [];
  const success = vi.fn();
  const plop = vi.fn();
  const next = vi.fn(() => ({ ...PARAMS }));
  const pinch = (): PinchState => {
    const { point, pinching } = script(now);
    return {
      ready: point !== null,
      pinching: point !== null && pinching,
      strength: pinching ? 1 : 0,
      pointRawSw: point,
      pointSmoothSw: point,
      t: now,
    };
  };
  const context: GameContext = {
    gameId: "pick_place",
    width: 1600,
    height: 900,
    trialsPlanned,
    toScreen: AREA.toScreen,
    toBody: AREA.toBody,
    pixelsPerSw: AREA.pixelsPerSw,
    getTracking: () => ({
      rawSw: script(now).point,
      smoothSw: script(now).point,
      handLost: script(now).point === null,
      handLostMs: 0,
      armElevationDeg: null,
      elbowFlexionDeg: null,
      timestamp: now,
    }),
    activation: { sourceId: "keyboard", getLevel: () => 0, isReady: () => true },
    hand: {
      getOpenness: () => 0,
      isOpennessReady: () => true,
      getTouch: () => null,
      isTouchReady: () => true,
      subscribeTouch: () => () => {},
      setTouchThreshold: () => {},
      getPinch: pinch,
      subscribePinch: () => () => {},
    },
    calibration: null,
    affectedSide: "right",
    rng: createRng(1),
    audio: { ...gameAudio, success, plop, tick: () => {}, finish: () => {} },
    params: { engine: "L0", next },
    logger: { log: (trial) => logged.push(trial) },
    compensation: {
      reading: { baseline: null, values: null, sustained: [], cue: null },
    } as unknown as CompensationMonitor,
    emit: (item) => feedback.push(item),
  };
  const game = createPickPlaceGame(context);
  game.start();
  return {
    game,
    logged,
    feedback,
    success,
    plop,
    next,
    runUntil: (until: number) => {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        game.update(STEP, now);
      }
    },
  };
}

/** Reach the fruit by 600 ms, pinch at 800, carry it to the box by 2800, let go at 3000. */
const placeIt: Script = (t) => {
  if (t < 600) return { point: lerp({ x: 0.2, y: 0 }, PICK, t / 600), pinching: false };
  if (t < 800) return { point: PICK, pinching: false };
  if (t < 3000) return { point: lerp(PICK, PLACE, (t - 800) / 2000), pinching: true };
  return { point: PLACE, pinching: false };
};

describe("pick_place game", () => {
  it("is registered with 12 trials and its settings", () => {
    expect(GAMES.pick_place).toBe(pickPlace);
    expect(pickPlace.implemented).toBe(true);
    expect(pickPlace.trialsDefault).toBe(12);
    expect(pickPlace.showCursor).toBe(false);
    expect(PARAMS).toEqual({
      object_radius_sw: 0.35,
      pick_distance_frac: 0.6,
      place_distance_frac: 0.7,
      box_size_sw: 0.7,
      carry_angle_deg: 90,
      time_limit_ms: 15000,
      carry_direction: 0,
      rest_ms: 1500,
    });
  });

  it("logs an object carried to the box as a success, with its target and measures", () => {
    const sim = setUp(placeIt);
    sim.runUntil(3000 + OUTCOME_MS + 1500 + 200);

    expect(sim.next).toHaveBeenCalledTimes(1);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.params).toEqual(PARAMS);
    expect(trial.target).toMatchObject({
      kind: "pick_place",
      object_radius_sw: 0.35,
      box_size_sw: 0.7,
    });
    expect(trial.target?.pick?.[0]).toBeCloseTo(PICK.x, 3);
    expect(trial.target?.place?.[1]).toBeCloseTo(PLACE.y, 3);
    // The hand reaches the fruit's edge a little before 600 ms.
    expect(trial.metrics.reach_ms as number).toBeGreaterThan(300);
    expect(trial.metrics.reach_ms as number).toBeLessThanOrEqual(620);
    expect(trial.metrics.grasp_latency_ms as number).toBeGreaterThanOrEqual(180);
    expect(trial.metrics.transport_ms).toBeCloseTo(2200, -2);
    expect(trial.metrics.transport_path_efficiency).toBeCloseTo(1, 2);
    expect(trial.metrics.release_error_sw).toBeCloseTo(0, 3);
    expect(trial.metrics.drops).toBe(0);
    expect(trial.metrics.sparc as number).toBeLessThanOrEqual(0);
    expect(trial.trajectory.length).toBeGreaterThan(50);
    expect(sim.success).toHaveBeenCalledTimes(1);
    expect(sim.game.isFinished()).toBe(true);

    const result = sim.game.getSummary();
    expect(result.trialsDone).toBe(1);
    expect(result.score).toBeGreaterThan(100);
    expect(result.summary.details).toMatchObject({ [DETAIL_TOTAL_DROPS]: 0 });
    expect(result.summary.details?.[DETAIL_MEAN_TRANSPORT_MS]).toBeCloseTo(2200, -2);
    expect(sim.game.getHudItems?.()).toEqual([{ key: "game.hud.placed", params: { n: 1 } }]);
  });

  it("drops an object let go outside the box back to its start, and counts it", () => {
    const short = lerp(PICK, PLACE, 0.3);
    const script: Script = (t) => {
      if (t < 1600) return placeIt(t);
      if (t < 2000) return { point: short, pinching: false }; // Let go too soon.
      if (t < 2300) return { point: PICK, pinching: false };
      if (t < 4300) return { point: lerp(PICK, PLACE, (t - 2300) / 1500), pinching: true };
      return { point: PLACE, pinching: false };
    };
    const sim = setUp(script);
    sim.runUntil(4300 + OUTCOME_MS + 1700);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("success");
    expect(trial.metrics.drops).toBe(1);
    expect(trial.metrics.transport_ms).toBeCloseTo(2000, -2);
    expect(sim.plop).toHaveBeenCalledTimes(1);
    expect(sim.feedback.map((item) => item.key)).toContain("game.pick_place.prompt.dropped");
  });

  it("ends as a miss with a calm message at the time limit", () => {
    const sim = setUp(() => ({ point: { x: 0.1, y: -0.2 }, pinching: false }));
    sim.runUntil(15000 + OUTCOME_MS + 1700);
    const [trial] = sim.logged;
    expect(trial.outcome).toBe("miss");
    expect(trial.metrics).toMatchObject({ reach_ms: null, transport_ms: null, drops: 0 });
    expect(sim.feedback.map((item) => item.key)).toContain("game.pick_place.prompt.timeout");
    expect(sim.success).not.toHaveBeenCalled();
  });

  it("restarts a trial cut short by a pause", () => {
    const sim = setUp(placeIt, 2);
    sim.runUntil(1500);
    sim.game.pause();
    sim.game.resume();
    expect(sim.logged).toHaveLength(0);
    sim.runUntil(1600);
    expect(sim.next).toHaveBeenCalledTimes(2);
  });
});

describe("FixedProvider for pick_place", () => {
  it("carries outward, inward, up and down in every block of four", () => {
    const provider = new FixedProvider({ specsFor: (id) => GAMES[id].params, seed: 7 });
    const directions = Array.from(
      { length: 12 },
      (_, index) => provider.nextParams("pick_place", [], index + 1).carry_direction,
    );
    for (let block = 0; block < 3; block++) {
      expect([...directions.slice(block * 4, block * 4 + 4)].sort()).toEqual([0, 1, 2, 3]);
    }
    expect(directions.every((value, index) => index === 0 || value !== directions[index - 1])).toBe(
      true,
    );
    expect(CARRY_DIRECTIONS).toEqual(["outward", "inward", "up", "down"]);
  });
});
