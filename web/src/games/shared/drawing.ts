import type { Point } from "@/vision/geometry";

/** Canvas pieces shared by games: progress rings, the squeeze meter and the hand icon. */

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
  const scale = size / 24;
  context.save();
  context.translate(centre.x - 12 * scale, centre.y - 12 * scale);
  context.scale(scale, scale);
  context.strokeStyle = ICON_COLOR;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  handGrab.forEach((path) => context.stroke(path));
  context.restore();
}
