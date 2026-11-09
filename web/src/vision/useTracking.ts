import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/features/auth/AuthContext";

import { Tracker, type TrackingState } from "./tracking";
import { useVision, type UseVisionOptions } from "./useVision";
import { visionEngine } from "./visionEngine";

type TrackingListener = (state: TrackingState) => void;

/**
 * useVision plus body-frame tracking, using the affected side from the patient's profile. With
 * keepResult false, neither the frame nor the tracking state is kept in React state, so the
 * caller does not re-render at camera speed; it reads frames through subscribeTracking.
 */
export function useTracking(options: UseVisionOptions = {}) {
  const keepState = options.keepResult ?? true;
  const vision = useVision(options);
  const { user } = useAuth();
  const affectedSide = user?.patient_profile?.affected_side;
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const listenersRef = useRef(new Set<TrackingListener>());

  useEffect(() => {
    if (!affectedSide) return;
    const tracker = new Tracker(affectedSide);
    trackerRef.current = tracker;
    const listeners = listenersRef.current;
    const unsubscribe = visionEngine.subscribe((result) => {
      const state = tracker.process(result);
      if (keepState) setTracking(state);
      listeners.forEach((listener) => listener(state));
    });
    return () => {
      unsubscribe();
      trackerRef.current = null;
    };
  }, [affectedSide, keepState]);

  const markTaskStart = useCallback(() => trackerRef.current?.markTaskStart(), []);

  /** Receives every frame. React may combine renders, so use this when recording data. */
  const subscribeTracking = useCallback((listener: TrackingListener) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    ...vision,
    tracking: vision.status.phase === "running" ? tracking : null,
    markTaskStart,
    subscribeTracking,
  };
}
