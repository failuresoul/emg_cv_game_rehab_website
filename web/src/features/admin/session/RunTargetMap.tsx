import { Target } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { targetMarkers } from "@/features/games/results";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { t } from "@/i18n";
import type { Calibration, GameRunDetail, Side } from "@/types/api";

import { OutcomeLegend } from "./OutcomeLegend";
import { OUTCOME_STYLE } from "./outcomes";

/** One run's targets drawn on the session's reach map, by outcome; a ring marks compensation. */
export function RunTargetMap({
  run,
  calibration,
  affectedSide,
}: {
  run: GameRunDetail;
  calibration: Calibration | null;
  affectedSide: Side | null;
}) {
  if (!calibration || !affectedSide) {
    return <EmptyState icon={Target} title={t("history.noMap")} />;
  }
  const markers = targetMarkers([run]);
  return (
    <figure className="mx-auto w-full max-w-2xl">
      <figcaption className="mb-2 font-semibold">{t("adminSession.targetsTitle")}</figcaption>
      <CalibrationReachMap
        radii={calibration.reach_radii_sw}
        hull={calibration.hull_sw}
        valid={calibration.quality.valid}
        affectedSide={affectedSide}
        markers={markers.map((marker) => ({
          key: marker.key,
          x: marker.x,
          y: marker.y,
          color: OUTCOME_STYLE[marker.outcome].color,
          shape: OUTCOME_STYLE[marker.outcome].shape,
          ring: marker.compensated,
        }))}
      />
      <OutcomeLegend
        gameId={run.game_id}
        outcomes={markers.map((marker) => marker.outcome)}
        compensated={markers.some((marker) => marker.compensated)}
      />
    </figure>
  );
}
