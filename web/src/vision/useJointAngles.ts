import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/features/auth/AuthContext";

import { type JointAngleState, MotionMeasurer } from "./measures";
import { visionEngine } from "./visionEngine";

export type { JointAngleState } from "./measures";

/**
 * The affected arm's angles and hand measures from the running vision engine. This only listens, so something else
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
    const measurer = new MotionMeasurer(affectedSide);
    return visionEngine.subscribe((result) => {
      const next = measurer.process(result);
      setState(next);
      onFrameRef.current?.(next);
    });
  }, [affectedSide]);

  return status.phase === "running" ? state : null;
}
