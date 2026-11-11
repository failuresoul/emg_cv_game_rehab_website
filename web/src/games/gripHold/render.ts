import { arc, TRACK_COLOR } from "@/games/shared/drawing";
import type { Point } from "@/vision/geometry";

/** A calm, soft evening sky over a meadow, dark enough for the white top bar to stay clear. */
const SKY_TOP = "#24536B";
const SKY_BOTTOM = "#4A7F8C";
const MEADOW = "#3F6B45";
const CLOUD = "rgba(255, 255, 255, 0.10)";
const BAND = "rgba(110, 200, 120, 0.28)";
const BAND_EDGE = "rgba(150, 230, 150, 0.85)";
const BAND_ACTIVE = "rgba(110, 200, 120, 0.42)";
const RELAX_LINE = "rgba(255, 255, 255, 0.6)";
const KITE = "#D9682B";
const KITE_LIGHT = "#F2A65A";
const KITE_SPAR = "rgba(80, 40, 15, 0.7)";
const KITE_GLOW = "rgba(247, 215, 116, 0.45)";
const STRING = "rgba(255, 255, 255, 0.55)";
const TAIL_BOWS = ["#F7D774", "#5FC4B8", "#F7D774", "#5FC4B8"];
const HOLD_RING = "#F7D774";

/** Where the meadow begins, as a share of the screen height. */
export const MEADOW_TOP_SHARE = 0.84;
/** The highest level is drawn this far below the top of the screen, clear of the top bar. */
const SKY_TOP_PX = 130;

/** The screen height, in pixels, that a level from 0 (meadow) to 1 (top of the sky) is drawn at. */
export function levelToY(level: number, height: number): number {
  const bottom = height * MEADOW_TOP_SHARE - 40;
  const top = Math.min(SKY_TOP_PX, bottom - 100);
  const clamped = Math.min(1, Math.max(0, level));
  return bottom - clamped * (bottom - top);
}

let skyCache: {
  context: CanvasRenderingContext2D;
  height: number;
  gradient: CanvasGradient;
} | null = null;

export function drawSky(context: CanvasRenderingContext2D, width: number, height: number) {
  if (skyCache?.context !== context || skyCache.height !== height) {
    const gradient = context.createLinearGradient(0, 0, 0, height * MEADOW_TOP_SHARE);
    gradient.addColorStop(0, SKY_TOP);
    gradient.addColorStop(1, SKY_BOTTOM);
    skyCache = { context, height, gradient };
  }
  context.fillStyle = skyCache.gradient;
  context.fillRect(0, 0, width, height);

  // A few still, faint clouds.
  context.fillStyle = CLOUD;
  for (const [x, y, size] of [
    [0.15, 0.3, 1],
    [0.78, 0.22, 1.3],
    [0.6, 0.55, 0.8],
  ] as const) {
    const r = Math.min(width, height) * 0.05 * size;
    context.beginPath();
    context.ellipse(width * x, height * y, r * 2, r, 0, 0, Math.PI * 2);
    context.ellipse(width * x + r, height * y - r * 0.5, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = MEADOW;
  context.fillRect(0, height * MEADOW_TOP_SHARE, width, height * (1 - MEADOW_TOP_SHARE));
}

/** The green band across the sky, a little brighter while the kite is inside it. */
export function drawBand(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  low: number,
  high: number,
  active: boolean,
) {
  const top = levelToY(high, height);
  const bottom = levelToY(low, height);
  context.save();
  context.fillStyle = active ? BAND_ACTIVE : BAND;
  context.fillRect(0, top, width, bottom - top);
  context.strokeStyle = BAND_EDGE;
  context.lineWidth = 3;
  for (const y of [top, bottom]) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

/** A dashed line the kite must come down below when relaxing. */
export function drawRelaxLine(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: number,
) {
  const y = levelToY(level, height);
  context.save();
  context.strokeStyle = RELAX_LINE;
  context.lineWidth = 3;
  context.setLineDash([14, 12]);
  context.beginPath();
  context.moveTo(0, y);
  context.lineTo(width, y);
  context.stroke();
  context.restore();
}

export interface KiteView {
  centre: Point;
  /** The kite's height, in pixels. */
  size: number;
  /** Where its string is held, on the meadow. */
  anchor: Point;
  /** A soft glow, for a finished hold. From 0 to 1. */
  glow: number;
  alpha?: number;
}

/** A diamond kite with a cross spar, a bowed tail and a string down to the meadow. */
export function drawKite(context: CanvasRenderingContext2D, view: KiteView) {
  const { centre, size, anchor, glow, alpha = 1 } = view;
  const half = size / 2;
  const top = { x: centre.x, y: centre.y - half };
  const bottom = { x: centre.x, y: centre.y + half };
  const left = { x: centre.x - half * 0.7, y: centre.y - half * 0.2 };
  const right = { x: centre.x + half * 0.7, y: centre.y - half * 0.2 };
  context.save();
  context.globalAlpha = alpha;

  context.strokeStyle = STRING;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(bottom.x, bottom.y);
  context.quadraticCurveTo(
    (bottom.x + anchor.x) / 2 + size * 0.4,
    (bottom.y + anchor.y) / 2,
    anchor.x,
    anchor.y,
  );
  context.stroke();

  if (glow > 0) {
    context.fillStyle = KITE_GLOW;
    context.globalAlpha = alpha * glow;
    context.beginPath();
    context.arc(centre.x, centre.y, size * 0.85, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = alpha;
  }

  context.fillStyle = KITE;
  context.beginPath();
  context.moveTo(top.x, top.y);
  context.lineTo(right.x, right.y);
  context.lineTo(bottom.x, bottom.y);
  context.lineTo(left.x, left.y);
  context.closePath();
  context.fill();
  context.fillStyle = KITE_LIGHT;
  context.beginPath();
  context.moveTo(top.x, top.y);
  context.lineTo(right.x, right.y);
  context.lineTo(centre.x, centre.y - half * 0.2);
  context.closePath();
  context.fill();
  context.strokeStyle = KITE_SPAR;
  context.lineWidth = Math.max(2, size * 0.03);
  context.beginPath();
  context.moveTo(top.x, top.y);
  context.lineTo(bottom.x, bottom.y);
  context.moveTo(left.x, left.y);
  context.lineTo(right.x, right.y);
  context.stroke();

  // The tail hangs below the kite with small bows.
  context.strokeStyle = STRING;
  context.beginPath();
  context.moveTo(bottom.x, bottom.y);
  const step = size * 0.22;
  for (let i = 1; i <= TAIL_BOWS.length; i++) {
    context.lineTo(bottom.x + (i % 2 === 0 ? step * 0.3 : -step * 0.3), bottom.y + i * step);
  }
  context.stroke();
  TAIL_BOWS.forEach((colour, index) => {
    const i = index + 1;
    const x = bottom.x + (i % 2 === 0 ? step * 0.3 : -step * 0.3);
    const y = bottom.y + i * step;
    const bow = size * 0.07;
    context.fillStyle = colour;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - bow, y - bow * 0.7);
    context.lineTo(x - bow, y + bow * 0.7);
    context.closePath();
    context.moveTo(x, y);
    context.lineTo(x + bow, y - bow * 0.7);
    context.lineTo(x + bow, y + bow * 0.7);
    context.closePath();
    context.fill();
  });
  context.restore();
}

/** The hold timer: a ring that fills clockwise, and stands still while the kite is outside. */
export function drawHoldRing(
  context: CanvasRenderingContext2D,
  centre: Point,
  radius: number,
  progress: number,
) {
  const width = Math.max(6, radius * 0.16);
  arc(context, centre, radius, 1, TRACK_COLOR, width);
  if (progress > 0) arc(context, centre, radius, Math.min(1, progress), HOLD_RING, width);
}
