import { describe, expect, it } from "vitest";

import { createRng } from "@/games/shared/rng";
import { FINGERS, type Finger } from "@/input/fingerTouch";

import { generateMelody, MAX_REPEATS, respectsRepeats } from "./melody";
import { activeFingers } from "./params";

const SEEDS = Array.from({ length: 200 }, (_, index) => index + 1);

describe("generateMelody", () => {
  it.each([
    ["index and middle", 2],
    ["three fingers", 3],
    ["all fingers", 4],
  ])("uses every active finger and only those, with %s", (_, count) => {
    const fingers = activeFingers(count);
    for (const seed of SEEDS) {
      for (let length = count; length <= 8; length++) {
        const melody = generateMelody(createRng(seed), fingers, length);
        expect(melody).toHaveLength(length);
        expect(new Set(melody)).toEqual(new Set(fingers));
      }
    }
  });

  it("never has the same finger more than twice in a row", () => {
    for (const seed of SEEDS) {
      for (const count of [2, 3, 4]) {
        const melody = generateMelody(createRng(seed), activeFingers(count), 8);
        expect(respectsRepeats(melody)).toBe(true);
      }
    }
  });

  it("uses different fingers when the melody is shorter than the finger set", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const melody = generateMelody(createRng(seed), FINGERS, 3);
      expect(new Set(melody).size).toBe(3);
    }
  });

  it("is the same for the same seed and differs between seeds", () => {
    const one = generateMelody(createRng(7), FINGERS, 8);
    expect(generateMelody(createRng(7), FINGERS, 8)).toEqual(one);
    const others = SEEDS.slice(0, 20).map((seed) =>
      generateMelody(createRng(seed), FINGERS, 8).join(),
    );
    expect(new Set(others).size).toBeGreaterThan(10);
  });

  it("prefers steps to a neighbouring finger, so melodies stay simple", () => {
    let steps = 0;
    let neighbours = 0;
    for (const seed of SEEDS) {
      const melody = generateMelody(createRng(seed), FINGERS, 8);
      // After the opening run through every finger.
      for (let index = 4; index < melody.length; index++) {
        steps++;
        const gap = Math.abs(FINGERS.indexOf(melody[index]) - FINGERS.indexOf(melody[index - 1]));
        if (gap === 1) neighbours++;
      }
    }
    expect(neighbours / steps).toBeGreaterThan(0.55);
  });

  it("is empty without fingers or length", () => {
    expect(generateMelody(createRng(1), [], 4)).toEqual([]);
    expect(generateMelody(createRng(1), FINGERS, 0)).toEqual([]);
  });
});

describe("respectsRepeats", () => {
  it("allows two in a row and rejects three", () => {
    const ok: Finger[] = ["index", "index", "middle", "middle", "index"];
    const bad: Finger[] = ["ring", "middle", "middle", "middle"];
    expect(MAX_REPEATS).toBe(2);
    expect(respectsRepeats(ok)).toBe(true);
    expect(respectsRepeats(bad)).toBe(false);
  });
});
