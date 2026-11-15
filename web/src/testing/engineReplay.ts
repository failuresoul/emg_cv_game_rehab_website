/**
 * The vision engine's test-mode start (Day 18): replayed or synthetic landmarks instead of the
 * camera and MediaPipe. The engine imports this file only inside its test-mode branch, so a
 * production build has none of it.
 */

import type { VisionErrorCode, VisionResult, VisionStatus } from "@/vision/visionEngine";

import { ReplayRunner, testVisionFeed } from "./visionFeed";

export interface ReplayHooks {
  /** False once the engine has been stopped or started again. */
  isCurrent(): boolean;
  setStatus(status: VisionStatus): void;
  fail(error: VisionErrorCode): void;
  emit(result: VisionResult): void;
  /** Gives the engine the function that stops the replay. */
  setStop(stop: () => void): void;
}

/** True if a replay runs (or the start was cancelled); false to use the camera. */
export async function startTestReplay(hooks: ReplayHooks): Promise<boolean> {
  // The engine has set "camera"; only a current start may change the status after awaiting.
  let replay: boolean;
  try {
    replay = await testVisionFeed.prepare();
  } catch {
    if (hooks.isCurrent()) hooks.fail("modelsFailed");
    return true;
  }
  if (!hooks.isCurrent()) return true;
  if (!replay) return false;
  hooks.setStatus({ phase: "loading" });
  const runner = new ReplayRunner(testVisionFeed.current, (result) => {
    testVisionFeed.framesEmitted++;
    hooks.emit(result);
  });
  hooks.setStop(() => runner.stop());
  hooks.setStatus({ phase: "running" });
  runner.start();
  return true;
}
