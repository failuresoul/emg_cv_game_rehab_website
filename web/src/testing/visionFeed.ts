/**
 * The replay vision source (Day 18, test mode only): frames from a landmark recording or a
 * synthetic script, emitted in real time as if MediaPipe had produced them. The vision engine
 * uses it instead of the camera when one is set, so no camera access is requested.
 *
 * Chosen by ?replay=<name> (or localStorage "muvi-test-replay"): <name> is a file in
 * web/public/test-fixtures/landmarks/<name>.json, or "synth:<preset>" for a built-in script.
 * ?replayLoop=1 (or localStorage "muvi-test-replay-loop" = "1") loops a recording. The tests
 * can also switch it at any time through window.__muviTest.vision.
 */

import type { VisionResult } from "@/vision/visionEngine";

import { decodeFrame, parseRecording, ReplayClock, type LandmarkRecording } from "./landmarkFormat";
import {
  type FeedFrame,
  type SynthScript,
  SynthPlayer,
  type TargetResolver,
} from "./synthLandmarks";

export const REPLAY_PARAM = "replay";
export const REPLAY_LOOP_PARAM = "replayLoop";
export const REPLAY_STORAGE_KEY = "muvi-test-replay";
export const REPLAY_LOOP_STORAGE_KEY = "muvi-test-replay-loop";
export const FIXTURE_DIRECTORY = "/test-fixtures/landmarks";

export interface DueFrame {
  /** Changes with every new frame (including each loop), so a frame is emitted once. */
  key: number;
  frame: FeedFrame;
  /** The frame's time in the stream, from its start, in ms. */
  streamMs: number;
}

export interface FrameSource {
  readonly kind: "recording" | "synthetic";
  readonly frameWidth: number;
  readonly frameHeight: number;
  at(elapsedMs: number): DueFrame;
}

export class RecordingSource implements FrameSource {
  readonly kind = "recording" as const;
  readonly frameWidth: number;
  readonly frameHeight: number;
  private readonly frames: FeedFrame[];
  private readonly clock: ReplayClock;

  constructor(recording: LandmarkRecording, loop: boolean) {
    this.frameWidth = recording.frameWidth;
    this.frameHeight = recording.frameHeight;
    this.frames = recording.frames.map(decodeFrame);
    this.clock = new ReplayClock(
      this.frames.map((frame) => frame.t),
      loop,
    );
  }

  get frameCount(): number {
    return this.frames.length;
  }

  at(elapsedMs: number): DueFrame {
    const { index, loop } = this.clock.at(elapsedMs);
    const frame = this.frames[index];
    return {
      key: loop * this.frames.length + index,
      frame,
      streamMs: loop * this.clock.periodMs + (frame.t - this.frames[0].t),
    };
  }
}

export class SyntheticSource implements FrameSource {
  readonly kind = "synthetic" as const;
  readonly frameWidth: number;
  readonly frameHeight: number;
  private readonly player: SynthPlayer;

  constructor(script: SynthScript, resolveTarget?: TargetResolver) {
    this.player = new SynthPlayer(script, { resolveTarget });
    this.frameWidth = this.player.frameWidth;
    this.frameHeight = this.player.frameHeight;
  }

  at(elapsedMs: number): DueFrame {
    const { index, frame } = this.player.frameAt(elapsedMs);
    return { key: index, frame, streamMs: frame.t };
  }
}

export interface RunnerTimers {
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

const browserTimers: RunnerTimers = {
  now: () => performance.now(),
  setTimer: (callback, ms) => setInterval(callback, ms),
  clearTimer: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
};

/** How often the runner checks for a due frame: well under a 30 fps frame. */
const CHECK_MS = 8;
const FPS_WINDOW_MS = 1000;

/**
 * Emits each due frame once, as a VisionResult, with timestamps spaced as in the source. A new
 * source (getSource() returning another object) starts from its beginning.
 */
export class ReplayRunner {
  private readonly getSource: () => FrameSource | null;
  private readonly emit: (result: VisionResult) => void;
  private readonly timers: RunnerTimers;
  private timer: unknown = null;
  private source: FrameSource | null = null;
  private startedAt = 0;
  private lastKey = -1;
  private lastTimestamp = -Infinity;
  private fps = 0;
  private fpsWindowStart = 0;
  private fpsFrames = 0;

  constructor(
    getSource: () => FrameSource | null,
    emit: (result: VisionResult) => void,
    timers: RunnerTimers = browserTimers,
  ) {
    this.getSource = getSource;
    this.emit = emit;
    this.timers = timers;
  }

  start(): void {
    if (this.timer !== null) return;
    this.source = null;
    this.timer = this.timers.setTimer(() => this.tick(), CHECK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearTimer(this.timer);
    this.timer = null;
    this.source = null;
  }

  tick(): void {
    const source = this.getSource();
    const now = this.timers.now();
    if (source !== this.source) {
      this.source = source;
      this.startedAt = now;
      this.lastKey = -1;
      this.fpsWindowStart = now;
      this.fpsFrames = 0;
    }
    if (!source) return;
    const due = source.at(now - this.startedAt);
    if (due.key === this.lastKey) return;
    this.lastKey = due.key;

    const timestamp = Math.max(this.startedAt + due.streamMs, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    this.fpsFrames++;
    if (timestamp - this.fpsWindowStart >= FPS_WINDOW_MS) {
      this.fps = (this.fpsFrames * 1000) / (timestamp - this.fpsWindowStart);
      this.fpsWindowStart = timestamp;
      this.fpsFrames = 0;
    }
    const { frame } = due;
    this.emit({
      timestamp,
      hand: frame.hands[0]?.landmarks ?? null,
      hands: frame.hands,
      pose: frame.pose,
      poseWorld: frame.poseWorld,
      fps: this.fps,
      delegate: "GPU",
      brightness: frame.brightness,
      frameWidth: source.frameWidth,
      frameHeight: source.frameHeight,
    });
  }
}

/** Built-in scripts for ?replay=synth:<name>. */
export const SYNTH_PRESETS: Record<string, (side: "left" | "right") => SynthScript> = {
  still: (side) => ({ affectedSide: side, steps: [{ do: "still", ms: 1000 }], loop: true }),
  demo: (side) => ({
    affectedSide: side,
    loop: true,
    steps: [
      { do: "still", ms: 1000 },
      { do: "raise", plane: "forward", deg: 90, ms: 1500, holdMs: 500, back: true },
      { do: "reach", to: { x: 1, y: 0.3 }, ms: 1200, holdMs: 400, back: true },
      { do: "hand", open: 0, ms: 500, holdMs: 500 },
      { do: "hand", open: 1, ms: 500 },
    ],
  }),
};

const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

function readSetting(param: string, storageKey: string): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(param);
    if (fromUrl) return fromUrl;
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/** What "target" means in a synthetic script: the game's current point. */
const gameTarget: TargetResolver = () => window.__muviTest?.currentTarget?.pointSw ?? null;

export async function loadRecording(name: string, loop: boolean): Promise<RecordingSource> {
  if (!SAFE_NAME.test(name)) throw new Error(`Bad recording name "${name}"`);
  const response = await fetch(`${FIXTURE_DIRECTORY}/${name}.json`);
  if (!response.ok) throw new Error(`No landmark recording "${name}" (${response.status})`);
  return new RecordingSource(parseRecording(await response.json()), loop);
}

class TestVisionFeed {
  private source: FrameSource | null = null;
  private configured = false;
  /** Frames the vision engine has emitted from the replay. */
  framesEmitted = 0;

  current = (): FrameSource | null => this.source;

  get active(): boolean {
    return this.configured;
  }

  play(script: SynthScript): void {
    this.source = new SyntheticSource(script, gameTarget);
    this.configured = true;
  }

  async playRecording(name: string, loop = false): Promise<void> {
    this.source = await loadRecording(name, loop);
    this.configured = true;
  }

  clear(): void {
    this.source = null;
    this.configured = true;
  }

  /**
   * Sets the source from the page address or localStorage, the first time. True if the engine
   * should replay (a source was set by the address, or by a test before the camera started).
   */
  async prepare(): Promise<boolean> {
    if (this.configured) return true;
    const name = readSetting(REPLAY_PARAM, REPLAY_STORAGE_KEY);
    if (!name) return false;
    if (name.startsWith("synth:")) {
      const preset = SYNTH_PRESETS[name.slice("synth:".length)];
      if (!preset) throw new Error(`No synthetic preset "${name}"`);
      // ?replaySide=right for a patient whose right side is affected.
      const side = new URLSearchParams(window.location.search).get("replaySide");
      this.play(preset(side === "right" ? "right" : "left"));
      return true;
    }
    const loop = readSetting(REPLAY_LOOP_PARAM, REPLAY_LOOP_STORAGE_KEY) === "1";
    await this.playRecording(name, loop);
    return true;
  }
}

export const testVisionFeed = new TestVisionFeed();
