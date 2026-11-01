import { describe, expect, it } from "vitest";

import {
  type BodyFrame,
  convexHull,
  createBodyFrame,
  fromBodyFrame,
  median,
  polygonArea,
  projectOnDirection,
  toBodyFrame,
  toPixel,
} from "./geometry";

// A patient facing the camera: in a raw image, the person's own left is on the image's right.
const LEFT_SHOULDER = { x: 400, y: 200 };
const RIGHT_SHOULDER = { x: 240, y: 200 };
const WIDTH = 160;

describe("convexHull", () => {
  it("keeps only the corners of a square", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]);

    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 1, y: 1 });
    expect(hull).not.toContainEqual({ x: 1, y: 0 });
    expect(polygonArea(hull)).toBeCloseTo(4);
  });

  it("returns a triangle unchanged apart from order", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ]);

    expect(hull).toHaveLength(3);
    expect(polygonArea(hull)).toBeCloseTo(6);
  });

  it("removes duplicates and handles too few points", () => {
    expect(convexHull([])).toEqual([]);
    expect(
      convexHull([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([{ x: 1, y: 1 }]);
  });

  it("reduces points on one line to the two ends, with no area", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);

    expect(hull).toHaveLength(2);
    expect(polygonArea(hull)).toBe(0);
  });

  it("gives the expected area for eight reach points on a circle", () => {
    const points = Array.from({ length: 8 }, (_, index) => {
      const angle = (index * Math.PI) / 4;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    });

    const hull = convexHull(points);

    expect(hull).toHaveLength(8);
    expect(polygonArea(hull)).toBeCloseTo(2 * Math.SQRT2);
  });
});

describe("polygonArea", () => {
  it("is positive whichever way the corners run", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ];

    expect(polygonArea(square)).toBeCloseTo(9);
    expect(polygonArea([...square].reverse())).toBeCloseTo(9);
  });
});

describe("body frame", () => {
  const frames: [string, BodyFrame][] = [
    ["left", createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "left", WIDTH)],
    ["right", createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "right", WIDTH)],
  ];

  it.each(frames)("round trips through the %s-affected frame", (_, frame) => {
    const point = { x: 123.4, y: 56.7 };

    const back = fromBodyFrame(toBodyFrame(point, frame), frame);

    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it.each(frames)("round trips from body coordinates in the %s-affected frame", (_, frame) => {
    const point = { x: -0.7, y: 1.3 };

    const back = toBodyFrame(fromBodyFrame(point, frame), frame);

    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it.each(frames)(
    "puts the affected shoulder at the origin of the %s-affected frame",
    (_, frame) => {
      expect(toBodyFrame(frame.origin, frame)).toEqual({ x: 0, y: 0 });
    },
  );

  it("gives +x for the same outward reach on both affected sides", () => {
    const leftFrame = createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "left", WIDTH);
    const rightFrame = createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "right", WIDTH);

    // One shoulder width outward: to the person's left, then to the person's right.
    const leftReach = toBodyFrame({ x: LEFT_SHOULDER.x + WIDTH, y: 200 }, leftFrame);
    const rightReach = toBodyFrame({ x: RIGHT_SHOULDER.x - WIDTH, y: 200 }, rightFrame);

    expect(leftReach.x).toBeCloseTo(1);
    expect(leftReach.y).toBeCloseTo(0);
    expect(rightReach.x).toBeCloseTo(1);
    expect(rightReach.y).toBeCloseTo(0);
  });

  it("gives -x when reaching across the body on both affected sides", () => {
    const leftFrame = createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "left", WIDTH);
    const rightFrame = createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "right", WIDTH);

    expect(toBodyFrame(RIGHT_SHOULDER, leftFrame).x).toBe(-1);
    expect(toBodyFrame(LEFT_SHOULDER, rightFrame).x).toBe(-1);
  });

  it("still gives +x outward if the webcam mirrors its image", () => {
    const mirroredLeft = { x: 240, y: 200 };
    const mirroredRight = { x: 400, y: 200 };
    const frame = createBodyFrame(mirroredLeft, mirroredRight, "left", WIDTH);

    expect(toBodyFrame({ x: 240 - WIDTH, y: 200 }, frame).x).toBe(1);
  });

  it("gives +y for moving up, although image y grows downward", () => {
    const frame = createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "left", WIDTH);

    expect(toBodyFrame({ x: LEFT_SHOULDER.x, y: 200 - WIDTH / 2 }, frame)).toEqual({
      x: 0,
      y: 0.5,
    });
  });
});

describe("affected-side symmetry", () => {
  const leftFrame = createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "left", WIDTH);
  const rightFrame = createBodyFrame(LEFT_SHOULDER, RIGHT_SHOULDER, "right", WIDTH);
  const directions = [0, 45, 90, 135, 180, 225, 270, 315];

  it.each(directions)("gives mirrored patients the same reach at %i degrees", (degrees) => {
    const radians = (degrees * Math.PI) / 180;
    const dx = WIDTH * 1.3 * Math.cos(radians);
    const dy = WIDTH * 1.3 * Math.sin(radians);

    // The left side's outward is the image's +x, and the right side's is -x. Up is the same.
    const left = toBodyFrame({ x: LEFT_SHOULDER.x + dx, y: LEFT_SHOULDER.y - dy }, leftFrame);
    const right = toBodyFrame({ x: RIGHT_SHOULDER.x - dx, y: RIGHT_SHOULDER.y - dy }, rightFrame);

    expect(left.x).toBeCloseTo(right.x);
    expect(left.y).toBeCloseTo(right.y);
    expect(projectOnDirection(left, degrees)).toBeCloseTo(1.3);
    expect(projectOnDirection(right, degrees)).toBeCloseTo(1.3);
  });

  it("uses the same up for both sides", () => {
    expect(leftFrame.yAxis).toEqual(rightFrame.yAxis);
    expect(leftFrame.xAxis.x).toBe(-rightFrame.xAxis.x);
  });

  it("gives a mirrored reach map the same area", () => {
    const points = [
      { x: 1.2, y: 0.1 },
      { x: 0.2, y: 1.1 },
      { x: -0.9, y: 0.3 },
      { x: 0.1, y: -1.4 },
    ];
    const mirrored = points.map((point) => ({ x: -point.x, y: point.y }));

    expect(polygonArea(convexHull(mirrored))).toBeCloseTo(polygonArea(convexHull(points)));
  });
});

describe("small helpers", () => {
  it("converts normalised landmarks to pixels", () => {
    expect(toPixel({ x: 0.5, y: 0.25 }, 640, 480)).toEqual({ x: 320, y: 120 });
  });

  it("finds the median of odd and even lists without changing them", () => {
    const values = [3, 1, 2];

    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it("projects a point on a direction in degrees", () => {
    const point = { x: 1, y: 1 };

    expect(projectOnDirection(point, 0)).toBeCloseTo(1);
    expect(projectOnDirection(point, 90)).toBeCloseTo(1);
    expect(projectOnDirection(point, 45)).toBeCloseTo(Math.SQRT2);
    expect(projectOnDirection(point, 225)).toBeCloseTo(-Math.SQRT2);
  });
});
