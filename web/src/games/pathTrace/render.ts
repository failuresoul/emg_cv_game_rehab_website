import type { Point } from "@/vision/geometry";

/** A calm, dark sage background: easy on the eyes, with the light corridor and teal trail clear. */
const BACKGROUND_TOP = "#1C3A36";
const BACKGROUND_BOTTOM = "#27493F";
const CORRIDOR = "rgba(255, 255, 255, 0.12)";
const CENTRE_LINE = "rgba(255, 255, 255, 0.35)";
const FILLED = "#5FC4B8";
export const TRAIL_INSIDE = "#5FC4B8";
export const TRAIL_OUTSIDE = "#F2A93B";
const START_RING = "#FFFFFF";
const HOLD_RING = "#F2C94C";
const LADYBIRD_RED = "#E0554A";
const LADYBIRD_DARK = "#2B2B2B";
const STAR = "#F2C94C";
const STAR_EMPTY = "rgba(255, 255, 255, 0.25)";

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

function strokePath(context: CanvasRenderingContext2D, points: readonly Point[]) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
  context.stroke();
}

/** The soft corridor, its faint centre line, and the stretches already followed, filled in. */
export function drawCorridor(
  context: CanvasRenderingContext2D,
  path: readonly Point[],
  corridorWidthPx: number,
  filled: ReadonlySet<number>,
) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = CORRIDOR;
  context.lineWidth = corridorWidthPx;
  strokePath(context, path);

  context.strokeStyle = FILLED;
  context.lineWidth = Math.max(6, corridorWidthPx * 0.3);
  for (const stretch of filled) {
    const from = path[stretch];
    const to = path[stretch + 1];
    if (from && to) strokePath(context, [from, to]);
  }

  context.strokeStyle = CENTRE_LINE;
  context.lineWidth = 2;
  context.setLineDash([8, 10]);
  strokePath(context, path);
  context.restore();
}

export interface TrailDot {
  at: Point;
  inside: boolean;
  ms: number;
}

/** The fingertip's recent trail: teal inside the corridor, amber outside, fading with age. */
export function drawTrail(
  context: CanvasRenderingContext2D,
  trail: readonly TrailDot[],
  nowMs: number,
  lifeMs: number,
  radiusPx: number,
) {
  context.save();
  for (const dot of trail) {
    const age = (nowMs - dot.ms) / lifeMs;
    if (age >= 1) continue;
    context.globalAlpha = 0.8 * (1 - age);
    context.fillStyle = dot.inside ? TRAIL_INSIDE : TRAIL_OUTSIDE;
    context.beginPath();
    context.arc(dot.at.x, dot.at.y, radiusPx, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

/** The start circle, with a ring that fills while the fingertip holds still inside it. */
export function drawStart(
  context: CanvasRenderingContext2D,
  centre: Point,
  radiusPx: number,
  holdProgress: number,
) {
  context.save();
  context.strokeStyle = START_RING;
  context.lineWidth = 4;
  context.setLineDash([10, 8]);
  context.beginPath();
  context.arc(centre.x, centre.y, radiusPx, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  if (holdProgress > 0) {
    context.strokeStyle = HOLD_RING;
    context.lineWidth = 8;
    context.lineCap = "round";
    context.beginPath();
    context.arc(
      centre.x,
      centre.y,
      radiusPx + 8,
      -Math.PI / 2,
      -Math.PI / 2 + holdProgress * 2 * Math.PI,
    );
    context.stroke();
  }
  context.restore();
}

/**
 * A friendly ladybird, facing the way it walks: a red round body with a centre line and spots,
 * a dark head, and two short feelers.
 */
export function drawLadybird(
  context: CanvasRenderingContext2D,
  centre: Point,
  sizePx: number,
  headingRad: number,
) {
  context.save();
  context.translate(centre.x, centre.y);
  context.rotate(headingRad);
  const r = sizePx / 2;
  context.fillStyle = LADYBIRD_DARK;
  context.beginPath();
  context.arc(r * 0.85, 0, r * 0.45, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = LADYBIRD_DARK;
  context.lineWidth = Math.max(1.5, r * 0.08);
  context.lineCap = "round";
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(r * 1.1, side * r * 0.2);
    context.lineTo(r * 1.5, side * r * 0.5);
    context.stroke();
  }
  context.fillStyle = LADYBIRD_RED;
  context.beginPath();
  context.ellipse(0, 0, r, r * 0.85, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = LADYBIRD_DARK;
  context.lineWidth = Math.max(1.5, r * 0.07);
  context.beginPath();
  context.moveTo(r * 0.6, 0);
  context.lineTo(-r, 0);
  context.stroke();
  context.fillStyle = LADYBIRD_DARK;
  for (const [x, y] of [
    [0.25, 0.4],
    [0.25, -0.4],
    [-0.35, 0.45],
    [-0.35, -0.45],
  ]) {
    context.beginPath();
    context.arc(x * r, y * r, r * 0.16, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function starPath(context: CanvasRenderingContext2D, centre: Point, radius: number) {
  context.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = centre.x + Math.cos(angle) * r;
    const y = centre.y + Math.sin(angle) * r;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

/** Three stars in a row, `lit` of them gold. They fade in gently over `progress`, never flash. */
export function drawStars(
  context: CanvasRenderingContext2D,
  centre: Point,
  sizePx: number,
  lit: number,
  progress: number,
) {
  context.save();
  context.globalAlpha = Math.min(1, progress * 3);
  for (let i = 0; i < 3; i++) {
    starPath(context, { x: centre.x + (i - 1) * sizePx * 1.3, y: centre.y }, sizePx / 2);
    context.fillStyle = i < lit ? STAR : STAR_EMPTY;
    context.fill();
  }
  context.restore();
}
