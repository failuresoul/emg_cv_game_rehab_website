import { describe, expect, it } from "vitest";

import type { Point } from "@/vision/geometry";

import {
  type CarryEvent,
  CarryMachine,
  type CarrySettings,
  GRASP_REACH,
  OUTCOME_MS,
} from "./carryMachine";

const STEP = 1000 / 60;
const PICK = { x: 0.2, y: 0.8 };
const PLACE = { x: 1.0, y: 0.4 };
const SETTINGS: CarrySettings = {
  pick: PICK,
  place: PLACE,
  objectRadiusSw: 0.35,
  boxSizeSw: 0.7,
  timeLimitMs: 15000,
  restMs: 1500,
};

interface Frame {
  point: Point | null;
  pinching: boolean | null;
}

function create(settings: CarrySettings = SETTINGS) {
  const machine = new CarryMachine(settings, 0);
  const events: CarryEvent[] = [];
  let now = 0;
  return {
    machine,
    events,
    get now() {
      return now;
    },
    /** Holds one frame's input until `until`. */
    hold(until: number, frame: Frame) {
      while (now + STEP <= until + 1e-9) {
        now += STEP;
        events.push(...machine.update({ nowMs: now, ...frame }));
      }
    },
    types: () => events.filter((event) => event.type !== "phase").map((event) => event.type),
  };
}

const open = (point: Point | null): Frame => ({ point, pinching: false });
const pinch = (point: Point | null): Frame => ({ point, pinching: true });

describe("CarryMachine", () => {
  it("grasps only when a pinch starts on the object", () => {
    const sim = create();
    // A pinch away from the object does nothing.
    sim.hold(300, open({ x: 1.2, y: 0 }));
    sim.hold(600, pinch({ x: 1.2, y: 0 }));
    expect(sim.machine.phase).toBe("REACH");
    sim.hold(900, open({ x: 1.2, y: 0 }));

    // Just outside the grasp reach: still nothing.
    const edge = { x: PICK.x + 0.35 * GRASP_REACH + 0.02, y: PICK.y };
    sim.hold(1100, pinch(edge));
    expect(sim.machine.phase).toBe("REACH");
    expect(sim.machine.moments.reached).toBeNull();
    sim.hold(1300, open(edge));

    sim.hold(1500, open(PICK));
    expect(sim.machine.moments.reached).toBeCloseTo(1300 + STEP, 0);
    sim.hold(1700, pinch(PICK));
    expect(sim.machine.phase).toBe("CARRY");
    expect(sim.machine.moments.firstGrasp).toBeCloseTo(1500 + STEP, 0);
    expect(sim.types()).toEqual(["reached", "grasped"]);
  });

  it("asks to open the fingers first when the hand arrives already pinching", () => {
    const sim = create();
    sim.hold(500, pinch({ x: 1.5, y: 0 }));
    sim.hold(1000, pinch(PICK));
    expect(sim.machine.phase).toBe("REACH");
    sim.hold(1200, open(PICK));
    sim.hold(1400, pinch(PICK));
    expect(sim.machine.phase).toBe("CARRY");
    expect(sim.types()).toEqual(["reached", "openFirst", "grasped"]);
  });

  it("carries the object with the pinch point, and holds it through unmeasured frames", () => {
    const sim = create();
    sim.hold(200, open(PICK));
    sim.hold(400, pinch(PICK));
    const halfway = { x: 0.6, y: 0.6 };
    sim.hold(800, pinch(halfway));
    expect(sim.machine.holding).toBe(true);
    expect(sim.machine.objectPosition).toEqual(halfway);
    // A lost frame neither drops nor moves the object.
    sim.hold(1000, { point: null, pinching: null });
    expect(sim.machine.holding).toBe(true);
    expect(sim.machine.objectPosition).toEqual(halfway);
  });

  it("places the object when the pinch opens inside the box", () => {
    const sim = create();
    sim.hold(200, open(PICK));
    sim.hold(400, pinch(PICK));
    const inBox = { x: 1.2, y: 0.5 };
    sim.hold(1500, pinch(inBox));
    sim.hold(1600, open(inBox));
    expect(sim.machine.outcome).toBe("success");
    expect(sim.machine.phase).toBe("OUTCOME");
    expect(sim.machine.placedAt).toEqual(inBox);
    expect(sim.machine.moments.placed).toBeCloseTo(1500 + STEP, 0);
    expect(sim.machine.drops).toBe(0);
    expect(sim.events).toContainEqual({ type: "placed", at: inBox });
  });

  it("drops the object back to its start when let go outside the box, then tries again", () => {
    const sim = create();
    sim.hold(200, open(PICK));
    sim.hold(400, pinch(PICK));
    const short = { x: 0.6, y: 0.6 };
    sim.hold(1000, pinch(short));
    sim.hold(1100, open(short));
    expect(sim.machine.phase).toBe("REACH");
    expect(sim.machine.drops).toBe(1);
    expect(sim.machine.objectPosition).toEqual(PICK);
    expect(sim.events).toContainEqual({ type: "dropped", at: short });

    // A second try: grasped again, carried, placed.
    sim.hold(1300, open(PICK));
    sim.hold(1500, pinch(PICK));
    sim.hold(2500, pinch(PLACE));
    sim.hold(2600, open(PLACE));
    expect(sim.machine.outcome).toBe("success");
    expect(sim.machine.drops).toBe(1);
    expect(sim.machine.moments.firstGrasp).toBeCloseTo(200 + STEP, 0);
    expect(sim.machine.moments.lastGrasp).toBeCloseTo(1300 + STEP, 0);
  });

  it("ends as a miss at the time limit, with the object back in place", () => {
    const sim = create({ ...SETTINGS, timeLimitMs: 3000 });
    sim.hold(200, open(PICK));
    sim.hold(400, pinch(PICK));
    sim.hold(3500, pinch({ x: 0.6, y: 0.6 }));
    expect(sim.machine.outcome).toBe("miss");
    expect(sim.machine.moments.end).toBeCloseTo(3000, -2);
    expect(sim.machine.objectPosition).toEqual(PICK);
    expect(sim.types()).toContain("timeout");
  });

  it("closes the box over the outcome, rests and then finishes", () => {
    const sim = create();
    sim.hold(200, open(PICK));
    sim.hold(400, pinch(PICK));
    sim.hold(600, pinch(PLACE));
    sim.hold(700, open(PLACE));
    const end = sim.machine.moments.end as number;
    expect(sim.machine.outcomeProgress(end + OUTCOME_MS / 2)).toBeCloseTo(0.5);
    sim.hold(end + OUTCOME_MS + 100, open(null));
    expect(sim.machine.phase).toBe("REST");
    sim.hold(end + OUTCOME_MS + SETTINGS.restMs + 100, open(null));
    expect(sim.machine.phase).toBe("DONE");
    expect(sim.machine.isLive).toBe(false);
  });
});
