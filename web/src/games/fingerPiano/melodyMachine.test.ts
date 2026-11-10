import { describe, expect, it } from "vitest";

import type { Finger } from "@/input/fingerTouch";

import {
  FALL_MS,
  type MelodyEvent,
  MelodyMachine,
  type MelodySettings,
  OUTCOME_MS,
} from "./melodyMachine";

const SETTINGS: MelodySettings = {
  notes: ["index", "middle", "ring", "little"],
  noteIntervalMs: 2000,
  hitWindowMs: 1200,
  previewMs: 2000,
  restMs: 1500,
};
/** The first note reaches the hit line after the preview and its fall. */
const FIRST = SETTINGS.previewMs + FALL_MS;
const arrival = (index: number, settings = SETTINGS) =>
  settings.previewMs + FALL_MS + index * settings.noteIntervalMs;

function create(settings: Partial<MelodySettings> = {}) {
  const machine = new MelodyMachine({ ...SETTINGS, ...settings }, 0);
  const events: MelodyEvent[] = [];
  return {
    machine,
    events,
    touch: (finger: Finger, t: number) => {
      const result = machine.touch(finger, t);
      events.push(...result);
      return result;
    },
    at: (now: number) => events.push(...machine.update(now)),
  };
}

describe("MelodyMachine timeline", () => {
  it("previews, then plays notes one interval apart", () => {
    const sim = create();
    expect(sim.machine.phase).toBe("PREVIEW");
    expect(sim.machine.isLive).toBe(true);
    sim.at(1999);
    expect(sim.machine.phase).toBe("PREVIEW");
    sim.at(2000);
    expect(sim.machine.phase).toBe("PLAY");
    expect(sim.machine.notes.map((note) => note.arrivalMs)).toEqual([
      FIRST,
      FIRST + 2000,
      FIRST + 4000,
      FIRST + 6000,
    ]);
    expect(sim.machine.nextNote?.finger).toBe("index");
  });
});

describe("hit window", () => {
  it.each([
    ["early, at the window's start", -600],
    ["on time", 0],
    ["late, at the window's end", 600],
  ])("hits when the right finger touches %s", (_, offset) => {
    const sim = create();
    sim.at(2000);
    const [event] = sim.touch("index", FIRST + offset);
    expect(event).toEqual({ type: "hit", index: 0, finger: "index", errorMs: offset });
    expect(sim.machine.notes[0].status).toBe("hit");
  });

  it("does not count a touch before the window opens", () => {
    const sim = create();
    sim.at(2000);
    expect(sim.touch("index", FIRST - 601)).toEqual([{ type: "stray", finger: "index" }]);
    expect(sim.machine.notes[0].status).toBe("pending");
  });

  it("closes a note nobody touched as missed once its window has passed", () => {
    const sim = create();
    sim.at(2000);
    sim.at(FIRST + 600);
    expect(sim.machine.notes[0].status).toBe("pending");
    sim.at(FIRST + 601);
    expect(sim.machine.notes[0].status).toBe("missed");
    expect(sim.events).toContainEqual({ type: "closed", index: 0, status: "missed" });
    // Too late now: the touch counts for nothing.
    expect(sim.touch("index", FIRST + 650)).toEqual([{ type: "stray", finger: "index" }]);
  });

  it("uses a narrower window when the setting is smaller", () => {
    const sim = create({ hitWindowMs: 600 });
    sim.at(2000);
    expect(sim.touch("index", FIRST + 301)[0].type).toBe("stray");
    expect(sim.touch("index", FIRST + 300)[0].type).toBe("hit");
  });
});

describe("wrong finger", () => {
  it("records a wrong finger without closing the note, so the right one can still play it", () => {
    const sim = create();
    sim.at(2000);
    expect(sim.touch("ring", FIRST - 200)).toEqual([{ type: "wrong", index: 0, finger: "ring" }]);
    expect(sim.machine.notes[0].status).toBe("pending");
    expect(sim.machine.notes[0].wrongTouches).toBe(1);
    expect(sim.touch("index", FIRST + 100)[0].type).toBe("hit");
    expect(sim.machine.notes[0].status).toBe("hit");
  });

  it("ends a note touched only with wrong fingers as wrong, not missed", () => {
    const sim = create();
    sim.at(2000);
    sim.touch("little", FIRST);
    sim.touch("middle", FIRST + 100);
    sim.at(FIRST + 700);
    expect(sim.machine.notes[0].status).toBe("wrong");
    expect(sim.machine.notes[0].wrongTouches).toBe(2);
    expect(sim.events).toContainEqual({ type: "closed", index: 0, status: "wrong" });
  });
});

describe("one touch, one note", () => {
  // 1200 ms apart with a 1500 ms window: the two windows overlap by 300 ms.
  const overlapping = {
    notes: ["index", "index"] as Finger[],
    noteIntervalMs: 1200,
    hitWindowMs: 1500,
  };

  it("plays only the earlier note when a touch falls in two windows", () => {
    const sim = create(overlapping);
    sim.at(2000);
    const inBoth = FIRST + 700; // After note 2's window opens at FIRST + 450.
    expect(sim.touch("index", inBoth)).toEqual([
      { type: "hit", index: 0, finger: "index", errorMs: 700 },
    ]);
    expect(sim.machine.notes[1].status).toBe("pending");
    // A second, separate touch plays the second note.
    expect(sim.touch("index", inBoth + 300)[0]).toMatchObject({ type: "hit", index: 1 });
  });

  it("gives a touch to the open note of the same finger", () => {
    const sim = create({ ...overlapping, notes: ["index", "middle"] });
    sim.at(2000);
    expect(sim.touch("middle", FIRST + 700)).toEqual([
      { type: "hit", index: 1, finger: "middle", errorMs: 700 - 1200 },
    ]);
    expect(sim.machine.notes[0].status).toBe("pending");
    expect(sim.machine.notes[0].wrongTouches).toBe(0);
  });

  it("never plays a note that is already played", () => {
    const sim = create();
    sim.at(2000);
    sim.touch("index", FIRST);
    expect(sim.touch("index", FIRST + 200)).toEqual([{ type: "stray", finger: "index" }]);
  });
});

describe("outcome", () => {
  function play(hits: number) {
    const sim = create();
    sim.at(2000);
    for (let index = 0; index < hits; index++) {
      sim.touch(SETTINGS.notes[index], arrival(index));
    }
    sim.at(arrival(3) + 601);
    return sim;
  }

  it("is a success with three of four notes (75%)", () => {
    const sim = play(3);
    expect(sim.machine.outcome).toBe("success");
    expect(sim.machine.phase).toBe("OUTCOME");
    expect(sim.machine.isLive).toBe(false);
  });

  it("is a miss with two of four notes", () => {
    const sim = play(2);
    expect(sim.machine.outcome).toBe("miss");
    expect(sim.events).toContainEqual({ type: "outcome", outcome: "miss" });
  });

  it("rests after the outcome and then finishes", () => {
    const sim = play(4);
    const end = arrival(3) + 601;
    sim.at(end + OUTCOME_MS);
    expect(sim.machine.phase).toBe("REST");
    sim.at(end + OUTCOME_MS + SETTINGS.restMs);
    expect(sim.machine.phase).toBe("DONE");
    expect(sim.touch("index", end + 5000)).toEqual([]);
  });
});
