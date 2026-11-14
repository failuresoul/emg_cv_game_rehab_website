import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/i18n";
import { formatDate, formatNumber } from "@/lib/format";
import type { AdminWarmupHistory, AdminWarmupPoint } from "@/types/api";
import { EXERCISE_ORDER, EXERCISES } from "@/warmup/exercises";
import { formatMeasure } from "@/warmup/feedback";
import { targetOf } from "@/warmup/personalise";

import { usePatientWarmup } from "./hooks";

const PRIMARY = "var(--color-primary)";
// Checked against the primary with the dataviz palette validator: clearly apart for all vision.
const ACCENT = "var(--color-accent)";
const MUTED = "var(--color-muted)";
const AXIS_FONT_SIZE = 18;
const CHART_MARGIN = { top: 12, right: 12, bottom: 8, left: 0 };
const MAX_DECISIONS = 10;

interface ChartRow {
  label: string;
  best: number | null;
  target: number;
  compensation: number;
}

function chartRows(history: AdminWarmupHistory): ChartRow[] {
  const exercise = EXERCISES[history.exercise_id];
  const digits = exercise.unit === "deg" ? 1 : 2;
  const round = (value: number) => Number(value.toFixed(digits));
  return history.points.map((point) => ({
    label: formatDate(point.date),
    best: point.best_peak === null ? null : round(point.best_peak),
    target: round(targetOf(exercise, point.thresholds)),
    compensation: Math.round(point.compensation_rate * 100),
  }));
}

const axisTick = { fill: MUTED, fontSize: AXIS_FONT_SIZE };

function BestChart({ rows, unitLabel }: { rows: ChartRow[]; unitLabel: string }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} accessibilityLayer margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} tickMargin={10} />
          <YAxis
            width={64}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            domain={["auto", "auto"]}
            label={{ value: unitLabel, angle: -90, position: "insideLeft", fill: MUTED }}
          />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="best"
            name={t("adminWarmup.best")}
            stroke={PRIMARY}
            strokeWidth={2}
            dot={{ r: 4, fill: PRIMARY }}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
          <Line
            type="stepAfter"
            dataKey="target"
            name={t("adminWarmup.target")}
            stroke={ACCENT}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CompensationChart({ rows }: { rows: ChartRow[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} accessibilityLayer margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} tickMargin={10} />
          <YAxis width={48} tick={axisTick} tickLine={false} axisLine={false} domain={[0, 100]} />
          <Tooltip cursor={{ fill: MUTED, fillOpacity: 0.08 }} />
          <Bar
            dataKey="compensation"
            name={t("adminWarmup.compensation")}
            fill={PRIMARY}
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTable({ rows, unit }: { rows: ChartRow[]; unit: (value: number) => string }) {
  const none = t("common.notSet");
  return (
    <details className="mt-2">
      <summary className="text-primary min-h-11 cursor-pointer py-2 font-medium">
        {t("adminWarmup.tableView")}
      </summary>
      <div className="overflow-x-auto">
        <table className="table-sticky w-full text-left">
          <thead>
            <tr className="border-b border-black/10">
              {(
                [
                  "adminWarmup.column.date",
                  "adminWarmup.best",
                  "adminWarmup.target",
                  "adminWarmup.compensation",
                ] as const
              ).map((key) => (
                <th key={key} scope="col" className="text-muted px-3 py-2 font-semibold">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/10">
            {rows.map((row, index) => (
              <tr key={index}>
                <td className="px-3 py-2">{row.label}</td>
                <td className="px-3 py-2 tabular-nums">
                  {row.best === null ? none : unit(row.best)}
                </td>
                <td className="px-3 py-2 tabular-nums">{unit(row.target)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {t("warmup.table.percent", { value: row.compensation })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

interface Decision {
  date: string;
  exerciseId: AdminWarmupHistory["exercise_id"];
  point: AdminWarmupPoint;
}

/** The newest personalisation decisions across every exercise. */
function latestDecisions(histories: readonly AdminWarmupHistory[]): Decision[] {
  return histories
    .flatMap((history) =>
      history.points
        .filter((point) => point.personalisation !== null)
        .map((point) => ({ date: point.date, exerciseId: history.exercise_id, point })),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_DECISIONS);
}

function DecisionsTable({ decisions }: { decisions: Decision[] }) {
  const none = t("common.notSet");
  if (decisions.length === 0) return <EmptyState title={t("adminWarmup.noDecisions")} />;
  return (
    <div className="overflow-x-auto">
      <table className="table-sticky w-full text-left">
        <thead>
          <tr className="border-b border-black/10">
            {(
              [
                "adminWarmup.column.date",
                "adminWarmup.column.exercise",
                "adminWarmup.column.previous",
                "adminWarmup.column.new",
                "adminWarmup.column.reason",
              ] as const
            ).map((key) => (
              <th key={key} scope="col" className="text-muted px-3 py-2 font-semibold">
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {decisions.map(({ date, exerciseId, point }) => {
            const exercise = EXERCISES[exerciseId];
            const decision = point.personalisation;
            if (!decision) return null;
            return (
              <tr key={`${exerciseId}-${point.session_id}`}>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(date)}</td>
                <td className="px-3 py-2">{t(exercise.nameKey)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {decision.previous_high === null
                    ? none
                    : formatMeasure(decision.previous_high, exercise.unit)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatMeasure(decision.new_high, exercise.unit)}
                </td>
                {/* Saved as a fixed English summary, so it reads the same in every language. */}
                <td className="px-3 py-2">{decision.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PatientWarmupSection({ patientId }: { patientId: number }) {
  const warmup = usePatientWarmup(patientId);
  const [chosen, setChosen] = useState<string | null>(null);

  if (warmup.isPending) return <Skeleton className="h-64" />;
  if (warmup.isError) return <QueryError onRetry={() => void warmup.refetch()} />;
  if (warmup.data.length === 0) return <EmptyState title={t("adminWarmup.empty")} />;

  const available = EXERCISE_ORDER.filter((id) =>
    warmup.data.some((history) => history.exercise_id === id),
  );
  const exerciseId = available.find((id) => id === chosen) ?? available[0];
  const history = warmup.data.find((item) => item.exercise_id === exerciseId);
  const exercise = EXERCISES[exerciseId];
  const rows = history ? chartRows(history) : [];
  const unitText = (value: number) =>
    exercise.unit === "deg" ? formatMeasure(value, "deg") : formatNumber(value, 2);

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-sm">
        <Select
          label={t("adminWarmup.exercise")}
          value={exerciseId}
          options={available.map((id) => ({ value: id, label: t(EXERCISES[id].nameKey) }))}
          onChange={(event) => setChosen(event.target.value)}
        />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-bold">{t("adminWarmup.bestTitle")}</h3>
        <BestChart rows={rows} unitLabel={t(`adminWarmup.unit.${exercise.unit}`)} />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-bold">{t("adminWarmup.compensationTitle")}</h3>
        <CompensationChart rows={rows} />
        <ChartTable rows={rows} unit={unitText} />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-bold">{t("adminWarmup.decisionsTitle")}</h3>
        <DecisionsTable decisions={latestDecisions(warmup.data)} />
      </div>
    </div>
  );
}
