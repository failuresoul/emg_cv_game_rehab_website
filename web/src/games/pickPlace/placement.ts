import {
  keepOnScreen,
  reachInDirection,
  type ScreenBounds,
  type Transform,
} from "@/games/shared/targetPlacement";
import type { Point } from "@/vision/geometry";

import type { CarryDirection } from "./params";

/** Space kept between the object's edge and the box's edge, in SW, so they never overlap. */
export const PLACE_GAP_SW = 0.1;
/** The box may be moved out to the edge of the reach; the object in to this share of it. */
const MIN_PICK_FRAC = 0.3;
const MAX_PLACE_FRAC = 1.0;
const FRAC_STEP = 0.02;

/**
 * The pick and place directions from the shoulder, in degrees (0 outward, 90 up), `angleDeg`
 * apart on either side of a middle direction. Two points the same distance out on those
 * directions are joined by a line at right angles to the middle one, so:
 *
 * - outward and inward carries run across the top of the reach (the middle is straight up);
 * - up and down carries run beside the body (the middle is straight outward).
 */
export function carryDirections(
  carry: CarryDirection,
  angleDeg: number,
): { pickDeg: number; placeDeg: number } {
  const half = angleDeg / 2;
  const normalise = (deg: number) => ((deg % 360) + 360) % 360;
  const [pick, place] = {
    // Around straight up: 90 + half is towards the body, 90 − half away from it.
    outward: [90 + half, 90 - half],
    inward: [90 - half, 90 + half],
    // Around straight out: −half is below the shoulder, +half above it.
    up: [-half, half],
    down: [half, -half],
  }[carry];
  return { pickDeg: normalise(pick), placeDeg: normalise(place) };
}

export interface PickPlaceInput {
  carry: CarryDirection;
  carryAngleDeg: number;
  pickDistanceFrac: number;
  placeDistanceFrac: number;
  objectRadiusSw: number;
  boxSizeSw: number;
  /** The calibration's reach radii for 0, 45 … 315 degrees (RAW), or null for the default. */
  reachRadiiSw: readonly number[] | null;
  transform: Transform;
  bounds: ScreenBounds;
}

export interface PickPlacePlacement {
  /** The object's starting centre and the box's centre, in SW. */
  pick: Point;
  place: Point;
  pickDeg: number;
  placeDeg: number;
  /** The shares of the reach actually used: they differ from those asked when moved apart. */
  pickFrac: number;
  placeFrac: number;
  /** True when the object or the box was moved to keep them apart or on screen. */
  adjusted: boolean;
}

const along = (deg: number, distance: number): Point => {
  const radians = (deg * Math.PI) / 180;
  return { x: distance * Math.cos(radians), y: distance * Math.sin(radians) };
};

/**
 * Where the object and the box go: each `distanceFrac` of the calibrated reach in its own
 * direction, so both are inside the patient's own reach map, and each kept on screen. If they
 * would be too close (the object touching the box), the box moves out along its direction up to
 * the edge of the reach, then the object in along its own down to 0.3 of the reach, so both stay
 * inside it. A reach too small for both keeps them as far apart as those limits allow.
 */
export function placePickPlace(input: PickPlaceInput): PickPlacePlacement {
  const { pickDeg, placeDeg } = carryDirections(input.carry, input.carryAngleDeg);
  const pickReach = reachInDirection(input.reachRadiiSw, pickDeg);
  const placeReach = reachInDirection(input.reachRadiiSw, placeDeg);
  const minGap = input.objectRadiusSw + input.boxSizeSw / 2 + PLACE_GAP_SW;
  // Both are kept on screen first, so the gap is measured where they will really be drawn. The
  // box is drawn as a square, so its corners must fit too.
  const objectAt = (frac: number) =>
    keepOnScreen(
      along(pickDeg, frac * pickReach),
      input.objectRadiusSw,
      input.transform,
      input.bounds,
    );
  const boxAt = (frac: number) =>
    keepOnScreen(
      along(placeDeg, frac * placeReach),
      (input.boxSizeSw / 2) * Math.SQRT2,
      input.transform,
      input.bounds,
    );
  let pickFrac = input.pickDistanceFrac;
  let placeFrac = input.placeDistanceFrac;
  let object = objectAt(pickFrac);
  let box = boxAt(placeFrac);
  const gap = () =>
    Math.hypot(object.centreSw.x - box.centreSw.x, object.centreSw.y - box.centreSw.y);
  let adjusted = false;
  while (gap() < minGap && placeFrac < MAX_PLACE_FRAC) {
    placeFrac = Math.min(MAX_PLACE_FRAC, placeFrac + FRAC_STEP);
    box = boxAt(placeFrac);
    adjusted = true;
  }
  while (gap() < minGap && pickFrac > MIN_PICK_FRAC) {
    pickFrac = Math.max(MIN_PICK_FRAC, pickFrac - FRAC_STEP);
    object = objectAt(pickFrac);
    adjusted = true;
  }

  return {
    pick: object.centreSw,
    place: box.centreSw,
    pickDeg,
    placeDeg,
    pickFrac,
    placeFrac,
    adjusted: adjusted || object.clamped || box.clamped,
  };
}

/** Whether a point is inside the box: a square `sizeSw` wide centred on `centre`. */
export function insideBox(point: Point, centre: Point, sizeSw: number): boolean {
  const half = sizeSw / 2;
  return Math.abs(point.x - centre.x) <= half && Math.abs(point.y - centre.y) <= half;
}
