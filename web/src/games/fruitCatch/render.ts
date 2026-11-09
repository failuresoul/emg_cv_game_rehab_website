import type { Point } from "@/vision/geometry";

/**
 * A calm evening garden: dark enough that the white top bar, the faint skeleton and the orange
 * cursor stay easy to see.
 */
const SKY_TOP = "#1E3F45";
const SKY_BOTTOM = "#2F5E55";
const HILL_COLOR = "#2B5A45";
const GRASS_COLOR = "#3C7350";
const BUSH_COLOR = "rgba(20, 50, 35, 0.55)";
const BASKET_COLOR = "#A9733F";
const BASKET_DARK = "#7A4F27";
const BASKET_LIGHT = "#D4A26A";
const LEAF_COLOR = "#5DA05A";
const STEM_COLOR = "#5B3A1E";
/** How far apart the weave lines are, as a share of the basket's height. */
const WEAVE_STEP = 0.28;

export type FruitKind = "apple" | "orange" | "pear" | "plum" | "lemon";
export const FRUIT_KINDS: readonly FruitKind[] = ["apple", "orange", "pear", "plum", "lemon"];
const FRUIT_COLOURS: Record<FruitKind, string> = {
  apple: "#D9534F",
  orange: "#F0913A",
  pear: "#A8C94A",
  plum: "#8E5BA8",
  lemon: "#F2D04B",
};

/** The garden, with the ground at groundY in screen pixels. */
export function drawGarden(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  groundY: number,
) {
  const sky = context.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_BOTTOM);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  context.fillStyle = HILL_COLOR;
  context.beginPath();
  context.moveTo(0, groundY - height * 0.08);
  context.quadraticCurveTo(
    width * 0.3,
    groundY - height * 0.16,
    width * 0.6,
    groundY - height * 0.07,
  );
  context.quadraticCurveTo(width * 0.85, groundY - height * 0.02, width, groundY - height * 0.1);
  context.lineTo(width, groundY);
  context.lineTo(0, groundY);
  context.closePath();
  context.fill();

  context.fillStyle = BUSH_COLOR;
  for (const share of [0.08, 0.37, 0.71, 0.93]) {
    const x = share * width;
    const size = height * 0.05;
    context.beginPath();
    context.arc(x, groundY, size, Math.PI, 0);
    context.arc(x + size * 0.9, groundY, size * 0.7, Math.PI, 0);
    context.fill();
  }

  context.fillStyle = GRASS_COLOR;
  context.fillRect(0, groundY, width, height - groundY);
}

/** A simple, friendly fruit of the given kind, centred at `centre`. */
export function drawFruit(
  context: CanvasRenderingContext2D,
  kind: FruitKind,
  centre: Point,
  radius: number,
  alpha = 1,
) {
  const { x, y } = centre;
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = FRUIT_COLOURS[kind];
  context.beginPath();
  if (kind === "pear") {
    context.ellipse(x, y + radius * 0.2, radius * 0.85, radius, 0, 0, Math.PI * 2);
    context.ellipse(x, y - radius * 0.45, radius * 0.55, radius * 0.6, 0, 0, Math.PI * 2);
  } else if (kind === "lemon") {
    context.ellipse(x, y, radius * 1.1, radius * 0.8, 0, 0, Math.PI * 2);
  } else {
    context.arc(x, y, radius, 0, Math.PI * 2);
  }
  context.fill();

  // A small shine, a stem and a leaf.
  context.fillStyle = "rgba(255, 255, 255, 0.35)";
  context.beginPath();
  context.ellipse(
    x - radius * 0.35,
    y - radius * 0.3,
    radius * 0.15,
    radius * 0.25,
    -0.5,
    0,
    Math.PI * 2,
  );
  context.fill();
  if (kind !== "lemon") {
    const top = kind === "pear" ? y - radius * 1.05 : y - radius;
    context.strokeStyle = STEM_COLOR;
    context.lineWidth = Math.max(2, radius * 0.1);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(x, top + radius * 0.15);
    context.lineTo(x + radius * 0.1, top - radius * 0.25);
    context.stroke();
    context.fillStyle = LEAF_COLOR;
    context.beginPath();
    context.ellipse(
      x + radius * 0.35,
      top - radius * 0.15,
      radius * 0.3,
      radius * 0.14,
      -0.5,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.restore();
}

/** A woven basket whose rim is centred at `rim`, `width` pixels wide. */
export function drawBasket(context: CanvasRenderingContext2D, rim: Point, width: number) {
  const height = width * 0.42;
  const bottomInset = width * 0.12;
  const left = rim.x - width / 2;
  const right = rim.x + width / 2;
  const bottom = rim.y + height;

  context.save();
  context.beginPath();
  context.moveTo(left, rim.y);
  context.lineTo(right, rim.y);
  context.lineTo(right - bottomInset, bottom);
  context.lineTo(left + bottomInset, bottom);
  context.closePath();
  context.fillStyle = BASKET_COLOR;
  context.fill();
  context.clip();

  // The weave: rows across, and slanted strands both ways.
  context.strokeStyle = BASKET_DARK;
  context.lineWidth = Math.max(2, height * 0.06);
  for (let row = WEAVE_STEP; row < 1; row += WEAVE_STEP) {
    context.beginPath();
    context.moveTo(left, rim.y + row * height);
    context.lineTo(right, rim.y + row * height);
    context.stroke();
  }
  context.strokeStyle = BASKET_LIGHT;
  context.lineWidth = Math.max(1.5, height * 0.04);
  for (let offset = -height; offset < width + height; offset += height * 0.5) {
    context.beginPath();
    context.moveTo(left + offset, rim.y);
    context.lineTo(left + offset + height * 0.6, bottom);
    context.stroke();
  }
  context.restore();

  context.strokeStyle = BASKET_DARK;
  context.lineWidth = Math.max(4, height * 0.14);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(left, rim.y);
  context.lineTo(right, rim.y);
  context.stroke();
}
