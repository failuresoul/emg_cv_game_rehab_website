import { drawHandGrab, drawHandOpen } from "@/games/shared/drawing";
import { drawFruit, type FruitKind } from "@/games/fruitCatch/render";
import type { Point } from "@/vision/geometry";

/** A calm, warm-dark kitchen: the fruit and the light box stand out clearly against it. */
const BACKGROUND_TOP = "#2A3B3A";
const BACKGROUND_BOTTOM = "#33463F";
const SHELF = "#8A5A33";
const SHELF_EDGE = "#6B4325";
const SHELF_BRACKET = "#5A3820";
const BOX_FRONT = "#C98E55";
const BOX_SIDE = "#A8723F";
const BOX_INSIDE = "#5E3B1E";
const BOX_LID = "#D9A46A";
const BOX_READY = "#F2C94C";
const START_RING = "rgba(255, 255, 255, 0.35)";
const CURSOR_BACK = "rgba(15, 92, 92, 0.85)";
const CURSOR_HOLDING = "rgba(217, 104, 43, 0.9)";

/** The shelf along the bottom of the screen, in pixels. */
export const SHELF_HEIGHT_PX = 22;
export const SHELF_GAP_PX = 64;

let gradientCache: {
  context: CanvasRenderingContext2D;
  height: number;
  gradient: CanvasGradient;
} | null = null;

export function drawBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  if (gradientCache?.context !== context || gradientCache.height !== height) {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, BACKGROUND_TOP);
    gradient.addColorStop(1, BACKGROUND_BOTTOM);
    gradientCache = { context, height, gradient };
  }
  context.fillStyle = gradientCache.gradient;
  context.fillRect(0, 0, width, height);
}

/**
 * The shelf along the bottom, with every object placed so far sitting on it in a row from the
 * middle outwards. It grows fuller as the game goes on.
 */
export function drawShelf(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  collected: readonly FruitKind[],
) {
  const top = height - SHELF_GAP_PX;
  context.save();
  context.fillStyle = SHELF_BRACKET;
  for (const x of [width * 0.15, width * 0.85]) {
    context.fillRect(x - 6, top + SHELF_HEIGHT_PX, 12, 26);
  }
  context.fillStyle = SHELF;
  context.beginPath();
  context.roundRect(width * 0.08, top, width * 0.84, SHELF_HEIGHT_PX, 6);
  context.fill();
  context.fillStyle = SHELF_EDGE;
  context.fillRect(width * 0.08, top + SHELF_HEIGHT_PX - 6, width * 0.84, 6);

  const radius = 18;
  const spacing = radius * 2.4;
  collected.forEach((kind, index) => {
    // 0, +1, −1, +2, −2 …: the row fills from the middle.
    const step = Math.ceil(index / 2) * (index % 2 === 1 ? 1 : -1);
    drawFruit(context, kind, { x: width / 2 + step * spacing, y: top - radius }, radius);
  });
  context.restore();
}

/** A soft ring where the object starts, so a dropped object's way back is clear. */
export function drawStartSpot(context: CanvasRenderingContext2D, centre: Point, radius: number) {
  context.save();
  context.strokeStyle = START_RING;
  context.lineWidth = 3;
  context.setLineDash([8, 10]);
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

export interface BoxView {
  centre: Point;
  /** The box's width and height, in pixels. */
  size: number;
  /** From 0 (lid flaps open) to 1 (closed). */
  closed: number;
  /** True while the object is held over the box: its rim glows to say "let go here". */
  ready: boolean;
}

/**
 * An open cardboard box seen from the front: an opening at the top with two lid flaps folded
 * out, which swing shut as `closed` goes to 1. Moves only when told, so it never flashes.
 */
export function drawBox(
  context: CanvasRenderingContext2D,
  { centre, size, closed, ready }: BoxView,
) {
  const half = size / 2;
  const left = centre.x - half;
  const right = centre.x + half;
  const top = centre.y - half * 0.6;
  const bottom = centre.y + half;
  const depth = size * 0.22;
  context.save();

  // The opening, then the front.
  context.fillStyle = BOX_INSIDE;
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left + depth, top - depth * 0.6);
  context.lineTo(right - depth, top - depth * 0.6);
  context.lineTo(right, top);
  context.closePath();
  context.fill();
  context.fillStyle = BOX_FRONT;
  context.fillRect(left, top, size, bottom - top);
  context.fillStyle = BOX_SIDE;
  context.fillRect(left, top, size, Math.max(4, size * 0.05));

  // Each flap is hinged at a top corner: folded out at 0, lying over the opening at 1.
  const flap = half * 0.95;
  const ease = closed * closed * (3 - 2 * closed);
  for (const side of [-1, 1] as const) {
    const hinge = { x: side < 0 ? left : right, y: top };
    // Open: pointing up and out at 60° from the top edge. Closed: flat across the top.
    const angle = (1 - ease) * (Math.PI / 3);
    const tip = {
      x: hinge.x - side * flap * Math.cos(angle),
      y: hinge.y - flap * Math.sin(angle),
    };
    context.strokeStyle = BOX_LID;
    context.lineWidth = Math.max(6, size * 0.07);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(hinge.x, hinge.y);
    context.lineTo(tip.x, tip.y);
    context.stroke();
  }

  if (ready && closed === 0) {
    context.strokeStyle = BOX_READY;
    context.lineWidth = 5;
    context.strokeRect(left - 6, top - depth * 0.6 - 6, size + 12, bottom - top + depth * 0.6 + 12);
  }
  context.restore();
}

/** The object: one friendly fruit, a little larger while it is held. */
export function drawObject(
  context: CanvasRenderingContext2D,
  kind: FruitKind,
  centre: Point,
  radius: number,
  held: boolean,
) {
  if (held) {
    context.save();
    context.fillStyle = "rgba(0, 0, 0, 0.25)";
    context.beginPath();
    context.ellipse(
      centre.x,
      centre.y + radius * 1.1,
      radius * 0.8,
      radius * 0.25,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
  }
  drawFruit(context, kind, centre, held ? radius * 1.08 : radius);
}

/** The cursor: an open hand, or a closed one while pinching, on a round backing. */
export function drawHandCursor(
  context: CanvasRenderingContext2D,
  centre: Point,
  size: number,
  pinching: boolean,
) {
  context.save();
  context.fillStyle = pinching ? CURSOR_HOLDING : CURSOR_BACK;
  context.beginPath();
  context.arc(centre.x, centre.y, size * 0.62, 0, Math.PI * 2);
  context.fill();
  context.restore();
  if (pinching) drawHandGrab(context, centre, size * 0.8);
  else drawHandOpen(context, centre, size * 0.8);
}
