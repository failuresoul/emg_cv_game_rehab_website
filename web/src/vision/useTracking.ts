import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/features/auth/AuthContext";

import { Tracker, type TrackingState } from "./tracking";
import { useVision } from "./useVision";
import { visionEngine, type VisionOptions } from "./visionEngine";

/** useVision plus body-frame tracking, using the affected side from the patient's profile. */
export function useTracking(options: VisionOptions = {}) {
  const vision = useVision(options);
  const { user } = useAuth();
  const affectedSide = user?.patient_profile?.affected_side;
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const trackerRef = useRef<Tracker | null>(null);

  useEffect(() => {
    if (!affectedSide) return;
    const tracker = new Tracker(affectedSide);
    trackerRef.current = tracker;
    const unsubscribe = visionEngine.subscribe((result) => setTracking(tracker.process(result)));
    return () => {
      unsubscribe();
      trackerRef.current = null;
    };
  }, [affectedSide]);

  const markTaskStart = useCallback(() => trackerRef.current?.markTaskStart(), []);

  return {
    ...vision,
    tracking: vision.status.phase === "running" ? tracking : null,
    markTaskStart,
  };
}
