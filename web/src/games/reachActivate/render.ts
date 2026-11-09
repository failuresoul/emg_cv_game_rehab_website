import { arc, drawActivationRing, drawHandGrab, TRACK_COLOR } from "@/games/shared/drawing";
import type { Point } from "@/vision/geometry";

const GLOW_INNER = "rgba(126, 214, 205, 0.35)";
const GLOW_OUTER = "rgba(126, 214, 205, 0)";
const TARGET_FILL = "rgba(15, 92, 92, 0.85)";
const TARGET_EDGE = "rgba(232, 242, 241, 0.9)";
const DWELL_COLOR = "#F2C94C";
const TRAIL_RGB = "232, 242, 241";
const BURST_RGB = "242, 201, 76";

const BURST_MS = 800;
const BURST_DOTS = 12;

export interface TargetView {
  centre: Point;
  radius: number;
  /** From 0 to 1 while dwelling; 0 otherwise. */
  dwell: number;
  /** Set during ACTIVATE. */
  activation: { level: number; demand: number; holdProgress: number } | null;
}

/** A soft glowing target. No pulsing or flashing: it only changes as the patient acts. */
export function drawTarget(context: CanvasRenderingContext2D, view: TargetView) {
  const { centre, radius, dwell, activation } = view;
  const ringWidth = Math.max(8, radius * 0.12);

  const glow = context.createRadialGradient(
    centre.x,
    centre.y,
    radius * 0.8,
    centre.x,
    centre.y,
    radius * 1.7,
  );
  glow.addColorStop(0, GLOW_INNER);
  glow.addColorStop(1, GLOW_OUTER);
  context.fillStyle = glow;
  context.beginPath();
  context.arc(centre.x, centre.y, radius * 1.7, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = TARGET_FILL;
  context.strokeStyle = TARGET_EDGE;
  context.lineWidth = 4;
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  const ringRadius = radius + ringWidth;
  if (activation) {
    const { level, demand, holdProgress } = activation;
    // The hold fills the target from the middle as the squeeze is held.
    if (holdProgress > 0) {
      context.fillStyle = `rgba(242, 201, 76, ${0.35 * holdProgress})`;
      context.beginPath();
      context.arc(centre.x, centre.y, radius * holdProgress, 0, Math.PI * 2);
      context.fill();
    }
    drawHandGrab(context, centre, radius * 1.1);
    drawActivationRing(context, centre, ringRadius, ringWidth, level, demand);
  } else if (dwell > 0) {
    arc(context, centre, ringRadius, 1, TRACK_COLOR, ringWidth);
    arc(context, centre, ringRadius, dwell, DWELL_COLOR, ringWidth);
  }
}

export interface TrailPoint {
  at: Point;
  ageMs: number;
}

/** A faint line behind the cursor that fades with age. */
export function drawTrail(
  context: CanvasRenderingContext2D,
  points: readonly TrailPoint[],
  lifeMs: number,
  width: number,
) {
  context.lineCap = "round";
  context.lineWidth = width;
  for (let i = 1; i < points.length; i++) {
    const alpha = 0.3 * Math.max(0, 1 - points[i].ageMs / lifeMs);
    if (alpha <= 0) continue;
    context.strokeStyle = `rgba(${TRAIL_RGB}, ${alpha})`;
    context.beginPath();
    context.moveTo(points[i - 1].at.x, points[i - 1].at.y);
    context.lineTo(points[i].at.x, points[i].at.y);
    context.stroke();
  }
}

/** A gentle burst of dots drifting outward and fading. Returns false once it has finished. */
export function drawBurst(
  context: CanvasRenderingContext2D,
  centre: Point,
  radius: number,
  ageMs: number,
): boolean {
  if (ageMs >= BURST_MS) return false;
  const progress = ageMs / BURST_MS;
  const eased = 1 - (1 - progress) ** 2;
  const distance = radius * (1 + 0.8 * eased);
  context.fillStyle = `rgba(${BURST_RGB}, ${0.8 * (1 - progress)})`;
  for (let dot = 0; dot < BURST_DOTS; dot++) {
    const angle = (dot / BURST_DOTS) * 2 * Math.PI;
    context.beginPath();
    context.arc(
      centre.x + distance * Math.cos(angle),
      centre.y + distance * Math.sin(angle),
      Math.max(4, radius * 0.08),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  return true;
}
