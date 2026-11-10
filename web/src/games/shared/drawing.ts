import type { Point } from "@/vision/geometry";

/** Canvas pieces shared by games: progress rings, level meters and the hand icons. */

export const TRACK_COLOR = "rgba(255, 255, 255, 0.2)";
const LEVEL_COLOR = "#D9682B";
const LEVEL_REACHED_COLOR = "#F2C94C";
const DEMAND_COLOR = "#FFFFFF";
const ICON_COLOR = "#FFFFFF";

/** The ring starts at the top and fills clockwise. */
const TOP = -Math.PI / 2;

/**
 * Lucide's "hand-grab" icon (ISC licence, lucide.dev), drawn on a 24 x 24 grid. Built lazily:
 * Path2D does not exist outside the browser.
 */
const HAND_GRAB_PATHS = [
  "M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4",
  "M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2",
  "M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5",
  "M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2",
  "M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0",
];
let handGrab: Path2D[] | null = null;
/** Lucide's "hand" icon (ISC licence, lucide.dev): an open hand, on the same grid. */
const HAND_OPEN_PATHS = [
  "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2",
  "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2",
  "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8",
  "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
];
let handOpen: Path2D[] | null = null;

export function arc(
  context: CanvasRenderingContext2D,
  centre: Point,
  radius: number,
  share: number,
  color: string,
  width: number,
) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.beginPath();
  context.arc(centre.x, centre.y, radius, TOP, TOP + share * 2 * Math.PI);
  context.stroke();
}

/**
 * The squeeze level as a ring that fills clockwise from the top, with a white tick at the level
 * to reach. It turns yellow once the level is reached.
 */
export function drawActivationRing(
  context: CanvasRenderingContext2D,
  centre: Point,
  ringRadius: number,
  ringWidth: number,
  level: number,
  demand: number,
) {
  arc(context, centre, ringRadius, 1, TRACK_COLOR, ringWidth);
  if (level > 0) {
    arc(
      context,
      centre,
      ringRadius,
      Math.min(1, level),
      level >= demand ? LEVEL_REACHED_COLOR : LEVEL_COLOR,
      ringWidth,
    );
  }
  const angle = TOP + demand * 2 * Math.PI;
  const inner = ringRadius - ringWidth;
  const outer = ringRadius + ringWidth;
  context.strokeStyle = DEMAND_COLOR;
  context.lineWidth = 4;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(centre.x + inner * Math.cos(angle), centre.y + inner * Math.sin(angle));
  context.lineTo(centre.x + outer * Math.cos(angle), centre.y + outer * Math.sin(angle));
  context.stroke();
}

export function drawHandGrab(context: CanvasRenderingContext2D, centre: Point, size: number) {
  handGrab ??= HAND_GRAB_PATHS.map((path) => new Path2D(path));
  strokeIcon(context, handGrab, centre, size);
}

export function drawHandOpen(context: CanvasRenderingContext2D, centre: Point, size: number) {
  handOpen ??= HAND_OPEN_PATHS.map((path) => new Path2D(path));
  strokeIcon(context, handOpen, centre, size);
}

export interface LevelBarView {
  /** The bar's top-left corner and size, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** From 0 to 1. */
  level: number;
  /** The level to reach, drawn as a white line. */
  demand: number;
}

/**
 * A vertical bar that fills from the bottom, with a white line at the level to reach. It turns
 * yellow once the level is reached. No animation of its own, so it never flashes.
 */
export function drawLevelBar(
  context: CanvasRenderingContext2D,
  { x, y, width, height, level, demand }: LevelBarView,
) {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const radius = width / 2;
  context.save();
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = TRACK_COLOR;
  context.fill();
  context.clip();
  const filled = clamp(level) * height;
  context.fillStyle = level >= demand ? LEVEL_REACHED_COLOR : LEVEL_COLOR;
  context.fillRect(x, y + height - filled, width, filled);
  context.restore();

  const lineY = y + height - clamp(demand) * height;
  context.strokeStyle = DEMAND_COLOR;
  context.lineWidth = 4;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x - width * 0.35, lineY);
  context.lineTo(x + width * 1.35, lineY);
  context.stroke();
}

function strokeIcon(
  context: CanvasRenderingContext2D,
  paths: readonly Path2D[],
  centre: Point,
  size: number,
) {
  const scale = size / 24;
  context.save();
  context.translate(centre.x - 12 * scale, centre.y - 12 * scale);
  context.scale(scale, scale);
  context.strokeStyle = ICON_COLOR;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  paths.forEach((path) => context.stroke(path));
  context.restore();
}
