import type { Point } from "@/vision/geometry";

/**
 * A calm dusk-blue sky: dark enough that the white top bar, the faint skeleton and the orange
 * cursor all stay easy to see.
 */
const SKY_TOP = "#24546F";
const SKY_BOTTOM = "#4F88A3";
const CLOUD_COLOR = "rgba(255, 255, 255, 0.16)";
const STRING_COLOR = "rgba(255, 255, 255, 0.75)";
const OUTLINE_COLOR = "rgba(255, 255, 255, 0.85)";
const SHINE_COLOR = "rgba(255, 255, 255, 0.35)";

/** Soft balloon colours, used in turn. */
export const BALLOON_COLOURS = ["#E89A9A", "#F2C94C", "#8FD3C8", "#B9A6E0", "#F4B183"] as const;

/** Clouds drift this many screen widths a minute: barely moving. */
const CLOUD_DRIFT_PER_MIN = 0.05;
const POP_PIECES = 10;

export interface Cloud {
  /** As shares of the screen width and height. */
  x: number;
  y: number;
  size: number;
}

/** Fixed clouds, so the sky looks the same every game. */
export const CLOUDS: readonly Cloud[] = [
  { x: 0.12, y: 0.22, size: 0.09 },
  { x: 0.48, y: 0.14, size: 0.07 },
  { x: 0.8, y: 0.3, size: 0.1 },
  { x: 0.3, y: 0.62, size: 0.06 },
  { x: 0.7, y: 0.7, size: 0.08 },
];

function drawCloud(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  context.beginPath();
  context.arc(x, y, size, 0, Math.PI * 2);
  context.arc(x + size * 0.9, y + size * 0.15, size * 0.75, 0, Math.PI * 2);
  context.arc(x - size * 0.9, y + size * 0.2, size * 0.65, 0, Math.PI * 2);
  context.fill();
}

/** The sky's gradient only changes with the screen height, so it is kept between frames. */
let skyCache: {
  context: CanvasRenderingContext2D;
  height: number;
  gradient: CanvasGradient;
} | null = null;

function skyGradient(context: CanvasRenderingContext2D, height: number): CanvasGradient {
  if (skyCache?.context === context && skyCache.height === height) return skyCache.gradient;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, SKY_TOP);
  gradient.addColorStop(1, SKY_BOTTOM);
  skyCache = { context, height, gradient };
  return gradient;
}

export function drawSky(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  nowMs: number,
) {
  context.fillStyle = skyGradient(context, height);
  context.fillRect(0, 0, width, height);

  context.fillStyle = CLOUD_COLOR;
  const drift = ((nowMs / 60000) * CLOUD_DRIFT_PER_MIN) % 1;
  for (const cloud of CLOUDS) {
    const share = (cloud.x + drift) % 1.2;
    drawCloud(context, (share - 0.1) * width, cloud.y * height, cloud.size * width);
  }
}

export interface BalloonView {
  centre: Point;
  radius: number;
  colour: string;
}

/** A balloon, a little taller than wide, with a knot and a gently curving string. */
export function drawBalloon(
  context: CanvasRenderingContext2D,
  { centre, radius, colour }: BalloonView,
) {
  const { x, y } = centre;
  const bottom = y + radius * 1.1;

  context.strokeStyle = STRING_COLOR;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, bottom + radius * 0.12);
  context.bezierCurveTo(
    x - radius * 0.25,
    bottom + radius * 0.6,
    x + radius * 0.25,
    bottom + radius * 0.9,
    x,
    bottom + radius * 1.4,
  );
  context.stroke();

  context.fillStyle = colour;
  context.beginPath();
  context.moveTo(x - radius * 0.12, bottom + radius * 0.14);
  context.lineTo(x + radius * 0.12, bottom + radius * 0.14);
  context.lineTo(x, bottom - radius * 0.02);
  context.closePath();
  context.fill();

  context.beginPath();
  context.ellipse(x, y, radius * 0.92, radius * 1.1, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = OUTLINE_COLOR;
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = SHINE_COLOR;
  context.beginPath();
  context.ellipse(
    x - radius * 0.35,
    y - radius * 0.45,
    radius * 0.16,
    radius * 0.28,
    -0.5,
    0,
    Math.PI * 2,
  );
  context.fill();
}

/** Pieces drifting outward and fading. Returns false once it has finished. */
export function drawPop(
  context: CanvasRenderingContext2D,
  centre: Point,
  radius: number,
  colour: string,
  ageMs: number,
  durationMs: number,
): boolean {
  if (ageMs >= durationMs) return false;
  const progress = ageMs / durationMs;
  const distance = radius * (0.6 + 0.9 * (1 - (1 - progress) ** 2));
  context.save();
  context.globalAlpha = 1 - progress;
  context.fillStyle = colour;
  for (let piece = 0; piece < POP_PIECES; piece++) {
    const angle = (piece / POP_PIECES) * 2 * Math.PI;
    context.beginPath();
    context.arc(
      centre.x + distance * Math.cos(angle),
      centre.y + distance * Math.sin(angle) + progress * radius * 0.4,
      Math.max(4, radius * 0.1),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.restore();
  return true;
}
