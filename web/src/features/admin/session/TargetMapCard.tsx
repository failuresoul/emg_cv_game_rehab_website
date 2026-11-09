import { Target } from "lucide-react";
import type { ReactNode } from "react";

import { MarkerShape } from "@/components/ReachMap";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { targetMarkers } from "@/features/games/results";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { t } from "@/i18n";
import type { Calibration, GameRunDetail, Side } from "@/types/api";

import { OUTCOME_ORDER, OUTCOME_STYLE } from "./outcomes";

function LegendItem({ children, swatch }: { children: string; swatch: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
        {swatch}
      </svg>
      <span>{children}</span>
    </li>
  );
}

/** The calibrated reach, with every game target of the session drawn on it. */
export function TargetMapCard({
  calibration,
  runs,
  affectedSide,
}: {
  calibration: Calibration | null;
  runs: readonly GameRunDetail[];
  affectedSide: Side | null;
}) {
  const markers = targetMarkers(runs);
  const present = OUTCOME_ORDER.filter((outcome) =>
    markers.some((marker) => marker.outcome === outcome),
  );

  return (
    <Card className="lg:col-span-2">
      <h2 className="mb-2 text-xl font-bold">{t("adminSession.mapTitle")}</h2>
      {calibration && affectedSide ? (
        <>
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
          {markers.length > 0 ? (
            <ul
              className="mt-2 flex flex-wrap gap-x-6 gap-y-2"
              aria-label={t("adminSession.legend")}
            >
              {present.map((outcome) => (
                <LegendItem
                  key={outcome}
                  swatch={
                    <MarkerShape
                      shape={OUTCOME_STYLE[outcome].shape}
                      x={12}
                      y={12}
                      size={6}
                      color={OUTCOME_STYLE[outcome].color}
                    />
                  }
                >
                  {t(OUTCOME_STYLE[outcome].labelKey)}
                </LegendItem>
              ))}
              {markers.some((marker) => marker.compensated) && (
                <LegendItem
                  swatch={
                    <circle
                      cx={12}
                      cy={12}
                      r={9}
                      fill="none"
                      stroke="var(--color-ink)"
                      strokeWidth={2}
                    />
                  }
                >
                  {t("adminSession.legendCompensated")}
                </LegendItem>
              )}
            </ul>
          ) : (
            <p className="text-muted mt-2">{t("adminSession.noTargets")}</p>
          )}
        </>
      ) : (
        <EmptyState icon={Target} title={t("history.noMap")} />
      )}
    </Card>
  );
}
