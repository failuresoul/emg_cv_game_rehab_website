import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/features/auth/AuthContext";

import { type FilteredAngles, JointAngleFilter } from "./angleFilter";
import { computeJointAngles, type JointAngles } from "./angles";
import { visionEngine } from "./visionEngine";

export interface JointAngleState {
  timestamp: number;
  /** Each measure with its quality information. Use these for saved data. */
  raw: JointAngles;
  /** Steadied values, for counting repetitions only. */
  filtered: FilteredAngles;
}

/**
 * The affected arm's angles from the running vision engine. This only listens, so something else
 * on the page, such as useTracking or useVision, must start the camera.
 * onFrame receives every frame; React may combine renders, so use it when counting or recording.
 */
export function useJointAngles(onFrame?: (state: JointAngleState) => void): JointAngleState | null {
  const status = useSyncExternalStore(visionEngine.subscribeStatus, visionEngine.getStatus);
  const { user } = useAuth();
  const affectedSide = user?.patient_profile?.affected_side;
  const [state, setState] = useState<JointAngleState | null>(null);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!affectedSide) return;
    const filter = new JointAngleFilter();
    return visionEngine.subscribe((result) => {
      const raw = computeJointAngles(result, affectedSide);
      const next = { timestamp: result.timestamp, raw, filtered: filter.add(raw) };
      setState(next);
      onFrameRef.current?.(next);
    });
  }, [affectedSide]);

  return status.phase === "running" ? state : null;
}
