import { useEffect, useState, useSyncExternalStore } from "react";

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
 */
export function useJointAngles(): JointAngleState | null {
  const status = useSyncExternalStore(visionEngine.subscribeStatus, visionEngine.getStatus);
  const { user } = useAuth();
  const affectedSide = user?.patient_profile?.affected_side;
  const [state, setState] = useState<JointAngleState | null>(null);

  useEffect(() => {
    if (!affectedSide) return;
    const filter = new JointAngleFilter();
    return visionEngine.subscribe((result) => {
      const raw = computeJointAngles(result, affectedSide);
      setState({ timestamp: result.timestamp, raw, filtered: filter.add(raw) });
    });
  }, [affectedSide]);

  return status.phase === "running" ? state : null;
}
