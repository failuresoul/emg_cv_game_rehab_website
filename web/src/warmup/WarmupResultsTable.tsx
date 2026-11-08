import { Check, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";

import { EXERCISES } from "./exercises";
import { formatMeasure } from "./feedback";
import { type ChangeVsLast, compensationLevel, shortGoal, type WarmupRow } from "./goals";
import { RangeBar } from "./RangeBar";

const LEVEL_DOT = { low: "bg-success", some: "bg-warning", high: "bg-danger" } as const;

const CHANGE: Record<ChangeVsLast, { key: TranslationKey; icon: typeof TrendingUp }> = {
  better: { key: "warmup.table.better", icon: TrendingUp },
  same: { key: "warmup.table.same", icon: Minus },
  lower: { key: "warmup.table.lower", icon: TrendingDown },
};

function BestCell({ row }: { row: WarmupRow }) {
  const exercise = EXERCISES[row.exerciseId];
  if (row.best === null) return <>{t("common.notSet")}</>;
  if (exercise.unit !== "palm_ratio") return <>{formatMeasure(row.best, exercise.unit)}</>;
  return (
    <RangeBar
      value={row.best}
      min={exercise.gauge.min}
      max={exercise.gauge.max}
      target={row.target}
      invert={exercise.direction === "down"}
    />
  );
}

function ChangeCell({ row }: { row: WarmupRow }) {
  if (row.skipped) return <>{t("common.notSet")}</>;
  if (row.change === null) return <>{t("warmup.table.first")}</>;
  const { key, icon: Icon } = CHANGE[row.change];
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={20} aria-hidden />
      {t(key)}
    </span>
  );
}

const COLUMNS: TranslationKey[] = [
  "warmup.table.exercise",
  "warmup.table.reps",
  "warmup.table.best",
  "warmup.table.goal",
  "warmup.table.reached",
  "warmup.table.compensation",
];

/** One row per exercise. "Vs last time" is shown only when there is something to compare. */
export function WarmupResultsTable({
  rows,
  showChange = false,
}: {
  rows: readonly WarmupRow[];
  showChange?: boolean;
}) {
  const columns: TranslationKey[] = showChange ? [...COLUMNS, "warmup.table.change"] : COLUMNS;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-black/10">
            {columns.map((column) => (
              <th key={column} scope="col" className="text-muted px-3 py-2 font-semibold">
                {t(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {rows.map((row) => {
            const level = compensationLevel(row.compensationRate);
            return (
              <tr key={row.exerciseId}>
                <th scope="row" className="px-3 py-2 font-medium">
                  {t(EXERCISES[row.exerciseId].nameKey)}
                </th>
                {row.skipped ? (
                  <td colSpan={columns.length - 1} className="text-muted px-3 py-2">
                    {t("warmup.table.skipped")}
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2 tabular-nums">
                      {t("warmup.table.repsValue", {
                        full: row.fullReps,
                        target: row.targetReps,
                      })}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      <BestCell row={row} />
                    </td>
                    <td className="px-3 py-2">{shortGoal(row)}</td>
                    <td className="px-3 py-2">
                      {row.goalReached ? (
                        <span className="text-success inline-flex items-center gap-1 font-semibold">
                          <Check size={20} aria-hidden />
                          {t("warmup.table.yes")}
                        </span>
                      ) : (
                        t("warmup.table.notYet")
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className={`size-3 rounded-full ${LEVEL_DOT[level]}`} />
                        {t("warmup.table.percent", {
                          value: formatNumber(row.compensationRate * 100, 0),
                        })}
                      </span>
                    </td>
                    {showChange && (
                      <td className="px-3 py-2">
                        <ChangeCell row={row} />
                      </td>
                    )}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
