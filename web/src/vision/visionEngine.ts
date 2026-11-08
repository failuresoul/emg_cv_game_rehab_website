import type {
  HandLandmarker,
  Landmark,
  NormalizedLandmark,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";

import { HAND_MODEL_URL, POSE_MODEL_URL, WASM_URL } from "./config";

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;
const FRAME_RATE = 30;
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 48;
const BRIGHTNESS_INTERVAL_MS = 1000;
const FPS_WINDOW_MS = 1000;
// A stalled download may never fail by itself, so stop waiting and show an error.
const MODEL_LOAD_TIMEOUT_MS = 120_000;

export type VisionDelegate = "GPU" | "CPU";

export type VisionErrorCode =
  | "permissionDenied"
  | "noCamera"
  | "cameraInUse"
  | "cameraLost"
  | "unsupported"
  | "modelsFailed"
  | "detectionFailed"
  | "unknown";

export type VisionStatus =
  { phase: "idle" | "camera" | "loading" | "running" } | { phase: "error"; error: VisionErrorCode };

/** One detected hand. MediaPipe's handedness can be wrong with a mirrored camera; see hand.ts. */
export interface DetectedHand {
  landmarks: NormalizedLandmark[];
  /** The same hand in 3D: metres, with the origin near the middle of the hand. */
  worldLandmarks: Landmark[] | null;
  handedness: string | null;
}

export interface VisionResult {
  timestamp: number;
  /** The first detected hand, kept for code that follows any hand. */
  hand: NormalizedLandmark[] | null;
  /** Every detected hand, up to two, so the affected one can be chosen. */
  hands: DetectedHand[];
  pose: NormalizedLandmark[] | null;
  /** The same pose in 3D: metres, with the origin between the hips. */
  poseWorld: Landmark[] | null;
  fps: number;
  delegate: VisionDelegate;
  /** Average brightness of the frame, 0-255. Stays in the browser, like the frame itself. */
  brightness: number | null;
  /** The camera's actual size, which may differ from the size requested. */
  frameWidth: number;
  frameHeight: number;
}

export interface VisionOptions {
  poseEveryNthFrame?: number;
}

interface VisionTasks {
  hand: HandLandmarker;
  pose: PoseLandmarker;
  delegate: VisionDelegate;
}

async function createTasks(): Promise<VisionTasks> {
  const { FilesetResolver, HandLandmarker, PoseLandmarker } =
    await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

  let lastError: unknown;
  for (const delegate of ["GPU", "CPU"] as const) {
    let hand: HandLandmarker | undefined;
    try {
      hand = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
        runningMode: "VIDEO",
        // Both hands, so the affected one can be picked by where it is rather than by handedness.
        numHands: 2,
      });
      const pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
        runningMode: "VIDEO",
      });
      return { hand, pose, delegate };
    } catch (error) {
      hand?.close();
      lastError = error;
    }
  }
  throw lastError;
}

function cameraErrorCode(error: unknown): VisionErrorCode {
  if (!(error instanceof DOMException)) return "unknown";
  switch (error.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "permissionDenied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "noCamera";
    case "NotReadableError":
    case "AbortError":
      return "cameraInUse";
    default:
      return "unknown";
  }
}

class VisionEngine {
  private status: VisionStatus = { phase: "idle" };
  private statusListeners = new Set<() => void>();
  private resultListeners = new Set<(result: VisionResult) => void>();

  // Models stay loaded after stop(), so the next session step starts quickly.
  private tasksPromise: Promise<VisionTasks> | null = null;

  /** Bumped by every start() and stop(), so an older start() can tell it has been cancelled. */
  private runId = 0;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private frameRequest: number | null = null;
  private sampleContext: CanvasRenderingContext2D | null = null;

  getStatus = (): VisionStatus => this.status;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  subscribe = (listener: (result: VisionResult) => void): (() => void) => {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  };

  /** Errors are reported through getStatus(), so this promise never rejects. */
  start = async ({ poseEveryNthFrame = 1 }: VisionOptions = {}): Promise<void> => {
    if (this.status.phase !== "idle" && this.status.phase !== "error") return;
    const run = ++this.runId;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail("unsupported");
      return;
    }

    this.setStatus({ phase: "camera" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          frameRate: FRAME_RATE,
          facingMode: "user",
        },
      });
    } catch (error) {
      if (run === this.runId) this.fail(cameraErrorCode(error));
      return;
    }
    if (run !== this.runId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (run === this.runId) this.fail("cameraLost");
    });

    // Never added to the page: the camera image is only read by MediaPipe and the light check.
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.video = video;

    try {
      await video.play();
    } catch {
      if (run === this.runId) this.fail("unknown");
      return;
    }
    if (run !== this.runId) return;

    this.setStatus({ phase: "loading" });
    let tasks: VisionTasks;
    try {
      tasks = await this.loadTasks();
    } catch {
      if (run === this.runId) this.fail("modelsFailed");
      return;
    }
    if (run !== this.runId) return;

    this.setStatus({ phase: "running" });
    this.runLoop(run, video, tasks, Math.max(1, Math.floor(poseEveryNthFrame)));
  };

  /** Stops the camera. Safe to call at any time. */
  stop = (): void => {
    this.runId++;
    this.releaseCamera();
    this.setStatus({ phase: "idle" });
  };

  private loadTasks(): Promise<VisionTasks> {
    if (!this.tasksPromise) {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Model download timed out")), MODEL_LOAD_TIMEOUT_MS);
      });
      this.tasksPromise = Promise.race([createTasks(), timeout]).catch((error: unknown) => {
        this.tasksPromise = null;
        throw error;
      });
    }
    return this.tasksPromise;
  }

  private runLoop(run: number, video: HTMLVideoElement, tasks: VisionTasks, poseEvery: number) {
    let lastVideoTime = -1;
    let lastTimestamp = -1;
    let frameCount = 0;
    let pose: NormalizedLandmark[] | null = null;
    let poseWorld: Landmark[] | null = null;
    let fps = 0;
    let fpsWindowStart = performance.now();
    let fpsWindowFrames = 0;
    let brightness: number | null = null;
    let lastBrightnessAt = -Infinity;

    const tick = () => {
      if (run !== this.runId) return;
      this.frameRequest = requestAnimationFrame(tick);

      // The screen usually refreshes faster than the camera; only process new frames.
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      const timestamp = Math.max(performance.now(), lastTimestamp + 1);
      lastTimestamp = timestamp;

      try {
        const detectedHands = tasks.hand.detectForVideo(video, timestamp);
        const hands = detectedHands.landmarks.map((landmarks, index) => ({
          landmarks,
          worldLandmarks: detectedHands.worldLandmarks[index] ?? null,
          handedness: detectedHands.handedness[index]?.[0]?.categoryName ?? null,
        }));
        const hand = hands[0]?.landmarks ?? null;
        if (frameCount % poseEvery === 0) {
          const detected = tasks.pose.detectForVideo(video, timestamp);
          pose = detected.landmarks[0] ?? null;
          poseWorld = detected.worldLandmarks[0] ?? null;
        }
        frameCount++;

        fpsWindowFrames++;
        const windowMs = timestamp - fpsWindowStart;
        if (windowMs >= FPS_WINDOW_MS) {
          fps = (fpsWindowFrames * 1000) / windowMs;
          fpsWindowStart = timestamp;
          fpsWindowFrames = 0;
        }

        if (timestamp - lastBrightnessAt >= BRIGHTNESS_INTERVAL_MS) {
          brightness = this.sampleBrightness(video);
          lastBrightnessAt = timestamp;
        }

        const result = {
          timestamp,
          hand,
          hands,
          pose,
          poseWorld,
          fps,
          delegate: tasks.delegate,
          brightness,
          frameWidth: video.videoWidth,
          frameHeight: video.videoHeight,
        };
        this.resultListeners.forEach((listener) => listener(result));
      } catch {
        this.fail("detectionFailed");
      }
    };
    tick();
  }

  private sampleBrightness(video: HTMLVideoElement): number | null {
    if (!this.sampleContext) {
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_WIDTH;
      canvas.height = SAMPLE_HEIGHT;
      this.sampleContext = canvas.getContext("2d", { willReadFrequently: true });
    }
    const context = this.sampleContext;
    if (!context) return null;

    context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const { data } = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return total / (SAMPLE_WIDTH * SAMPLE_HEIGHT);
  }

  private fail(error: VisionErrorCode): void {
    this.runId++;
    this.releaseCamera();
    this.setStatus({ phase: "error", error });
  }

  private releaseCamera(): void {
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }

  private setStatus(status: VisionStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener());
  }
}

export const visionEngine = new VisionEngine();
