import { describe, expect, it } from "vitest";

import { KEYBOARD_FALL_MS, KEYBOARD_RISE_MS, KeyboardSource } from "./keyboardSource";

function create() {
  let time = 0;
  const source = new KeyboardSource({ now: () => time });
  return {
    source,
    at: (ms: number) => {
      time = ms;
    },
  };
}

describe("KeyboardSource", () => {
  it("is always ready and starts relaxed", () => {
    const { source } = create();
    expect(source.isReady()).toBe(true);
    expect(source.getLevel()).toBe(0);
  });

  it("rises linearly to 1 over 300 ms while Space is held", () => {
    const { source } = create();
    source.press(1000);
    expect(source.getLevel(1000)).toBe(0);
    expect(source.getLevel(1150)).toBeCloseTo(0.5);
    expect(source.getLevel(1000 + KEYBOARD_RISE_MS)).toBe(1);
    expect(source.getLevel(5000)).toBe(1);
  });

  it("falls linearly to 0 over 200 ms after release", () => {
    const { source } = create();
    source.press(0);
    source.release(1000);
    expect(source.getLevel(1000)).toBe(1);
    expect(source.getLevel(1100)).toBeCloseTo(0.5);
    expect(source.getLevel(1000 + KEYBOARD_FALL_MS)).toBe(0);
    expect(source.getLevel(3000)).toBe(0);
  });

  it("continues from the current level when released or pressed mid-ramp", () => {
    const { source } = create();
    source.press(0);
    source.release(150); // Level 0.5.
    expect(source.getLevel(200)).toBeCloseTo(0.25);
    source.press(200); // From 0.25.
    expect(source.getLevel(275)).toBeCloseTo(0.5);
  });

  it("ignores repeated presses while Space is held", () => {
    const { source } = create();
    source.press(0);
    source.press(100);
    source.press(200);
    expect(source.getLevel(300)).toBe(1);
  });

  it("uses its clock when no time is given", () => {
    const { source, at } = create();
    at(500);
    source.press();
    at(650);
    expect(source.getLevel()).toBeCloseTo(0.5);
  });

  it("tells listeners only when the level changes", () => {
    const { source } = create();
    const levels: number[] = [];
    source.subscribe((level) => levels.push(level));
    source.tick(0);
    source.tick(10);
    source.press(100);
    source.tick(250);
    source.tick(400);
    source.tick(500);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBeCloseTo(0.5);
    expect(levels[2]).toBe(1);
  });
});
