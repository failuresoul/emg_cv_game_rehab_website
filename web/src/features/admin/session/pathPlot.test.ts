import { describe, expect, it } from "vitest";

import { pathPlotGeometry } from "./pathPlot";

const parse = (points: string) =>
  points
    .split(" ")
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as [number, number]);

const PATH: [number, number][] = [
  [0.2, 0.1],
  [0.6, 0.1],
  [0.6, 0.5],
];
const TRAJECTORY = [
  [0, 0.2, 0.12],
  [33, 0.4, 0.08],
  [66, 0.62, 0.3],
];

describe("pathPlotGeometry", () => {
  it("fits the path and the fingertip inside the box, keeping their shape", () => {
    const plot = pathPlotGeometry(PATH, TRAJECTORY, "right", 480, 320);
    const all = [...parse(plot.path), ...parse(plot.fingertip)];
    for (const [x, y] of all) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(480);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(320);
    }
    const [first, second, third] = parse(plot.path);
    // One scale for both axes: the two sides of the L are the same length.
    expect(Math.abs(second[0] - first[0])).toBeCloseTo(Math.abs(third[1] - second[1]), 0);
    expect(plot.scale).toBeGreaterThan(0);
    expect(plot.start).toEqual({ x: first[0], y: first[1] });
  });

  it("draws up as up and outward on the affected side, as on the reach map", () => {
    const right = parse(pathPlotGeometry(PATH, [], "right", 480, 320).path);
    const left = parse(pathPlotGeometry(PATH, [], "left", 480, 320).path);
    // +y up: the last point (higher) has a smaller screen y.
    expect(right[2][1]).toBeLessThan(right[1][1]);
    // Outward (+x) goes right for a right-affected patient, left for a left-affected one.
    expect(right[1][0]).toBeGreaterThan(right[0][0]);
    expect(left[1][0]).toBeLessThan(left[0][0]);
  });

  it("is empty with nothing to draw", () => {
    expect(pathPlotGeometry([], [], "right", 480, 320)).toEqual({
      path: "",
      fingertip: "",
      start: null,
      scale: 0,
    });
  });
});
