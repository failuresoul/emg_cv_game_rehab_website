/**
 * Synthetic landmark streams for the automated tests (Day 18): a seated person in front of a
 * 640×480 webcam, moving as a small script says. The frames look like MediaPipe's:
 * 33 pose landmarks (image and world) and 21 hand landmarks (image and world) for the affected
 * hand, so the tracker, the joint angles, the hand measures, the posture and the setup checks
 * read them unchanged.
 *
 * Coordinates: the world is in metres, origin between the hips, +x towards the image's right
 * (the person's left, for an unmirrored camera), +y down and +z away from the camera. The camera
 * sits CAMERA_DISTANCE_M in front of the hips.
 *
 * A script is a list of steps with durations, such as
 *   { affectedSide: "left", steps: [
 *       { do: "still", ms: 1000 },
 *       { do: "reach", to: "target", ms: 1200, holdMs: 800, back: true },
 *       { do: "hand", open: 0, ms: 400, holdMs: 1000 },
 *   ] }
 * where "target" is the game's current target (window.__muviTest.currentTarget), read when the
 * step starts. A pinch-carry-release is: reach to the object, "pinch", reach to the box with the
 * pinch held, "release".
 */

import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

import type { Finger } from "@/input/fingerTouch";
import type { Side } from "@/types/api";
import type { Point } from "@/vision/geometry";
import type { DetectedHand } from "@/vision/visionEngine";

export const SYNTH_FRAME_WIDTH = 640;
export const SYNTH_FRAME_HEIGHT = 480;
const FOCAL_PX = 560;
const CAMERA_DISTANCE_M = 1.3;
/** The world height the camera looks at (between the hips and the shoulders). */
const AIM_Y_M = -0.38;

const SHOULDER_HALF_M = 0.18;
const SHOULDER_Y_M = -0.5;
const HIP_HALF_M = 0.1;
const UPPER_ARM_M = 0.29;
const FOREARM_M = 0.26;

/** A reach is aimed at this share of the arm's full length when the target allows. */
const REACH_EXTENSION = 0.85;

const FINGER_INDEX: Record<Finger, number> = { index: 0, middle: 1, ring: 2, little: 3 };

// ---------------------------------------------------------------------------------------------
// The script.

export interface ArmAngles {
  /** The angle between the upper arm and the trunk, as computeJointAngles measures it. */
  elevationDeg: number;
  /** 0 straight out to the side, 90 straight forward. */
  planeDeg: number;
  /** The angle at the elbow between upper arm and forearm: 180 is straight. */
  elbowDeg: number;
}

interface Timed {
  ms: number;
  /** How long to stay at the end of the movement. */
  holdMs?: number;
  /** Then go back to where the step started, taking `ms` again. */
  back?: boolean;
}

export type SynthStep =
  /** Sit still (the arm resting, the hand on the lap). */
  | { do: "still"; ms: number }
  /** Move the index fingertip to a body-frame point (SW), or the game's current target. */
  | ({ do: "reach"; to: Point | "target" } & Timed)
  /** Keep the fingertip on the game's moving target (path tracing, catching). */
  | { do: "follow"; ms: number }
  /** Raise the (straight) arm forward, sideways, or in a plane given in degrees. */
  | ({ do: "raise"; plane: "forward" | "sideways" | number; deg: number } & Timed)
  /** Set the elbow angle (180 straight) keeping the upper arm where it is. */
  | ({ do: "elbow"; deg: number } & Timed)
  /** Set the arm's joint angles directly. */
  | ({ do: "arm"; angles: ArmAngles } & Timed)
  /** Open (1) or close (0) the hand. */
  | ({ do: "hand"; open: number } & Timed)
  /** Touch the thumb to each finger in turn, then let go. */
  | { do: "thumbTouch"; fingers?: Finger[]; msEach: number; holdMs?: number }
  /** Thumb to index and hold (until "release"). */
  | { do: "pinch"; ms: number }
  | { do: "release"; ms: number }
  /** Lean the trunk forward (towards the camera) or sideways (positive: to the affected side). */
  | ({ do: "lean"; forwardDeg?: number; sidewaysDeg?: number } & Timed)
  /** The hand is not detected (the pose still is). */
  | { do: "hideHand"; ms: number }
  /** Nobody in view: no pose and no hand. */
  | { do: "leave"; ms: number };

export interface SynthScript {
  affectedSide: Side;
  steps: SynthStep[];
  /** Frames per second; 30 by default. */
  fps?: number;
  /** Start again after the last step; otherwise the last position is held. */
  loop?: boolean;
  /** The frame brightness (0-255) the light check reads; 140 by default. */
  brightness?: number;
  /** Random tremor in metres (0 for exact landmarks); 0.0015 by default. */
  jitterM?: number;
  seed?: number;
}

/** One frame of landmarks, as the vision engine emits (without fps and frame size). */
export interface FeedFrame {
  /** Milliseconds from the start of the stream. */
  t: number;
  brightness: number | null;
  hands: DetectedHand[];
  pose: NormalizedLandmark[] | null;
  poseWorld: Landmark[] | null;
}

// ---------------------------------------------------------------------------------------------
// Vectors.

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec3, k: number): Vec3 => v(a.x * k, a.y * k, a.z * k);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3): Vec3 => {
  const size = length(a);
  return size === 0 ? a : scale(a, 1 / size);
};
const lerp = (a: number, b: number, s: number): number => a + (b - a) * s;
const lerpVec = (a: Vec3, b: Vec3, s: number): Vec3 =>
  v(lerp(a.x, b.x, s), lerp(a.y, b.y, s), lerp(a.z, b.z, s));
const radians = (deg: number): number => (deg * Math.PI) / 180;
/** The part of a perpendicular to n. */
const reject = (a: Vec3, n: Vec3): Vec3 => sub(a, scale(n, dot(a, unit(n))));

/** Rotates a about the unit axis k by angle (Rodrigues). */
function rotate(a: Vec3, k: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(add(scale(a, cos), scale(cross(k, a), sin)), scale(k, dot(k, a) * (1 - cos)));
}

/** Spherical interpolation between unit vectors. */
function slerp(a: Vec3, b: Vec3, s: number): Vec3 {
  const cosine = Math.min(1, Math.max(-1, dot(a, b)));
  const angle = Math.acos(cosine);
  if (angle < 1e-6) return b;
  const axis = cross(a, b);
  if (length(axis) < 1e-9) return unit(lerpVec(a, b, s));
  return unit(rotate(a, unit(axis), angle * s));
}

/** Minimum-jerk easing, 0 to 1, as human point-to-point movements are. */
export function minimumJerk(s: number): number {
  const t = Math.min(1, Math.max(0, s));
  return t * t * t * (10 - 15 * t + 6 * t * t);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// The body.

/** The arm as unit directions in the trunk's own axes (before any lean). */
interface ArmPose {
  upper: Vec3;
  fore: Vec3;
}

interface BodyState {
  arm: ArmPose;
  /** 1 open, 0 a fist. */
  open: number;
  /** The finger the thumb goes to (0 index ... 3 little) and how far (1 touching). */
  thumbFinger: number;
  thumbAmount: number;
  leanForwardDeg: number;
  leanSidewaysDeg: number;
  handVisible: boolean;
  present: boolean;
}

/** Trunk axes for the affected side: down, outward (away from the midline) and forward. */
function trunkAxes(side: Side): { down: Vec3; out: Vec3; forward: Vec3 } {
  // Down is the affected side's shoulder-to-hip line, as computeJointAngles measures against:
  // the hips are narrower than the shoulders, so it slopes in a little.
  const sign = side === "left" ? 1 : -1;
  const inward = SHOULDER_HALF_M - HIP_HALF_M;
  const drop = -SHOULDER_Y_M;
  return {
    down: unit(v(-sign * inward, drop, 0)),
    out: unit(v(sign * drop, inward, 0)),
    forward: v(0, 0, -1),
  };
}

/** The arm for joint angles, bending the elbow forward and up. */
export function armFromAngles(angles: ArmAngles, side: Side): ArmPose {
  const { down, out, forward } = trunkAxes(side);
  const elevation = radians(angles.elevationDeg);
  const plane = radians(angles.planeDeg);
  const horizontal = add(scale(out, Math.cos(plane)), scale(forward, Math.sin(plane)));
  const upper = unit(add(scale(down, Math.cos(elevation)), scale(horizontal, Math.sin(elevation))));
  let bend = reject(sub(forward, down), upper);
  if (length(bend) < 1e-6) bend = reject(scale(down, -1), upper);
  bend = unit(bend);
  const flexion = radians(180 - angles.elbowDeg);
  const fore = unit(add(scale(upper, Math.cos(flexion)), scale(bend, Math.sin(flexion))));
  return { upper, fore };
}

/** Resting: the upper arm nearly down, the forearm forward, the hand on the lap. */
const REST_ANGLES: ArmAngles = { elevationDeg: 12, planeDeg: 80, elbowDeg: 105 };

function initialState(side: Side): BodyState {
  return {
    arm: armFromAngles(REST_ANGLES, side),
    open: 0.7,
    thumbFinger: 0,
    thumbAmount: 0,
    leanForwardDeg: 0,
    leanSidewaysDeg: 0,
    handVisible: true,
    present: true,
  };
}

/** The trunk's rotation about the hips: forward lean, then sideways lean. */
function leanRotation(state: BodyState, side: Side): (p: Vec3) => Vec3 {
  const forward = radians(state.leanForwardDeg);
  const sideways = radians(state.leanSidewaysDeg) * (side === "left" ? 1 : -1);
  return (p) => {
    // About x: up (0,-1,0) tips towards -z (the camera).
    const y1 = p.y * Math.cos(forward) - p.z * Math.sin(forward);
    const z1 = p.y * Math.sin(forward) + p.z * Math.cos(forward);
    // About z: up tips towards +x for the left side.
    const x2 = p.x * Math.cos(sideways) - y1 * Math.sin(sideways);
    const y2 = p.x * Math.sin(sideways) + y1 * Math.cos(sideways);
    return v(x2, y2, z1);
  };
}

interface HandShape {
  /** 21 points in the hand's axes: along (to the fingers), across (to the thumb), palm. */
  points: Vec3[];
}

// Bases of each finger (along, across), and the lengths of its three segments.
const FINGERS_MODEL: { base: [number, number]; segments: [number, number, number] }[] = [
  { base: [0.09, 0.022], segments: [0.045, 0.027, 0.022] },
  { base: [0.095, 0.0], segments: [0.05, 0.03, 0.024] },
  { base: [0.09, -0.02], segments: [0.047, 0.029, 0.022] },
  { base: [0.08, -0.038], segments: [0.037, 0.022, 0.02] },
];
const THUMB_BASE = v(0.02, 0.025, 0.01);
const THUMB_SEGMENTS: [number, number, number] = [0.035, 0.032, 0.028];

/** One finger's four points (MCP to tip) for a curl (0 straight, 1 fully bent). */
function fingerChain(finger: number, curl: number): Vec3[] {
  const { base, segments } = FINGERS_MODEL[finger];
  const flex = [radians(80 * curl), radians(100 * curl), radians(65 * curl)];
  const points = [v(base[0], base[1], 0)];
  let angle = 0;
  for (let i = 0; i < 3; i++) {
    angle += flex[i];
    const previous = points[points.length - 1];
    // Fingers bend towards the palm (+z in the hand's axes).
    points.push(add(previous, v(Math.cos(angle) * segments[i], 0, Math.sin(angle) * segments[i])));
  }
  return points;
}

function handShape(state: BodyState): HandShape {
  const curl = 1 - Math.min(1, Math.max(0, state.open));
  const touching = state.thumbAmount;
  const chains = [0, 1, 2, 3].map((finger) => {
    // The touched finger bends a little to meet the thumb.
    const own = finger === state.thumbFinger ? lerp(curl, Math.max(curl, 0.35), touching) : curl;
    return fingerChain(finger, own);
  });

  // The thumb: out at 40 degrees when open, across the palm in a fist.
  const openDirection = unit(v(Math.cos(radians(40)), Math.sin(radians(40)), 0.15));
  const fistDirection = unit(v(0.6, -0.2, 0.75));
  const direction = unit(lerpVec(openDirection, fistDirection, curl));
  const thumb = [THUMB_BASE];
  for (const segment of THUMB_SEGMENTS) {
    thumb.push(add(thumb[thumb.length - 1], scale(direction, segment)));
  }
  if (touching > 0) {
    // Bring the tip to the fingertip (just in front of it); the joints follow.
    const goal = add(chains[state.thumbFinger][3], v(0, 0.004, 0.006));
    const tip = lerpVec(thumb[3], goal, touching);
    const mcp = thumb[1];
    thumb[3] = tip;
    thumb[2] = add(lerpVec(mcp, tip, 0.5), v(0, 0.012 * touching, 0.008 * touching));
  }

  const wrist = v(0, 0, 0);
  const points: Vec3[] = [wrist, ...thumb.slice(0, 4)];
  // MediaPipe order: thumb 1-4, index 5-8, middle 9-12, ring 13-16, little 17-20.
  for (const chain of chains) points.push(...chain);
  // thumb[0] is the CMC (1); slice gave CMC, MCP, IP, tip.
  return { points };
}

interface RenderedBody {
  pose: Vec3[];
  hand: Vec3[] | null;
}

/** World positions of every landmark for a state. */
function renderWorld(state: BodyState, side: Side): RenderedBody {
  const leaned = leanRotation(state, side);
  const sign = side === "left" ? 1 : -1;
  // Person's left is +x.
  const leftShoulder = leaned(v(SHOULDER_HALF_M, SHOULDER_Y_M, 0));
  const rightShoulder = leaned(v(-SHOULDER_HALF_M, SHOULDER_Y_M, 0));
  const head = (x: number, y: number, z: number) => leaned(v(x, SHOULDER_Y_M + y, z));
  const affectedShoulder = side === "left" ? leftShoulder : rightShoulder;

  // The affected arm, its directions turned with the trunk.
  const turn = (direction: Vec3) => sub(leaned(direction), leaned(v(0, 0, 0)));
  const upper = turn(state.arm.upper);
  const fore = turn(state.arm.fore);
  const elbow = add(affectedShoulder, scale(upper, UPPER_ARM_M));
  const wrist = add(elbow, scale(fore, FOREARM_M));
  const hand = placeHand(handShape(state), wrist, fore, side, leaned);

  // The other arm rests, its hand on the lap.
  const otherShoulder = side === "left" ? rightShoulder : leftShoulder;
  const otherElbow = add(otherShoulder, turn(v(0.02 * -sign, 0.28, 0.03)));
  const otherWrist = add(otherElbow, turn(v(0.03 * sign, 0.05, -0.24)));

  const point = (x: number, y: number, z: number) => v(x, y, z);
  const pose: Vec3[] = new Array(33);
  pose[0] = head(0, -0.2, -0.1);
  pose[1] = head(0.03, -0.235, -0.085);
  pose[2] = head(0.035, -0.237, -0.083);
  pose[3] = head(0.045, -0.236, -0.078);
  pose[4] = head(-0.03, -0.235, -0.085);
  pose[5] = head(-0.035, -0.237, -0.083);
  pose[6] = head(-0.045, -0.236, -0.078);
  pose[7] = head(0.075, -0.22, -0.01);
  pose[8] = head(-0.075, -0.22, -0.01);
  pose[9] = head(0.025, -0.16, -0.09);
  pose[10] = head(-0.025, -0.16, -0.09);
  pose[11] = leftShoulder;
  pose[12] = rightShoulder;
  const [leftElbow, rightElbow] = side === "left" ? [elbow, otherElbow] : [otherElbow, elbow];
  const [leftWrist, rightWrist] = side === "left" ? [wrist, otherWrist] : [otherWrist, wrist];
  pose[13] = leftElbow;
  pose[14] = rightElbow;
  pose[15] = leftWrist;
  pose[16] = rightWrist;
  // Pinky, index and thumb: from the hand on the affected side, near the wrist on the other.
  const affectedExtras = [hand[17], hand[5], hand[2]];
  const otherExtras = [
    add(otherWrist, v(0.02 * sign, 0.01, -0.06)),
    add(otherWrist, v(0, 0.01, -0.08)),
    add(otherWrist, v(-0.02 * sign, 0, -0.05)),
  ];
  const [leftExtras, rightExtras] =
    side === "left" ? [affectedExtras, otherExtras] : [otherExtras, affectedExtras];
  pose[17] = leftExtras[0];
  pose[18] = rightExtras[0];
  pose[19] = leftExtras[1];
  pose[20] = rightExtras[1];
  pose[21] = leftExtras[2];
  pose[22] = rightExtras[2];
  // Seated: hips on the chair, knees forward, feet on the floor.
  pose[23] = point(HIP_HALF_M, 0, 0);
  pose[24] = point(-HIP_HALF_M, 0, 0);
  pose[25] = point(0.12, 0.05, -0.42);
  pose[26] = point(-0.12, 0.05, -0.42);
  pose[27] = point(0.12, 0.47, -0.45);
  pose[28] = point(-0.12, 0.47, -0.45);
  pose[29] = point(0.12, 0.5, -0.4);
  pose[30] = point(-0.12, 0.5, -0.4);
  pose[31] = point(0.13, 0.5, -0.55);
  pose[32] = point(-0.13, 0.5, -0.55);
  return { pose, hand: state.handVisible ? hand : null };
}

/**
 * The hand at the wrist, pointing along the forearm with the palm down and the thumb towards the
 * midline, turned so that the index fingertip lies on the forearm's line (reaches aim at it).
 */
function placeHand(
  shape: HandShape,
  wrist: Vec3,
  fore: Vec3,
  side: Side,
  leaned: (p: Vec3) => Vec3,
): Vec3[] {
  const down = sub(leaned(v(0, 1, 0)), leaned(v(0, 0, 0)));
  const medial = v(side === "left" ? -1 : 1, 0, 0);
  const along = unit(fore);
  let palm = reject(down, along);
  if (length(palm) < 1e-3) palm = reject(v(0, 0, 1), along);
  palm = unit(palm);
  let across = unit(cross(along, palm));
  if (dot(across, medial) < 0) across = scale(across, -1);
  const toWorld = (p: Vec3) =>
    add(wrist, add(add(scale(along, p.x), scale(across, p.y)), scale(palm, p.z)));
  const world = shape.points.map(toWorld);
  // Turn the hand about the wrist so the index tip is straight along the forearm.
  const tipDirection = unit(sub(world[8], wrist));
  const axis = cross(tipDirection, along);
  const angle = Math.atan2(length(axis), dot(tipDirection, along));
  if (length(axis) < 1e-9) return world;
  const k = unit(axis);
  return world.map((p) => add(wrist, rotate(sub(p, wrist), k, angle)));
}

/** How far the index tip is from the wrist for a hand shape, in metres. */
function indexTipReach(state: BodyState): number {
  const points = handShape(state).points;
  return length(points[8]);
}

// ---------------------------------------------------------------------------------------------
// The camera.

interface PixelPoint {
  u: number;
  v: number;
}

function project(p: Vec3): PixelPoint {
  const depth = p.z + CAMERA_DISTANCE_M;
  return {
    u: SYNTH_FRAME_WIDTH / 2 + (FOCAL_PX * p.x) / depth,
    v: SYNTH_FRAME_HEIGHT / 2 + (FOCAL_PX * (p.y - AIM_Y_M)) / depth,
  };
}

const CAMERA = v(0, AIM_Y_M, -CAMERA_DISTANCE_M);

function rayThrough(pixel: PixelPoint): Vec3 {
  return unit(
    v(
      (pixel.u - SYNTH_FRAME_WIDTH / 2) / FOCAL_PX,
      (pixel.v - SYNTH_FRAME_HEIGHT / 2) / FOCAL_PX,
      1,
    ),
  );
}

/** Where the body frame's point (SW) is in the image, for the shoulders of a state. */
function bodyPointToPixel(state: BodyState, side: Side, pointSw: Point): PixelPoint {
  const leaned = leanRotation(state, side);
  const left = project(leaned(v(SHOULDER_HALF_M, SHOULDER_Y_M, 0)));
  const right = project(leaned(v(-SHOULDER_HALF_M, SHOULDER_Y_M, 0)));
  const [origin, other] = side === "left" ? [left, right] : [right, left];
  const widthPx = Math.hypot(left.u - right.u, left.v - right.v);
  const outward = origin.u >= other.u ? 1 : -1;
  return { u: origin.u + pointSw.x * outward * widthPx, v: origin.v - pointSw.y * widthPx };
}

/** The arm that puts the index fingertip on a body-frame point, as far as it can. */
export function armReaching(state: BodyState, side: Side, pointSw: Point): ArmPose {
  const leaned = leanRotation(state, side);
  const shoulder = leaned(v(side === "left" ? SHOULDER_HALF_M : -SHOULDER_HALF_M, SHOULDER_Y_M, 0));
  const lower = FOREARM_M + indexTipReach(state);
  const full = UPPER_ARM_M + lower;

  // On the camera's ray through the target, the point in front of the body at a comfortable
  // reach (or the closest point to the shoulder if the target is out of reach).
  const ray = rayThrough(bodyPointToPixel(state, side, pointSw));
  const along = dot(sub(shoulder, CAMERA), ray);
  const closest = add(CAMERA, scale(ray, along));
  const gap = length(sub(closest, shoulder));
  const wanted = Math.max(gap, REACH_EXTENSION * full);
  const back = Math.sqrt(Math.max(0, wanted * wanted - gap * gap));
  const target = add(CAMERA, scale(ray, along - back));

  // Two segments: the upper arm, and the forearm with the hand. The elbow points down and out.
  const toTarget = sub(target, shoulder);
  const distanceM = Math.min(
    full - 1e-4,
    Math.max(Math.abs(UPPER_ARM_M - lower) + 1e-4, length(toTarget)),
  );
  const direction = unit(toTarget);
  const cosine =
    (UPPER_ARM_M * UPPER_ARM_M + distanceM * distanceM - lower * lower) /
    (2 * UPPER_ARM_M * distanceM);
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  const down = sub(leaned(v(0, 1, 0)), leaned(v(0, 0, 0)));
  const out = sub(leaned(v(side === "left" ? 1 : -1, 0, 0)), leaned(v(0, 0, 0)));
  let pole = reject(add(down, scale(out, 0.35)), direction);
  if (length(pole) < 1e-6) pole = reject(v(0, 0, -1), direction);
  pole = unit(pole);
  const elbow = add(shoulder, scale(add(scale(direction, cosine), scale(pole, sine)), UPPER_ARM_M));
  const tip = add(shoulder, scale(direction, distanceM));
  const upperWorld = unit(sub(elbow, shoulder));
  const foreWorld = unit(sub(tip, elbow));
  // Back to the trunk's own axes (undo the lean).
  const unlean = inverseLean(state, side);
  return { upper: unit(unlean(upperWorld)), fore: unit(unlean(foreWorld)) };
}

function inverseLean(state: BodyState, side: Side): (p: Vec3) => Vec3 {
  const forward = radians(state.leanForwardDeg);
  const sideways = radians(state.leanSidewaysDeg) * (side === "left" ? 1 : -1);
  return (p) => {
    const x1 = p.x * Math.cos(sideways) + p.y * Math.sin(sideways);
    const y1 = -p.x * Math.sin(sideways) + p.y * Math.cos(sideways);
    const y2 = y1 * Math.cos(forward) + p.z * Math.sin(forward);
    const z2 = -y1 * Math.sin(forward) + p.z * Math.cos(forward);
    return v(x1, y2, z2);
  };
}

// ---------------------------------------------------------------------------------------------
// Frames.

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function toFrame(
  state: BodyState,
  side: Side,
  t: number,
  brightness: number,
  noise: () => Vec3,
): FeedFrame {
  if (!state.present) return { t, brightness, hands: [], pose: null, poseWorld: null };
  const body = renderWorld(state, side);
  const pose = body.pose.map((p) => add(p, noise()));
  const hipMid = v(0, 0, 0);
  const lowerBody = (index: number) => index >= 25;
  const poseImage: NormalizedLandmark[] = pose.map((p, index) => {
    const pixel = project(p);
    const visibility = lowerBody(index) ? 0.2 : 0.99;
    return {
      x: round4(pixel.u / SYNTH_FRAME_WIDTH),
      y: round4(pixel.v / SYNTH_FRAME_HEIGHT),
      z: round4(((p.z - hipMid.z) * FOCAL_PX) / CAMERA_DISTANCE_M / SYNTH_FRAME_WIDTH),
      visibility,
    };
  });
  const poseWorld: Landmark[] = pose.map((p, index) => ({
    x: round4(p.x),
    y: round4(p.y),
    z: round4(p.z),
    visibility: lowerBody(index) ? 0.2 : 0.99,
  }));

  const hands: DetectedHand[] = [];
  if (body.hand) {
    const offset = noise();
    const hand = body.hand.map((p) => add(p, offset));
    const wrist = hand[0];
    const centre = hand[9];
    hands.push({
      landmarks: hand.map((p) => {
        const pixel = project(p);
        return {
          x: round4(pixel.u / SYNTH_FRAME_WIDTH),
          y: round4(pixel.v / SYNTH_FRAME_HEIGHT),
          z: round4(((p.z - wrist.z) * FOCAL_PX) / CAMERA_DISTANCE_M / SYNTH_FRAME_WIDTH),
          visibility: 0,
        };
      }),
      worldLandmarks: hand.map((p) => ({
        x: round4(p.x - centre.x),
        y: round4(p.y - centre.y),
        z: round4(p.z - centre.z),
        visibility: 0,
      })),
      // MediaPipe names hands as if the image were mirrored.
      handedness: side === "left" ? "Right" : "Left",
    });
  }
  return { t, brightness, hands, pose: poseImage, poseWorld };
}

// ---------------------------------------------------------------------------------------------
// Playing a script.

/** A piece of movement: from the state at its start to `end` (computed when it starts). */
interface Segment {
  ms: number;
  end: (start: BodyState) => BodyState;
  /** Follows a moving target every frame instead of moving to a fixed end. */
  follow?: boolean;
}

/** What `"target"` means: the game's current goal, or null if there is none. */
export type TargetResolver = () => Point | null;

export interface SynthOptions {
  resolveTarget?: TargetResolver;
}

function interpolate(a: BodyState, b: BodyState, s: number): BodyState {
  return {
    arm: { upper: slerp(a.arm.upper, b.arm.upper, s), fore: slerp(a.arm.fore, b.arm.fore, s) },
    open: lerp(a.open, b.open, s),
    thumbFinger: s < 0.5 ? a.thumbFinger : b.thumbFinger,
    thumbAmount: lerp(a.thumbAmount, b.thumbAmount, s),
    leanForwardDeg: lerp(a.leanForwardDeg, b.leanForwardDeg, s),
    leanSidewaysDeg: lerp(a.leanSidewaysDeg, b.leanSidewaysDeg, s),
    handVisible: s < 1 ? a.handVisible && b.handVisible : b.handVisible,
    present: s < 1 ? a.present && b.present : b.present,
  };
}

function stepSegments(step: SynthStep, side: Side, options: SynthOptions): Segment[] {
  const timed = (
    ms: number,
    end: (start: BodyState) => BodyState,
    holdMs = 0,
    back = false,
  ): Segment[] => {
    let before: BodyState | null = null;
    const segments: Segment[] = [
      {
        ms,
        end: (start) => {
          before = start;
          return end(start);
        },
      },
    ];
    if (holdMs > 0) segments.push({ ms: holdMs, end: (start) => start });
    if (back) segments.push({ ms, end: (start) => before ?? start });
    return segments;
  };

  switch (step.do) {
    case "still":
      return [{ ms: step.ms, end: (start) => start }];
    case "reach":
      return timed(
        step.ms,
        (start) => {
          const point = step.to === "target" ? (options.resolveTarget?.() ?? null) : step.to;
          return point ? { ...start, arm: armReaching(start, side, point) } : start;
        },
        step.holdMs,
        step.back,
      );
    case "follow":
      return [{ ms: step.ms, end: (start) => start, follow: true }];
    case "raise": {
      const plane =
        step.plane === "forward" ? 90 : step.plane === "sideways" ? 0 : Number(step.plane);
      return timed(
        step.ms,
        (start) => ({
          ...start,
          arm: armFromAngles({ elevationDeg: step.deg, planeDeg: plane, elbowDeg: 180 }, side),
        }),
        step.holdMs,
        step.back,
      );
    }
    case "elbow":
      return timed(
        step.ms,
        (start) => ({ ...start, arm: withElbow(start.arm, step.deg, side) }),
        step.holdMs,
        step.back,
      );
    case "arm":
      return timed(
        step.ms,
        (start) => ({ ...start, arm: armFromAngles(step.angles, side) }),
        step.holdMs,
        step.back,
      );
    case "hand":
      return timed(
        step.ms,
        (start) => ({ ...start, open: Math.min(1, Math.max(0, step.open)) }),
        step.holdMs,
        step.back,
      );
    case "thumbTouch": {
      const fingers = step.fingers ?? ["index", "middle", "ring", "little"];
      const half = step.msEach / 2;
      return fingers.flatMap((finger): Segment[] => [
        { ms: 1, end: (start) => ({ ...start, thumbFinger: FINGER_INDEX[finger] }) },
        { ms: half, end: (start) => ({ ...start, thumbAmount: 1 }) },
        ...(step.holdMs ? [{ ms: step.holdMs, end: (start: BodyState) => start }] : []),
        { ms: half, end: (start) => ({ ...start, thumbAmount: 0 }) },
      ]);
    }
    case "pinch":
      return [
        { ms: 1, end: (start) => ({ ...start, thumbFinger: 0 }) },
        { ms: step.ms, end: (start) => ({ ...start, thumbAmount: 1 }) },
      ];
    case "release":
      return [{ ms: step.ms, end: (start) => ({ ...start, thumbAmount: 0 }) }];
    case "lean":
      return timed(
        step.ms,
        (start) => ({
          ...start,
          leanForwardDeg: step.forwardDeg ?? start.leanForwardDeg,
          leanSidewaysDeg: step.sidewaysDeg ?? start.leanSidewaysDeg,
        }),
        step.holdMs,
        step.back,
      );
    case "hideHand":
      return [
        { ms: step.ms, end: (start) => ({ ...start, handVisible: false }) },
        { ms: 1, end: (start) => ({ ...start, handVisible: true }) },
      ];
    case "leave":
      return [
        { ms: step.ms, end: (start) => ({ ...start, present: false }) },
        { ms: 1, end: (start) => ({ ...start, present: true }) },
      ];
  }
}

/** Keeps the upper arm and sets the elbow, bending in the arm's current plane. */
function withElbow(arm: ArmPose, elbowDeg: number, side: Side): ArmPose {
  const { down, forward } = trunkAxes(side);
  let bend = reject(arm.fore, arm.upper);
  if (length(bend) < 1e-3) bend = reject(sub(forward, down), arm.upper);
  if (length(bend) < 1e-6) bend = reject(scale(down, -1), arm.upper);
  bend = unit(bend);
  const flexion = radians(180 - elbowDeg);
  return {
    upper: arm.upper,
    fore: unit(add(scale(arm.upper, Math.cos(flexion)), scale(bend, Math.sin(flexion)))),
  };
}

function segmentsDuration(script: SynthScript): number {
  return script.steps
    .flatMap((step) => stepSegments(step, script.affectedSide, {}))
    .reduce((total, segment) => total + segment.ms, 0);
}

/**
 * Plays a script in time: frameAt(ms) gives the frame due at that time. It is stateful (each
 * step is worked out when it starts, so "target" reads the game's target then); asking for an
 * earlier time than before plays the script again from the start.
 */
export class SynthPlayer {
  readonly frameMs: number;
  readonly durationMs: number;
  readonly frameWidth = SYNTH_FRAME_WIDTH;
  readonly frameHeight = SYNTH_FRAME_HEIGHT;
  private readonly script: SynthScript;
  private readonly options: SynthOptions;
  private readonly side: Side;
  private segments: Segment[] = [];
  private stepIndex = 0;
  private segment: Segment | null = null;
  private segmentStart = 0;
  private startState: BodyState;
  private endState: BodyState;
  private state: BodyState;
  private lastTime = -1;
  private random: () => number;

  constructor(script: SynthScript, options: SynthOptions = {}) {
    this.script = script;
    this.options = options;
    this.side = script.affectedSide;
    this.frameMs = 1000 / (script.fps ?? 30);
    this.durationMs = segmentsDuration(script);
    this.state = this.startState = this.endState = initialState(this.side);
    this.random = mulberry32(script.seed ?? 1);
  }

  /** The frame due at `elapsedMs` (quantised to whole frames), with its frame number. */
  frameAt(elapsedMs: number): { index: number; frame: FeedFrame } {
    // The small epsilon keeps a frame due exactly on time (500 / (1000 / 30)) from rounding down.
    const index = Math.max(0, Math.floor(elapsedMs / this.frameMs + 1e-9));
    const t = index * this.frameMs;
    let local = t;
    if (this.script.loop && this.durationMs > 0) local = t % this.durationMs;
    if (local < this.lastTime) this.restart();
    this.advanceTo(local);
    this.lastTime = local;
    return { index, frame: this.render(t) };
  }

  /** The state's joint angles are exact; this is what the next frame shows. */
  private render(t: number): FeedFrame {
    const jitter = this.script.jitterM ?? 0.0015;
    const noise = () =>
      jitter === 0
        ? v(0, 0, 0)
        : v(
            (this.random() - 0.5) * 2 * jitter,
            (this.random() - 0.5) * 2 * jitter,
            (this.random() - 0.5) * 2 * jitter,
          );
    return toFrame(this.state, this.side, t, this.script.brightness ?? 140, noise);
  }

  private restart(): void {
    this.segments = [];
    this.stepIndex = 0;
    this.segment = null;
    this.segmentStart = 0;
    this.state = this.startState = this.endState = initialState(this.side);
    this.random = mulberry32(this.script.seed ?? 1);
  }

  private nextSegment(): Segment | null {
    while (this.segments.length === 0) {
      const step = this.script.steps[this.stepIndex];
      if (!step) return null;
      this.stepIndex++;
      this.segments = stepSegments(step, this.side, this.options);
    }
    return this.segments.shift() ?? null;
  }

  private advanceTo(time: number): void {
    for (;;) {
      if (!this.segment) {
        const next = this.nextSegment();
        if (!next) return; // Done: hold the last state.
        this.segment = next;
        this.startState = this.state;
        this.endState = next.end(this.state);
      }
      const segment = this.segment;
      const end = this.segmentStart + segment.ms;
      if (segment.follow) {
        const point = this.options.resolveTarget?.() ?? null;
        if (point) {
          const aim = armReaching(this.state, this.side, point);
          // Catch up with the target over about 150 ms, like a person following it.
          const share = Math.min(1, this.frameMs / 150);
          this.state = {
            ...this.state,
            arm: {
              upper: slerp(this.state.arm.upper, aim.upper, share),
              fore: slerp(this.state.arm.fore, aim.fore, share),
            },
          };
        }
        if (time < end) return;
      } else if (time < end) {
        const share = segment.ms > 0 ? (time - this.segmentStart) / segment.ms : 1;
        this.state = interpolate(this.startState, this.endState, minimumJerk(share));
        return;
      } else {
        this.state = this.endState;
      }
      this.segmentStart = end;
      this.segment = null;
    }
  }
}

/** Every frame of a script, for checks; `resolveTarget` answers "target" steps. */
export function generateFrames(script: SynthScript, options: SynthOptions = {}): FeedFrame[] {
  const player = new SynthPlayer({ ...script, loop: false }, options);
  const count = Math.ceil(player.durationMs / player.frameMs) + 1;
  return Array.from({ length: count }, (_, index) => player.frameAt(index * player.frameMs).frame);
}
