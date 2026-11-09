import { ReachMap, type ReachMapMarker } from "@/components/ReachMap";
import { t } from "@/i18n";
import type { PointPair, Side } from "@/types/api";

import { DIRECTION_KEYS, DIRECTIONS_DEG, reachPointsFromRadii } from "./calibration";

interface CalibrationReachMapProps {
  radii: readonly number[];
  hull: readonly PointPair[];
  affectedSide: Side;
  previousHull?: readonly PointPair[] | null;
  valid?: readonly boolean[];
  markers?: readonly ReachMapMarker[];
}

/** ReachMap for stored calibrations, with the standard directions and labels. */
export function CalibrationReachMap({
  radii,
  hull,
  affectedSide,
  previousHull,
  valid,
  markers,
}: CalibrationReachMapProps) {
  return (
    <ReachMap
      points={reachPointsFromRadii(radii)}
      hull={hull}
      directionsDeg={DIRECTIONS_DEG}
      directionLabels={DIRECTION_KEYS.map((key) => t(key))}
      affectedSide={affectedSide}
      previousHull={previousHull}
      valid={valid}
      markers={markers}
    />
  );
}
