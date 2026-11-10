import type { Point } from "@/vision/geometry";

/**
 * A calm evening garden: a deep teal sky over a soft green bed, dark enough that the white top
 * bar, the meter and the faint skeleton stay easy to see.
 */
const SKY_TOP = "#1F4A52";
const SKY_BOTTOM = "#386B66";
const GRASS = "#3F6B45";
const SOIL = "#4E3D30";
const STEM = "#6FA36A";
const LEAF = "#5C9159";
const FLOWER_CENTRE = "#F7D774";
const BUD_OUTLINE = "rgba(255, 255, 255, 0.55)";
const SPARKLE = "#FFF6C9";
const SEED = "#8A5A35";
const BASKET = "#C8955C";
const BASKET_DARK = "#9C6E3E";

const PETALS = 6;
const SPARKLES = 8;

/** Where the bed begins, as a share of the screen height. */
export const BED_TOP_SHARE = 0.74;

let skyCache: {
  context: CanvasRenderingContext2D;
  height: number;
  gradient: CanvasGradient;
} | null = null;

function skyGradient(context: CanvasRenderingContext2D, height: number): CanvasGradient {
  if (skyCache?.context === context && skyCache.height === height) return skyCache.gradient;
  const gradient = context.createLinearGradient(0, 0, 0, height * BED_TOP_SHARE);
  gradient.addColorStop(0, SKY_TOP);
  gradient.addColorStop(1, SKY_BOTTOM);
  skyCache = { context, height, gradient };
  return gradient;
}

/** The sky, a grassy bed and a strip of soil along the bottom. */
export function drawGardenBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const bedTop = height * BED_TOP_SHARE;
  context.fillStyle = skyGradient(context, height);
  context.fillRect(0, 0, width, bedTop);
  context.fillStyle = GRASS;
  context.beginPath();
  context.moveTo(0, bedTop);
  // A gentle rise in the middle, where the bud grows.
  context.quadraticCurveTo(width / 2, bedTop - height * 0.04, width, bedTop);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();
  context.fillStyle = SOIL;
  context.fillRect(0, height * 0.965, width, height * 0.035);
}

export interface FlowerView {
  /** Where the stem meets the ground. */
  base: Point;
  stemHeight: number;
  /** The open flower's radius. */
  radius: number;
  /** From 0 (a closed bud) to 1 (fully open). */
  openness: number;
  colour: string;
  /** From 0 to 1; a missed bud fades away. */
  alpha?: number;
  /** Bends the stem sideways, in pixels, for a bud that droops when missed. */
  droop?: number;
}

/** The centre of the flower's head. */
export function flowerHead({
  base,
  stemHeight,
  droop = 0,
}: Pick<FlowerView, "base" | "stemHeight" | "droop">): Point {
  return { x: base.x + droop, y: base.y - stemHeight + Math.abs(droop) * 0.3 };
}

/**
 * A flower on its stem. Closed, the petals fold together upwards into a bud; as it opens they
 * turn outwards around a yellow centre.
 */
export function drawFlower(context: CanvasRenderingContext2D, view: FlowerView) {
  const { base, stemHeight, radius, colour, alpha = 1 } = view;
  const open = Math.min(1, Math.max(0, view.openness));
  const head = flowerHead(view);
  context.save();
  context.globalAlpha = alpha;

  context.strokeStyle = STEM;
  context.lineWidth = Math.max(3, radius * 0.12);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(base.x, base.y);
  context.quadraticCurveTo(base.x, base.y - stemHeight * 0.5, head.x, head.y);
  context.stroke();

  context.fillStyle = LEAF;
  for (const side of [-1, 1]) {
    context.beginPath();
    context.ellipse(
      base.x + side * radius * 0.35,
      base.y - stemHeight * (side < 0 ? 0.35 : 0.5),
      radius * 0.38,
      radius * 0.14,
      side * -0.6,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  const length = radius * (0.55 + 0.45 * open);
  const petalWidth = radius * (0.24 + 0.18 * open);
  context.fillStyle = colour;
  context.strokeStyle = BUD_OUTLINE;
  context.lineWidth = 2;
  for (let petal = 0; petal < PETALS; petal++) {
    const closedAngle = -Math.PI / 2 + (petal - (PETALS - 1) / 2) * 0.12;
    const openAngle = -Math.PI / 2 + (petal * 2 * Math.PI) / PETALS;
    const angle = closedAngle + (openAngle - closedAngle) * open;
    const reach = length * (0.35 + 0.25 * open);
    context.beginPath();
    context.ellipse(
      head.x + Math.cos(angle) * reach,
      head.y + Math.sin(angle) * reach,
      length * 0.5,
      petalWidth * 0.5,
      angle,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
  }

  if (open > 0.25) {
    context.globalAlpha = alpha * Math.min(1, (open - 0.25) / 0.4);
    context.fillStyle = FLOWER_CENTRE;
    context.beginPath();
    context.arc(head.x, head.y, radius * 0.24, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

/** Soft stars drifting out from the flower and fading. Slow, with no flashing. */
export function drawSparkle(
  context: CanvasRenderingContext2D,
  centre: Point,
  radius: number,
  progress: number,
) {
  if (progress <= 0 || progress >= 1) return;
  context.save();
  context.globalAlpha = 1 - progress;
  context.fillStyle = SPARKLE;
  const distance = radius * (1.1 + 0.6 * progress);
  const size = radius * 0.1 * (1 - 0.4 * progress);
  for (let star = 0; star < SPARKLES; star++) {
    const angle = (star / SPARKLES) * 2 * Math.PI + Math.PI / SPARKLES;
    const x = centre.x + Math.cos(angle) * distance;
    const y = centre.y + Math.sin(angle) * distance;
    context.beginPath();
    for (let tip = 0; tip < 8; tip++) {
      const r = tip % 2 === 0 ? size : size * 0.35;
      const a = (tip / 8) * 2 * Math.PI;
      if (tip === 0) context.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else context.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    context.closePath();
    context.fill();
  }
  context.restore();
}

/** Where the seed is, from 0 (leaving the flower) to 1 (in the basket), along a gentle arc. */
export function seedPosition(from: Point, to: Point, progress: number): Point {
  const p = Math.min(1, Math.max(0, progress));
  const eased = 1 - (1 - p) ** 2;
  const lift = Math.min(from.y, to.y) - Math.abs(to.x - from.x) * 0.35;
  const x = from.x + (to.x - from.x) * eased;
  const y = (1 - eased) ** 2 * from.y + 2 * (1 - eased) * eased * lift + eased ** 2 * to.y;
  return { x, y };
}

export function drawSeed(context: CanvasRenderingContext2D, at: Point, size: number) {
  context.fillStyle = SEED;
  context.beginPath();
  context.ellipse(at.x, at.y, size * 0.6, size, 0.4, 0, Math.PI * 2);
  context.fill();
}

/** A woven basket, `size` wide, standing on `base`. */
export function drawBasket(context: CanvasRenderingContext2D, base: Point, size: number) {
  const half = size / 2;
  const height = size * 0.6;
  context.fillStyle = BASKET;
  context.beginPath();
  context.moveTo(base.x - half, base.y - height);
  context.lineTo(base.x + half, base.y - height);
  context.lineTo(base.x + half * 0.75, base.y);
  context.lineTo(base.x - half * 0.75, base.y);
  context.closePath();
  context.fill();
  context.strokeStyle = BASKET_DARK;
  context.lineWidth = 2;
  for (let line = 1; line < 3; line++) {
    const y = base.y - (height * line) / 3;
    const inset = half * 0.25 * (1 - line / 3);
    context.beginPath();
    context.moveTo(base.x - half + inset, y);
    context.lineTo(base.x + half - inset, y);
    context.stroke();
  }
  context.lineWidth = Math.max(3, size * 0.06);
  context.beginPath();
  context.ellipse(base.x, base.y - height, half, size * 0.08, 0, 0, Math.PI * 2);
  context.stroke();
}

/** Where the basket's opening is, for a basket standing on `base`. */
export function basketMouth(base: Point, size: number): Point {
  return { x: base.x, y: base.y - size * 0.6 };
}
