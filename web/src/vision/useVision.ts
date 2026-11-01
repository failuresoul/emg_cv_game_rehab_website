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

/** Starts the camera and detection on mount and stops them on unmount. */
export function useVision({ poseEveryNthFrame }: VisionOptions = {}): UseVision {
  const status = useSyncExternalStore(visionEngine.subscribeStatus, visionEngine.getStatus);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const unsubscribe = visionEngine.subscribe(setResult);
    void visionEngine.start({ poseEveryNthFrame });
    return () => {
      unsubscribe();
      visionEngine.stop();
    };
  }, [poseEveryNthFrame, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // The last result is out of date as soon as detection is not running.
  return { status, result: status.phase === "running" ? result : null, retry };
}
