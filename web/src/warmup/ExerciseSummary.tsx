import { Star } from "lucide-react";

import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";

import type { ExerciseResult } from "./exerciseRunner";
import { EXERCISES } from "./exercises";
import { formatMeasure, starsFor } from "./feedback";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function ExerciseSummary({ result }: { result: ExerciseResult }) {
  const none = t("common.notSet");
  const exercise = EXERCISES[result.exerciseId];
  const stars = starsFor(result.fullReps, exercise.targetReps);
  const bestKey =
    exercise.text?.best === undefined ? "warmup.summary.bestAngle" : exercise.text.best;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">{t(EXERCISES[result.exerciseId].nameKey)}</h2>
      {!result.skipped && (
        <div
          role="img"
          aria-label={t("warmup.summary.stars", { count: stars })}
          className="flex gap-1"
        >
          {[1, 2, 3].map((position) => (
            <Star
              key={position}
              size={28}
              aria-hidden
              className={position <= stars ? "fill-accent text-accent" : "text-muted/40"}
            />
          ))}
        </div>
      )}
      {result.skipped ? (
        <p className="text-muted">{t("warmup.summary.skipped")}</p>
      ) : (
        <dl className="flex flex-col gap-1">
          <Row label={t("warmup.summary.fullReps")} value={formatNumber(result.fullReps, 0)} />
          <Row
            label={t("warmup.summary.partialReps")}
            value={formatNumber(result.partialReps, 0)}
          />
          {bestKey && (
            <Row
              label={t(bestKey)}
              value={
                result.bestPeak === null ? none : formatMeasure(result.bestPeak, exercise.unit)
              }
            />
          )}
          <Row
            label={t("warmup.summary.averageTime")}
            value={
              result.meanDurationMs === null
                ? none
                : t("warmup.summary.seconds", {
                    seconds: formatNumber(result.meanDurationMs / 1000, 1),
                  })
            }
          />
        </dl>
      )}
      {result.preset === "gentle" && !result.skipped && (
        <p className="text-muted">{t("warmup.summary.gentle")}</p>
      )}
    </div>
  );
}
