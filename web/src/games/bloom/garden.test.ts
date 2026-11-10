import { describe, expect, it } from "vitest";

import { FLOWER_COLOURS, gardenSlots, plantedCount } from "./garden";

const LAYOUT = { width: 1600, height: 900, spacing: 100 };

describe("gardenSlots", () => {
  it("has one place for each planted flower", () => {
    expect(gardenSlots(0, LAYOUT)).toEqual([]);
    expect(gardenSlots(1, LAYOUT)).toHaveLength(1);
    expect(gardenSlots(15, LAYOUT)).toHaveLength(15);
  });

  it("keeps earlier flowers where they are as the garden grows", () => {
    const small = gardenSlots(4, LAYOUT);
    const large = gardenSlots(12, LAYOUT);
    expect(large.slice(0, 4)).toEqual(small);
  });

  it("fills the bottom row left to right before starting the next row up", () => {
    const flowers = gardenSlots(20, LAYOUT);
    const perRow = Math.floor((1600 - 64) / 100); // 15
    const bottom = flowers.slice(0, perRow);
    expect(new Set(bottom.map((flower) => flower.base.y)).size).toBe(1);
    for (let index = 1; index < perRow; index++) {
      expect(bottom[index].base.x).toBeGreaterThan(bottom[index - 1].base.x);
    }
    expect(flowers[perRow].base.y).toBeLessThan(bottom[0].base.y);
  });

  it("stays on the screen and never stacks two flowers on one spot", () => {
    const narrow = { width: 500, height: 700, spacing: 80 };
    const flowers = gardenSlots(15, narrow);
    for (const { base } of flowers) {
      expect(base.x).toBeGreaterThan(0);
      expect(base.x).toBeLessThan(narrow.width);
      expect(base.y).toBeLessThan(narrow.height);
      expect(base.y).toBeGreaterThan(narrow.height / 2);
    }
    const spots = new Set(flowers.map(({ base }) => `${base.x},${base.y}`));
    expect(spots.size).toBe(15);
  });

  it("gives the flowers colours in turn", () => {
    const flowers = gardenSlots(FLOWER_COLOURS.length + 1, LAYOUT);
    expect(flowers[0].colour).toBe(FLOWER_COLOURS[0]);
    expect(flowers[1].colour).toBe(FLOWER_COLOURS[1]);
    expect(flowers[FLOWER_COLOURS.length].colour).toBe(FLOWER_COLOURS[0]);
  });
});

describe("plantedCount", () => {
  it("plants each collected flower once its seed has landed", () => {
    expect(plantedCount(0, "OPEN")).toBe(0);
    expect(plantedCount(1, "COLLECTED")).toBe(0);
    expect(plantedCount(1, "REST")).toBe(1);
    expect(plantedCount(3, "OPEN")).toBe(3);
    expect(plantedCount(3, null)).toBe(3);
  });
});
