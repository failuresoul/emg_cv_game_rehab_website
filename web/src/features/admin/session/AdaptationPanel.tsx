import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/Badge";
import { getLanguage, t } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { AdaptationLogRow } from "@/types/api";

import {
  adaptationPoints,
  type AdaptationPoint,
  COMPONENT_KEYS,
  type Component,
  componentsIn,
  CUE_KEYS,
  OVERRIDE_KEYS,
  type OverrideKind,
  overrideKinds,
} from "./adaptation";

const MUTED = "var(--color-muted)";
const INK = "var(--color-ink)";
const AXIS_FONT_SIZE = 16;
const COMPONENT_COLORS: Record<Component, string> = {
  spatial: "var(--color-primary)",
  activation: "var(--color-accent)",
  speed: "var(--color-info)",
  precision: "var(--color-success)",
};
/** Colour and dash of each safety flag, so they differ without colour too. */
const FLAG_STYLE: Record<OverrideKind, { color: string; dash: string }> = {
  bounds: { color: "var(--color-muted)", dash: "2 4" },
  compensation: { color: "var(--color-warning)", dash: "6 3" },
  failures: { color: "var(--color-danger)", dash: "0" },
  tiring: { color: "var(--color-info)", dash: "10 4" },
};
const dash = "–";

/** The level line's dots: filled for a success, hollow for a failure, none at the start. */
function OutcomeDot(props: { cx?: number; cy?: number; payload?: AdaptationPoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload?.outcome) return null;
  const success = payload.outcome === "success";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={success ? INK : "var(--color-surface)"}
      stroke={INK}
      strokeWidth={2}
    />
  );
}

function DecisionsTable({ logs }: { logs: readonly AdaptationLogRow[] }) {
  const columns = [
    "adminAdaptation.column.trial",
    "adminAdaptation.column.level",
    "adminAdaptation.column.decision",
    "adminAdaptation.column.override",
    "adminAdaptation.column.cue",
  ] as const;
  return (
    <div className="max-h-96 overflow-auto">
      {getLanguage() !== "en" && (
        <p className="text-muted mb-2 text-sm">{t("adminAdaptation.englishNote")}</p>
      )}
      <table className="w-full text-left">
        <thead className="bg-surface sticky top-0">
          <tr className="border-b border-black/10">
            {columns.map((key) => (
              <th
                key={key}
                scope="col"
                className="text-muted px-3 py-2 font-semibold whitespace-nowrap"
              >
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {logs.map((log) => (
            <tr key={log.trial_no}>
              <th scope="row" className="px-3 py-2 font-semibold tabular-nums">
                {log.trial_no === 0 ? t("adminAdaptation.start") : formatNumber(log.trial_no, 0)}
              </th>
              <td className="px-3 py-2 tabular-nums">{formatNumber(log.level, 0)}</td>
              <td className="px-3 py-2" lang="en">
                {log.decision}
              </td>
              <td className="px-3 py-2">
                {log.safety_override ? (
                  <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap gap-1">
                      {overrideKinds(log.safety_override).map((kind) => (
                        <Badge key={kind} variant={kind === "failures" ? "danger" : "warning"}>
                          {t(OVERRIDE_KEYS[kind])}
                        </Badge>
                      ))}
                    </span>
                    <span className="text-muted text-base" lang="en">
                      {log.safety_override}
                    </span>
                  </span>
                ) : (
                  dash
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {log.cue ? t(CUE_KEYS[log.cue]) : dash}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * How the difficulty changed during a run: each component's difficulty (0 easy to 1 hard) and
 * the level, with each trial's outcome, the safety rules that stepped in as flags, and every
 * decision with its reason.
 */
export function AdaptationPanel({ logs }: { logs: readonly AdaptationLogRow[] }) {
  if (logs.length === 0) {
    return <p className="text-muted">{t("adminAdaptation.empty")}</p>;
  }
  const points = adaptationPoints(logs);
  const components = componentsIn(logs);
  const flags = points.flatMap((point) =>
    point.overrides.map((kind) => ({ trialNo: point.trialNo, kind })),
  );
  const kinds = [...new Set(flags.map((flag) => flag.kind))];

  return (
    <section aria-label={t("adminAdaptation.title")} className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">{t("adminAdaptation.title")}</h3>
      <figure>
        <figcaption className="text-muted mb-2">{t("adminAdaptation.chartTitle")}</figcaption>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              accessibilityLayer
              margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
              <XAxis
                dataKey="trialNo"
                tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                yAxisId="d"
                width={48}
                domain={[0, 1]}
                ticks={[0, 0.25, 0.5, 0.75, 1]}
                tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="level"
                orientation="right"
                width={40}
                domain={[1, 10]}
                ticks={[1, 4, 7, 10]}
                tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                labelFormatter={(trialNo) =>
                  Number(trialNo) === 0
                    ? t("adminAdaptation.start")
                    : t("adminSession.chartTrial", { n: String(trialNo) })
                }
                formatter={(value, name) => [
                  typeof value === "number" ? formatNumber(value, 2) : String(value),
                  name,
                ]}
              />
              <Legend wrapperStyle={{ color: INK }} />
              {flags.map((flag) => (
                <ReferenceLine
                  key={`${flag.trialNo}-${flag.kind}`}
                  yAxisId="d"
                  x={flag.trialNo}
                  stroke={FLAG_STYLE[flag.kind].color}
                  strokeDasharray={FLAG_STYLE[flag.kind].dash}
                  strokeWidth={2}
                />
              ))}
              {components.map((component) => (
                <Line
                  key={component}
                  yAxisId="d"
                  type="stepAfter"
                  dataKey={component}
                  name={t(COMPONENT_KEYS[component])}
                  stroke={COMPONENT_COLORS[component]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
              <Line
                yAxisId="level"
                type="stepAfter"
                dataKey="level"
                name={t("adminAdaptation.level")}
                stroke={INK}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={<OutcomeDot />}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <ul
          className="text-muted mt-2 flex flex-wrap gap-x-6 gap-y-1 text-base"
          aria-label={t("adminAdaptation.legend")}
        >
          <li>{t("adminAdaptation.markers")}</li>
          {kinds.map((kind) => (
            <li key={kind} className="flex items-center gap-2">
              <svg width={28} height={12} aria-hidden>
                <line
                  x1={0}
                  y1={6}
                  x2={28}
                  y2={6}
                  stroke={FLAG_STYLE[kind].color}
                  strokeDasharray={FLAG_STYLE[kind].dash}
                  strokeWidth={3}
                />
              </svg>
              {t(OVERRIDE_KEYS[kind])}
            </li>
          ))}
        </ul>
      </figure>
      <DecisionsTable logs={logs} />
    </section>
  );
}
