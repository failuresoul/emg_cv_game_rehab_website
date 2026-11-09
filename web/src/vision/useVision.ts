import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  visionEngine,
  type VisionOptions,
  type VisionResult,
  type VisionStatus,
} from "./visionEngine";

interface UseVision {
  status: VisionStatus;
  result: VisionResult | null;
  retry: () => void;
}

export interface UseVisionOptions extends VisionOptions {
  /**
   * Keep each frame's result in React state, re-rendering the caller at camera speed. Pages that
   * draw from engine subscriptions, such as the games, turn this off.
   */
  keepResult?: boolean;
}

/** Starts the camera and detection on mount and lets go of them on unmount. */
export function useVision({
  poseEveryNthFrame,
  keepResult = true,
}: UseVisionOptions = {}): UseVision {
  const status = useSyncExternalStore(visionEngine.subscribeStatus, visionEngine.getStatus);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Without keepResult, nothing re-renders per frame: callers subscribe to the engine instead.
    const unsubscribe = keepResult ? visionEngine.subscribe(setResult) : () => undefined;
    const release = visionEngine.acquire({ poseEveryNthFrame });
    return () => {
      unsubscribe();
      release();
    };
  }, [poseEveryNthFrame, keepResult, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // The last result is out of date as soon as detection is not running.
  return { status, result: status.phase === "running" ? result : null, retry };
}
