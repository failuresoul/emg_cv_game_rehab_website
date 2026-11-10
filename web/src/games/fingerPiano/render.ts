import type { Finger } from "@/input/fingerTouch";
import type { Side } from "@/types/api";
import type { Point } from "@/vision/geometry";
import { HAND_KNUCKLES, OPEN_TIPS } from "@/warmup/exercises";

import { FALL_MS } from "./melodyMachine";

/** A calm night-blue room, dark enough for the white top bar and the coloured notes. */
const BACKGROUND = "#17263A";
const LANE_FILL = "rgba(255, 255, 255, 0.06)";
const HIT_LINE = "rgba(255, 255, 255, 0.85)";
const LABEL = "#FFFFFF";
const HAND_LINE = "rgba(255, 255, 255, 0.55)";
const PALM_FILL = "rgba(255, 255, 255, 0.1)";
const WRONG_RING = "rgba(255, 255, 255, 0.45)";
const LABEL_FONT_PX = 22;

/** Each finger keeps its colour everywhere: lane, note, preview and hand. */
export const FINGER_COLOURS: Record<Finger, string> = {
  index: "#8FD3C8",
  middle: "#F2C94C",
  ring: "#B9A6E0",
  little: "#F4A7B9",
};

export interface PianoLayout {
  /** Each active finger's lane centre, in canvas pixels. */
  laneX: Partial<Record<Finger, number>>;
  laneWidth: number;
  /** Where notes appear. */
  topY: number;
  hitY: number;
  /** The hand diagram's wrist, and pixels per palm length. */
  handWrist: Point;
  handScale: number;
  /** +1 draws the thumb on the left (right hand, seen from the back), −1 mirrors it. */
  handFlip: 1 | -1;
}

const TOP_MARGIN = 110;

/**
 * Lanes in the order the fingers sit on the hand, as the patient sees the back of it: index
 * nearest the thumb. The hand diagram is drawn on the thumb's side.
 */
export function pianoLayout(
  width: number,
  height: number,
  fingers: readonly Finger[],
  affectedSide: Side,
): PianoLayout {
  const flip: 1 | -1 = affectedSide === "right" ? 1 : -1;
  const laneWidth = Math.min(150, Math.max(70, width * 0.1));
  const gap = laneWidth * 0.15;
  const total = fingers.length * laneWidth + (fingers.length - 1) * gap;
  // The lanes sit a little away from the hand diagram's side.
  const centre = width / 2 + flip * width * 0.08;
  const left = centre - total / 2 + laneWidth / 2;
  const ordered = flip === 1 ? fingers : [...fingers].reverse();
  const laneX: Partial<Record<Finger, number>> = {};
  ordered.forEach((finger, index) => {
    laneX[finger] = left + index * (laneWidth + gap);
  });
  const handScale = Math.min(width, height) * 0.13;
  return {
    laneX,
    laneWidth,
    topY: TOP_MARGIN,
    hitY: height * 0.8,
    handWrist: {
      x: flip === 1 ? width * 0.16 : width * 0.84,
      y: height * 0.62,
    },
    handScale,
    handFlip: flip,
  };
}

/** Where a note is on its way down: at topY FALL_MS before it arrives, at hitY on arrival. */
export function noteY(layout: PianoLayout, arrivalMs: number, nowMs: number): number {
  const share = (arrivalMs - nowMs) / FALL_MS;
  return layout.hitY - share * (layout.hitY - layout.topY);
}

export function drawBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, width, height);
}

/** The lanes, the hit line with a ring for each lane, and each finger's name below. */
export function drawLanes(
  context: CanvasRenderingContext2D,
  layout: PianoLayout,
  height: number,
  labels: Partial<Record<Finger, string>>,
) {
  const { laneWidth, topY, hitY } = layout;
  context.font = `bold ${LABEL_FONT_PX}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const [finger, x] of Object.entries(layout.laneX) as [Finger, number][]) {
    context.fillStyle = LANE_FILL;
    context.beginPath();
    context.roundRect(x - laneWidth / 2, topY - 20, laneWidth, height - topY, 16);
    context.fill();

    context.strokeStyle = FINGER_COLOURS[finger];
    context.lineWidth = 4;
    context.beginPath();
    context.arc(x, hitY, laneWidth * 0.32, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = LABEL;
    context.fillText(labels[finger] ?? finger, x, hitY + laneWidth * 0.45);
  }
  const xs = Object.values(layout.laneX) as number[];
  context.strokeStyle = HIT_LINE;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(Math.min(...xs) - laneWidth / 2, hitY);
  context.lineTo(Math.max(...xs) + laneWidth / 2, hitY);
  context.stroke();
}

export function drawNote(
  context: CanvasRenderingContext2D,
  centre: Point,
  radius: number,
  finger: Finger,
  alpha = 1,
) {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = FINGER_COLOURS[finger];
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** A soft ring growing and fading where a note was played: coloured for a hit, grey otherwise. */
export function drawRing(
  context: CanvasRenderingContext2D,
  centre: Point,
  radius: number,
  colour: string | null,
  progress: number,
) {
  if (progress < 0 || progress >= 1) return;
  context.save();
  context.globalAlpha = 1 - progress;
  context.strokeStyle = colour ?? WRONG_RING;
  context.lineWidth = 6;
  context.beginPath();
  context.arc(centre.x, centre.y, radius * (1 + 0.5 * progress), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

/** The melody as a row of coloured notes across the top, the current one larger. */
export function drawPreview(
  context: CanvasRenderingContext2D,
  centreX: number,
  y: number,
  notes: readonly Finger[],
  current: number,
  size: number,
) {
  const gap = size * 2.6;
  const left = centreX - ((notes.length - 1) * gap) / 2;
  notes.forEach((finger, index) => {
    drawNote(context, { x: left + index * gap, y }, index === current ? size * 1.35 : size, finger);
  });
}

const FINGER_INDEX: Record<Finger, number> = { index: 1, middle: 2, ring: 3, little: 4 };

/**
 * A simple open hand, back towards the viewer: a palm, the thumb and four fingers. The finger to
 * use is drawn thick in its colour; the finger the thumb is touching now gets a dot at its tip.
 */
export function drawHand(
  context: CanvasRenderingContext2D,
  layout: PianoLayout,
  lit: Finger | null,
  touching: Finger | null,
) {
  const { handWrist, handScale, handFlip } = layout;
  // Hand coordinates: +y towards the fingers, +x towards the little finger.
  const at = (point: Point): Point => ({
    x: handWrist.x + handFlip * point.x * handScale,
    y: handWrist.y - point.y * handScale,
  });
  context.save();
  context.fillStyle = PALM_FILL;
  context.strokeStyle = HAND_LINE;
  context.lineWidth = 3;
  context.beginPath();
  context.ellipse(
    handWrist.x,
    handWrist.y - handScale * 0.5,
    handScale * 0.5,
    handScale * 0.55,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.stroke();

  context.lineCap = "round";
  OPEN_TIPS.forEach((tip, index) => {
    const finger = (Object.keys(FINGER_INDEX) as Finger[]).find(
      (name) => FINGER_INDEX[name] === index,
    );
    const isLit = finger !== undefined && finger === lit;
    context.strokeStyle = isLit && finger ? FINGER_COLOURS[finger] : HAND_LINE;
    context.lineWidth = isLit ? 14 : 8;
    const from = at(HAND_KNUCKLES[index]);
    const to = at(tip);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    if (finger && finger === touching) {
      context.fillStyle = FINGER_COLOURS[finger];
      context.beginPath();
      context.arc(to.x, to.y, 10, 0, Math.PI * 2);
      context.fill();
    }
  });
  context.restore();
}
