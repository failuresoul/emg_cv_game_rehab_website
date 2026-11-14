import type { Coat } from "./stripeMachine";
import { CANVAS_FONT_FAMILY } from "@/lib/canvasFont";

/** A dark room around a light, warm wall; the paint and the dark text both stand out on it. */
const ROOM = "#1E2E33";
const WALL = "#DCD5C6";
const WALL_LINE = "rgba(60, 50, 40, 0.08)";
const OUTLINE = "rgba(31, 42, 46, 0.55)";
const TARGET_LINE = "#D9682B";
const INK = "#1F2A2E";
const HANDLE = "#8A5A35";
const FERRULE = "#9AA5AB";

/** Each stripe's colour, in turn across the wall: together they make the mural. */
export const STRIPE_COLOURS = [
  "#E07A5F",
  "#F2CC8F",
  "#81B29A",
  "#6C9BD2",
  "#B98BC9",
  "#F4A261",
  "#5FB3A8",
  "#E5989B",
] as const;

/** How strong one full coat is; three coats make a rich colour. */
const COAT_ALPHA = 0.36;
const TOP_PX = 120;
const BOTTOM_PX = 70;
const SIDE_SHARE = 0.06;
const COUNTER_FONT_PX = 30;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The wall, below the top bar and away from the screen's edges. */
export function wallRect(width: number, height: number): Rect {
  const side = width * SIDE_SHARE;
  return {
    x: side,
    y: TOP_PX,
    width: width - 2 * side,
    height: Math.max(100, height - TOP_PX - BOTTOM_PX),
  };
}

/** Stripe `index` of `count`, side by side across the wall, with a small gap between them. */
export function stripeRect(wall: Rect, index: number, count: number): Rect {
  const slot = wall.width / Math.max(1, count);
  const gap = slot * 0.12;
  return { x: wall.x + index * slot + gap / 2, y: wall.y, width: slot - gap, height: wall.height };
}

/** The y of a height on the wall: 0 at the bottom, 1 at the top. */
export const heightY = (rect: Rect, height: number) =>
  rect.y + rect.height * (1 - Math.min(1, Math.max(0, height)));

export function drawRoomAndWall(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = ROOM;
  context.fillRect(0, 0, width, height);
  const wall = wallRect(width, height);
  context.fillStyle = WALL;
  context.fillRect(wall.x, wall.y, wall.width, wall.height);
  context.strokeStyle = WALL_LINE;
  context.lineWidth = 2;
  for (let y = wall.y + 40; y < wall.y + wall.height; y += 40) {
    context.beginPath();
    context.moveTo(wall.x, y);
    context.lineTo(wall.x + wall.width, y);
    context.stroke();
  }
}

/** A stripe's coats: each a layer of colour from the bottom up to its height. */
export function drawCoats(
  context: CanvasRenderingContext2D,
  rect: Rect,
  coats: readonly Coat[],
  colour: string,
) {
  context.save();
  context.fillStyle = colour;
  for (const coat of coats) {
    context.globalAlpha = COAT_ALPHA * coat.strength;
    const top = heightY(rect, coat.height);
    context.fillRect(rect.x, top, rect.width, rect.y + rect.height - top);
  }
  context.restore();
}

/** The stripe being painted: dashed outline up to the target, and the target line itself. */
export function drawTarget(context: CanvasRenderingContext2D, rect: Rect, targetHeight: number) {
  const top = heightY(rect, targetHeight);
  context.save();
  context.strokeStyle = OUTLINE;
  context.lineWidth = 3;
  context.setLineDash([10, 8]);
  context.strokeRect(rect.x, top, rect.width, rect.y + rect.height - top);
  context.setLineDash([]);
  context.strokeStyle = TARGET_LINE;
  context.lineWidth = 5;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(rect.x - 6, top);
  context.lineTo(rect.x + rect.width + 6, top);
  context.stroke();
  context.restore();
}

/** A paint brush lying across the stripe at `y`, its bristles dipped in the stripe's colour. */
export function drawBrush(
  context: CanvasRenderingContext2D,
  centreX: number,
  y: number,
  size: number,
  colour: string,
) {
  context.save();
  context.translate(centreX, y);
  context.fillStyle = colour;
  context.strokeStyle = INK;
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(-size * 0.5, -size * 0.18, size * 0.4, size * 0.36, size * 0.08);
  context.fill();
  context.stroke();
  context.fillStyle = FERRULE;
  context.fillRect(-size * 0.1, -size * 0.14, size * 0.18, size * 0.28);
  context.fillStyle = HANDLE;
  context.beginPath();
  context.roundRect(size * 0.08, -size * 0.08, size * 0.55, size * 0.16, size * 0.08);
  context.fill();
  context.restore();
}

/** Text such as "2 / 3", centred above the stripe, in dark ink on the wall. */
export function drawCounter(context: CanvasRenderingContext2D, rect: Rect, text: string) {
  context.save();
  context.font = `bold ${COUNTER_FONT_PX}px ${CANVAS_FONT_FAMILY}`;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillStyle = INK;
  context.fillText(text, rect.x + rect.width / 2, rect.y + 10);
  context.restore();
}
