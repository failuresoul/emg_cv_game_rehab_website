import { Target } from "lucide-react";

import { MarkerShape } from "@/components/ReachMap";
import { EmptyState } from "@/components/ui/EmptyState";
import { pickPlaceMarkers } from "@/features/games/results";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { t } from "@/i18n";
import type { Calibration, GameRunDetail, Side } from "@/types/api";

import { OutcomeLegend } from "./OutcomeLegend";
import { OUTCOME_STYLE } from "./outcomes";

const BOX_COLOR = "var(--color-accent)";

/**
 * Pick and place: where each object started, by outcome (a ring marks compensation), and where
 * its box was, on the session's reach map.
 */
export function PickPlaceMap({
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
  const trials = pickPlaceMarkers(run);
  const markers = trials.flatMap((trial) => [
    {
      key: `${trial.key}-place`,
      x: trial.place.x,
      y: trial.place.y,
      color: BOX_COLOR,
      shape: "diamond" as const,
    },
    {
      key: `${trial.key}-pick`,
      x: trial.pick.x,
      y: trial.pick.y,
      color: OUTCOME_STYLE[trial.outcome].color,
      shape: OUTCOME_STYLE[trial.outcome].shape,
      ring: trial.compensated,
    },
  ]);
  return (
    <figure className="mx-auto w-full max-w-2xl">
      <figcaption className="mb-2 font-semibold">{t("adminSession.pickPlaceTitle")}</figcaption>
      <CalibrationReachMap
        radii={calibration.reach_radii_sw}
        hull={calibration.hull_sw}
        valid={calibration.quality.valid}
        affectedSide={affectedSide}
        markers={markers}
      />
      <p className="mt-2 font-medium">{t("adminSession.series.pick")}</p>
      <OutcomeLegend
        gameId={run.game_id}
        outcomes={trials.map((trial) => trial.outcome)}
        compensated={trials.some((trial) => trial.compensated)}
      />
      {trials.length > 0 && (
        <p className="mt-2 flex items-center gap-2">
          <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
            <MarkerShape shape="diamond" x={12} y={12} size={6} color={BOX_COLOR} />
          </svg>
          {t("adminSession.series.place")}
        </p>
      )}
    </figure>
  );
}
