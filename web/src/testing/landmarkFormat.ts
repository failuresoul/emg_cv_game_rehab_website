/**
 * Landmark recordings (Day 18): what the vision engine saw, saved by the Exercise Lab's
 * "Record landmarks" and played back by the test-mode replay source. Only numbers: no image.
 *
 * Compact JSON, every number rounded to 4 decimals:
 *   { format: "muvi-landmarks", version: 1, frameWidth, frameHeight, recordedAt, frames: [
 *     { t: ms from the start, b: brightness or null,
 *       h: [ { l: [[x,y,z], ...21], w: [[x,y,z], ...21] or null, s: "Left" | "Right" | null } ],
 *       p: [[x,y,z,visibility], ...33] or null,      (pose, image)
 *       pw: [[x,y,z,visibility], ...33] or null }     (pose, world)
 *   ] }
 * About 3 kB a frame, so a 2-minute recording at 30 frames a second is about 11 MB.
 */

import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

import type { DetectedHand, VisionResult } from "@/vision/visionEngine";

import type { FeedFrame } from "./synthLandmarks";

export const RECORDING_FORMAT = "muvi-landmarks";
export const RECORDING_VERSION = 1;

type Triple = [number, number, number];
type Quad = [number, number, number, number];

export interface RecordedHand {
  l: Triple[];
  w: Triple[] | null;
  s: string | null;
}

export interface RecordedFrame {
  t: number;
  b: number | null;
  h: RecordedHand[];
  p: Quad[] | null;
  pw: Quad[] | null;
}

export interface LandmarkRecording {
  format: typeof RECORDING_FORMAT;
  version: typeof RECORDING_VERSION;
  frameWidth: number;
  frameHeight: number;
  recordedAt: string;
  frames: RecordedFrame[];
}

const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;
const triple = (p: { x: number; y: number; z: number }): Triple => [r4(p.x), r4(p.y), r4(p.z)];
const quad = (p: { x: number; y: number; z: number; visibility?: number }): Quad => [
  r4(p.x),
  r4(p.y),
  r4(p.z),
  r4(p.visibility ?? 0),
];

export function encodeFrame(result: VisionResult, startMs: number): RecordedFrame {
  return {
    t: r4(result.timestamp - startMs),
    b: result.brightness === null ? null : r4(result.brightness),
    h: result.hands.map((hand) => ({
      l: hand.landmarks.map(triple),
      w: hand.worldLandmarks ? hand.worldLandmarks.map(triple) : null,
      s: hand.handedness,
    })),
    p: result.pose ? result.pose.map(quad) : null,
    pw: result.poseWorld ? result.poseWorld.map(quad) : null,
  };
}

const fromTriple = ([x, y, z]: Triple): NormalizedLandmark => ({ x, y, z, visibility: 0 });
const fromQuad = ([x, y, z, visibility]: Quad): Landmark => ({ x, y, z, visibility });

export function decodeFrame(frame: RecordedFrame): FeedFrame {
  const hands: DetectedHand[] = frame.h.map((hand) => ({
    landmarks: hand.l.map(fromTriple),
    worldLandmarks: hand.w ? hand.w.map(fromTriple) : null,
    handedness: hand.s,
  }));
  return {
    t: frame.t,
    brightness: frame.b,
    hands,
    pose: frame.p ? frame.p.map(fromQuad) : null,
    poseWorld: frame.pw ? frame.pw.map(fromQuad) : null,
  };
}

/** Checks a parsed file; throws with the reason if it is not a recording. */
export function parseRecording(value: unknown): LandmarkRecording {
  const recording = value as Partial<LandmarkRecording> | null;
  if (!recording || recording.format !== RECORDING_FORMAT) {
    throw new Error("Not a landmark recording (format should be muvi-landmarks)");
  }
  if (recording.version !== RECORDING_VERSION) {
    throw new Error(`Unsupported landmark recording version ${String(recording.version)}`);
  }
  if (!Array.isArray(recording.frames) || recording.frames.length === 0) {
    throw new Error("The landmark recording has no frames");
  }
  let previous = -Infinity;
  for (const frame of recording.frames) {
    if (typeof frame.t !== "number" || frame.t < previous) {
      throw new Error("The landmark recording's times must not go backwards");
    }
    previous = frame.t;
  }
  return recording as LandmarkRecording;
}

/** Collects the engine's results while recording, then gives the recording. */
export class LandmarkRecorder {
  private frames: RecordedFrame[] = [];
  private startMs: number | null = null;
  private frameWidth = 640;
  private frameHeight = 480;
  private characters = 0;

  add(result: VisionResult): void {
    this.startMs ??= result.timestamp;
    this.frameWidth = result.frameWidth;
    this.frameHeight = result.frameHeight;
    const frame = encodeFrame(result, this.startMs);
    this.frames.push(frame);
    this.characters += JSON.stringify(frame).length + 1;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get durationMs(): number {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1].t : 0;
  }

  /** About how big the file will be, in bytes. */
  get approximateBytes(): number {
    return this.characters + 200;
  }

  toRecording(now = new Date()): LandmarkRecording {
    return {
      format: RECORDING_FORMAT,
      version: RECORDING_VERSION,
      frameWidth: this.frameWidth,
      frameHeight: this.frameHeight,
      recordedAt: now.toISOString(),
      frames: [...this.frames],
    };
  }
}

/** One line per frame, so a recording is still readable in a text editor. */
export function serialiseRecording(recording: LandmarkRecording): string {
  const { frames, ...header } = recording;
  const head = JSON.stringify(header).slice(0, -1);
  return `${head},"frames":[\n${frames.map((frame) => JSON.stringify(frame)).join(",\n")}\n]}\n`;
}

/**
 * Which recorded frame is due at a time since the replay started: the latest one whose time has
 * come. Looping starts again one frame interval after the last frame.
 */
export class ReplayClock {
  private readonly times: readonly number[];
  readonly loop: boolean;
  /** One loop's length: the last frame's time plus a typical frame interval. */
  readonly periodMs: number;

  constructor(times: readonly number[], loop: boolean) {
    if (times.length === 0) throw new Error("No frames to replay");
    this.times = times;
    this.loop = loop;
    const span = times[times.length - 1] - times[0];
    const interval = times.length > 1 ? span / (times.length - 1) : 33;
    this.periodMs = span + interval;
  }

  /**
   * The frame due at `elapsedMs`, and which loop it is in (0 for the first play). Without
   * looping, the last frame stays due after the end.
   */
  at(elapsedMs: number): { index: number; loop: number; ended: boolean } {
    const first = this.times[0];
    let loop = 0;
    let local = Math.max(0, elapsedMs) + first;
    const ended = !this.loop && elapsedMs > this.periodMs;
    if (this.loop) {
      loop = Math.floor(Math.max(0, elapsedMs) / this.periodMs);
      local = Math.max(0, elapsedMs) - loop * this.periodMs + first;
    }
    // Binary search: the last time <= local.
    let low = 0;
    let high = this.times.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.times[middle] <= local) low = middle;
      else high = middle - 1;
    }
    return { index: low, loop, ended };
  }
}
