import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useEffect, useRef } from "react";

import { t } from "@/i18n";
import type { Side } from "@/types/api";

import { type BodyFrame, fromBodyFrame, type Point } from "./geometry";
import { isLandmarkVisible, POSE } from "./landmarks";
import type { VisionResult } from "./visionEngine";

const WIDTH = 640;
const HEIGHT = 480;
const POSE_COLOR = "#E8F2F1";
const HAND_COLOR = "#D9682B";
const POSE_LINE_WIDTH = 5;
const HAND_LINE_WIDTH = 3;
const POINT_RADIUS = 5;
const X_AXIS_COLOR = "#F2C94C";
const Y_AXIS_COLOR = "#56CCF2";
const AXIS_LINE_WIDTH = 4;
const AXIS_FONT = "bold 22px sans-serif";
const AXIS_LABEL_OFFSET = 6;
const HIGHLIGHT_COLOR = "#F2C94C";
const HIGHLIGHT_LINE_WIDTH = 12;
const ARROW_COLOR = "#F2C94C";
const ARROW_LENGTH_SW = 1.2;
const ARROW_LINE_WIDTH = 12;
const ARROW_HEAD_SIZE = 34;

const POSE_CONNECTIONS: [number, number][] = [
  [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
  [POSE.LEFT_SHOULDER, POSE.LEFT_HIP],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_HIP],
  [POSE.LEFT_HIP, POSE.RIGHT_HIP],
  [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW],
  [POSE.LEFT_ELBOW, POSE.LEFT_WRIST],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW],
  [POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST],
];

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

// Mirrored, so moving your right hand moves the skeleton on the right, like a mirror.
const toX = (landmark: Point) => (1 - landmark.x) * WIDTH;
const toY = (landmark: Point) => landmark.y * HEIGHT;

function drawLine(
  context: CanvasRenderingContext2D,
  from: NormalizedLandmark,
  to: NormalizedLandmark,
) {
  context.beginPath();
  context.moveTo(toX(from), toY(from));
  context.lineTo(toX(to), toY(to));
  context.stroke();
}

function drawPose(context: CanvasRenderingContext2D, pose: NormalizedLandmark[]) {
  context.strokeStyle = POSE_COLOR;
  context.lineWidth = POSE_LINE_WIDTH;
  context.lineCap = "round";
  for (const [start, end] of POSE_CONNECTIONS) {
    if (isLandmarkVisible(pose[start]) && isLandmarkVisible(pose[end])) {
      drawLine(context, pose[start], pose[end]);
    }
  }
}

function drawArmHighlight(
  context: CanvasRenderingContext2D,
  pose: NormalizedLandmark[],
  side: Side,
) {
  const [shoulder, elbow, wrist] =
    side === "left"
      ? [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW, POSE.LEFT_WRIST]
      : [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST];
  context.strokeStyle = HIGHLIGHT_COLOR;
  context.lineWidth = HIGHLIGHT_LINE_WIDTH;
  context.lineCap = "round";
  for (const [start, end] of [
    [shoulder, elbow],
    [elbow, wrist],
  ]) {
    if (isLandmarkVisible(pose[start]) && isLandmarkVisible(pose[end])) {
      drawLine(context, pose[start], pose[end]);
    }
  }
}

function drawHand(context: CanvasRenderingContext2D, hand: NormalizedLandmark[]) {
  context.strokeStyle = HAND_COLOR;
  context.fillStyle = HAND_COLOR;
  context.lineWidth = HAND_LINE_WIDTH;
  context.lineCap = "round";
  for (const [start, end] of HAND_CONNECTIONS) {
    drawLine(context, hand[start], hand[end]);
  }
  for (const point of hand) {
    context.beginPath();
    context.arc(toX(point), toY(point), POINT_RADIUS, 0, Math.PI * 2);
    context.fill();
  }
}

function drawAxis(
  context: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: string,
  label: string,
) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = AXIS_LINE_WIDTH;
  context.beginPath();
  context.moveTo(toX(from), toY(from));
  context.lineTo(toX(to), toY(to));
  context.stroke();
  context.font = AXIS_FONT;
  context.fillText(label, toX(to) + AXIS_LABEL_OFFSET, toY(to) - AXIS_LABEL_OFFSET);
}

function drawBodyFrame(
  context: CanvasRenderingContext2D,
  frame: BodyFrame,
  frameWidth: number,
  frameHeight: number,
) {
  const normalise = (point: Point) => ({ x: point.x / frameWidth, y: point.y / frameHeight });
  const origin = normalise(frame.origin);
  const xEnd = normalise(fromBodyFrame({ x: 1, y: 0 }, frame));
  const yEnd = normalise(fromBodyFrame({ x: 0, y: 1 }, frame));
  drawAxis(context, origin, xEnd, X_AXIS_COLOR, t("setup.debug.axisX"));
  drawAxis(context, origin, yEnd, Y_AXIS_COLOR, t("setup.debug.axisY"));
}

function drawDirectionArrow(
  context: CanvasRenderingContext2D,
  frame: BodyFrame,
  directionDeg: number,
  frameWidth: number,
  frameHeight: number,
) {
  const radians = (directionDeg * Math.PI) / 180;
  const end = fromBodyFrame(
    { x: ARROW_LENGTH_SW * Math.cos(radians), y: ARROW_LENGTH_SW * Math.sin(radians) },
    frame,
  );
  // Going through toX means the arrow is mirrored along with the skeleton.
  const fromX = toX({ x: frame.origin.x / frameWidth, y: 0 });
  const fromY = toY({ x: 0, y: frame.origin.y / frameHeight });
  const tipX = toX({ x: end.x / frameWidth, y: 0 });
  const tipY = toY({ x: 0, y: end.y / frameHeight });
  const angle = Math.atan2(tipY - fromY, tipX - fromX);

  context.strokeStyle = ARROW_COLOR;
  context.fillStyle = ARROW_COLOR;
  context.lineWidth = ARROW_LINE_WIDTH;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(fromX, fromY);
  context.lineTo(tipX, tipY);
  context.stroke();

  context.beginPath();
  context.moveTo(
    tipX + ARROW_HEAD_SIZE * 0.6 * Math.cos(angle),
    tipY + ARROW_HEAD_SIZE * 0.6 * Math.sin(angle),
  );
  for (const side of [-1, 1]) {
    context.lineTo(
      tipX - ARROW_HEAD_SIZE * Math.cos(angle + (side * Math.PI) / 4),
      tipY - ARROW_HEAD_SIZE * Math.sin(angle + (side * Math.PI) / 4),
    );
  }
  context.closePath();
  context.fill();
}

interface SkeletonCanvasProps {
  result: VisionResult | null;
  /** Draws one shoulder width of each body-frame axis, for debugging. */
  bodyFrame?: BodyFrame | null;
  /** Draws a large arrow from the affected shoulder in this body-frame direction. */
  arrow?: { frame: BodyFrame; directionDeg: number } | null;
  /** Draws this arm boldly, for the arm being exercised. */
  highlightSide?: Side;
}

/** Draws landmarks only. The camera image is never shown. */
export function SkeletonCanvas({ result, bodyFrame, arrow, highlightSide }: SkeletonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    if (result && arrow) {
      drawDirectionArrow(
        context,
        arrow.frame,
        arrow.directionDeg,
        result.frameWidth,
        result.frameHeight,
      );
    }
    if (result?.pose) drawPose(context, result.pose);
    if (result?.pose && highlightSide) drawArmHighlight(context, result.pose, highlightSide);
    if (result?.hand) drawHand(context, result.hand);
    if (result && bodyFrame) {
      drawBodyFrame(context, bodyFrame, result.frameWidth, result.frameHeight);
    }
  }, [result, bodyFrame, arrow, highlightSide]);

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={t("vision.skeletonLabel")}
      className="aspect-4/3 w-full rounded-xl border border-white/20"
    />
  );
}
