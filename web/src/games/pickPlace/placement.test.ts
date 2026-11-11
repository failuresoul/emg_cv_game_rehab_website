import { describe, expect, it } from "vitest";

import { createPlayArea } from "@/games/shared/playArea";
import { reachInDirection, type ScreenBounds } from "@/games/shared/targetPlacement";
import type { Side } from "@/types/api";
import type { Point } from "@/vision/geometry";

import { CARRY_DIRECTIONS, type CarryDirection } from "./params";
import {
  carryDirections,
  insideBox,
  PLACE_GAP_SW,
  type PickPlaceInput,
  placePickPlace,
} from "./placement";

/** A calibrated reach: longest outward and up, short across the body and down. */
const RADII = [1.5, 1.4, 1.2, 0.9, 0.7, 0.6, 0.5, 0.9];
const RADII_HULL: Point[] = RADII.map((radius, index) => ({
  x: radius * Math.cos((index * Math.PI) / 4),
  y: radius * Math.sin((index * Math.PI) / 4),
}));

function area(side: Side) {
  const play = createPlayArea({
    width: 1600,
    height: 900,
    affectedSide: side,
    hull: RADII_HULL,
    insets: { top: 96 },
  });
  const bounds: ScreenBounds = {
    width: 1600,
    height: 900,
    top: 96,
    right: 32,
    bottom: 120,
    left: 32,
  };
  return { play, bounds };
}

function input(side: Side, changes: Partial<PickPlaceInput> = {}): PickPlaceInput {
  const { play, bounds } = area(side);
  return {
    carry: "outward",
    carryAngleDeg: 90,
    pickDistanceFrac: 0.6,
    placeDistanceFrac: 0.7,
    objectRadiusSw: 0.35,
    boxSizeSw: 0.7,
    reachRadiiSw: RADII,
    transform: play,
    bounds,
    ...changes,
  };
}

const directionOf = (point: Point) => {
  const deg = (Math.atan2(point.y, point.x) * 180) / Math.PI;
  return (deg + 360) % 360;
};
const insideReach = (point: Point, radii: readonly number[] | null) =>
  Math.hypot(point.x, point.y) <= reachInDirection(radii, directionOf(point)) + 1e-9;

describe("carryDirections", () => {
  it("puts the pick and place directions the carry angle apart", () => {
    for (const carry of CARRY_DIRECTIONS) {
      for (const angle of [45, 90, 180]) {
        const { pickDeg, placeDeg } = carryDirections(carry, angle);
        // The smaller angle between the two directions.
        const apart = Math.abs(((placeDeg - pickDeg + 540) % 360) - 180);
        expect(apart).toBeCloseTo(angle);
      }
    }
  });

  it("carries outward, inward, up and down", () => {
    const step = (carry: CarryDirection) => {
      const { pickDeg, placeDeg } = carryDirections(carry, 90);
      const at = (deg: number) => ({
        x: Math.cos((deg * Math.PI) / 180),
        y: Math.sin((deg * Math.PI) / 180),
      });
      return { dx: at(placeDeg).x - at(pickDeg).x, dy: at(placeDeg).y - at(pickDeg).y };
    };
    expect(step("outward").dx).toBeGreaterThan(1);
    expect(step("inward").dx).toBeLessThan(-1);
    expect(step("up").dy).toBeGreaterThan(1);
    expect(step("down").dy).toBeLessThan(-1);
    expect(carryDirections("outward", 90)).toEqual({ pickDeg: 135, placeDeg: 45 });
    expect(carryDirections("down", 90)).toEqual({ pickDeg: 45, placeDeg: 315 });
  });
});

describe("placePickPlace", () => {
  it.each<Side>(["left", "right"])(
    "keeps the object and the box inside the calibrated reach and on screen (%s side)",
    (side) => {
      const { play, bounds } = area(side);
      for (const carry of CARRY_DIRECTIONS) {
        for (const carryAngleDeg of [45, 90, 135, 180]) {
          for (const frac of [0.4, 0.7, 1.0]) {
            const placement = placePickPlace(
              input(side, {
                carry,
                carryAngleDeg,
                pickDistanceFrac: frac,
                placeDistanceFrac: frac,
              }),
            );
            expect(insideReach(placement.pick, RADII)).toBe(true);
            expect(insideReach(placement.place, RADII)).toBe(true);
            const object = play.toScreen(placement.pick);
            const radius = 0.35 * play.pixelsPerSw;
            expect(object.x - radius).toBeGreaterThanOrEqual(bounds.left - 1e-6);
            expect(object.x + radius).toBeLessThanOrEqual(bounds.width - bounds.right + 1e-6);
            expect(object.y - radius).toBeGreaterThanOrEqual(bounds.top - 1e-6);
            expect(object.y + radius).toBeLessThanOrEqual(bounds.height - bounds.bottom + 1e-6);
          }
        }
      }
    },
  );

  it("places each at its share of the reach in its own direction", () => {
    const placement = placePickPlace(input("right"));
    expect(placement.adjusted).toBe(false);
    expect(Math.hypot(placement.pick.x, placement.pick.y)).toBeCloseTo(
      0.6 * reachInDirection(RADII, 135),
    );
    expect(Math.hypot(placement.place.x, placement.place.y)).toBeCloseTo(
      0.7 * reachInDirection(RADII, 45),
    );
    expect(directionOf(placement.pick)).toBeCloseTo(135);
    expect(directionOf(placement.place)).toBeCloseTo(45);
  });

  it("is the same in the body frame for either side", () => {
    expect(placePickPlace(input("left")).pick).toEqual(placePickPlace(input("right")).pick);
  });

  it("moves them apart when the object would touch the box, staying in reach", () => {
    const placement = placePickPlace(
      input("right", {
        carry: "up",
        carryAngleDeg: 45,
        pickDistanceFrac: 0.6,
        placeDistanceFrac: 0.4,
      }),
    );
    expect(placement.adjusted).toBe(true);
    expect(placement.placeFrac).toBeGreaterThan(0.4);
    const gap = Math.hypot(
      placement.place.x - placement.pick.x,
      placement.place.y - placement.pick.y,
    );
    expect(gap).toBeGreaterThanOrEqual(0.35 + 0.35 + PLACE_GAP_SW - 1e-9);
    expect(insideReach(placement.pick, RADII)).toBe(true);
    expect(insideReach(placement.place, RADII)).toBe(true);
  });

  it("stops at the edge of the reach for the box and 0.3 of it for the object", () => {
    const placement = placePickPlace(
      input("right", {
        carryAngleDeg: 45,
        pickDistanceFrac: 0.4,
        placeDistanceFrac: 0.4,
        objectRadiusSw: 0.5,
        boxSizeSw: 0.9,
      }),
    );
    expect(placement.placeFrac).toBe(1);
    expect(placement.pickFrac).toBeCloseTo(0.3);
    expect(insideReach(placement.place, RADII)).toBe(true);
  });

  it("uses the default reach without a calibration", () => {
    const placement = placePickPlace(input("right", { reachRadiiSw: null }));
    expect(Math.hypot(placement.pick.x, placement.pick.y)).toBeCloseTo(0.6 * 1.2);
  });
});

describe("insideBox", () => {
  it("is true within half the box's width of its centre, on both axes", () => {
    const centre = { x: 1, y: 0.5 };
    expect(insideBox({ x: 1.3, y: 0.2 }, centre, 0.7)).toBe(true);
    expect(insideBox({ x: 1.36, y: 0.5 }, centre, 0.7)).toBe(false);
    expect(insideBox({ x: 1, y: 0.9 }, centre, 0.7)).toBe(false);
  });
});
