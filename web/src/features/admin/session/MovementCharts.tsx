import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Select } from "@/components/ui/Select";
import { rangeSeries } from "@/features/games/results";
import { t } from "@/i18n";
import type { GameRunDetail, Side } from "@/types/api";

import { pathPlotGeometry } from "./pathPlot";

const PRIMARY = "var(--color-primary)";
const INK = "var(--color-ink)";
const MUTED = "var(--color-muted)";
const AXIS_FONT_SIZE = 16;
const PLOT_WIDTH = 480;
const PLOT_HEIGHT = 320;
/** The corridor, drawn faintly behind the path. */
const CORRIDOR = "rgba(15, 92, 92, 0.12)";

/**
 * Path trace: one turn's path, with its corridor, and the fingertip's RAW path on top. A list
 * chooses the turn.
 */
export function PathTracePlot({ run, affectedSide }: { run: GameRunDetail; affectedSide: Side }) {
  const traces = [...run.trials]
    .filter((trial) => (trial.target?.points?.length ?? 0) >= 2)
    .sort((a, b) => a.trial_no - b.trial_no);
  const [chosen, setChosen] = useState<number | null>(null);
  if (traces.length === 0) return null;
  const trial = traces.find((item) => item.trial_no === chosen) ?? traces[0];
  const geometry = pathPlotGeometry(
    trial.target?.points ?? [],
    trial.trajectory,
    affectedSide,
    PLOT_WIDTH,
    PLOT_HEIGHT,
  );
  const corridor = trial.params.corridor_width_sw;
  const corridorPx =
    typeof corridor === "number" && Number.isFinite(corridor) ? corridor * geometry.scale : 0;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="font-semibold">{t("adminSession.pathPlot")}</figcaption>
      <div className="max-w-xs">
        <Select
          label={t("adminSession.pathPlotTrial")}
          value={String(trial.trial_no)}
          options={traces.map((item) => ({
            value: String(item.trial_no),
            label: t("adminSession.chartTrial", { n: String(item.trial_no) }),
          }))}
          onChange={(event) => setChosen(Number(event.target.value))}
        />
      </div>
      <svg
        viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
        className="bg-surface w-full max-w-2xl rounded-lg border border-black/10"
        role="img"
        aria-label={t("adminSession.pathPlotLabel", { n: trial.trial_no })}
      >
        {corridorPx > 0 && (
          <polyline
            points={geometry.path}
            fill="none"
            stroke={CORRIDOR}
            strokeWidth={corridorPx}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        <polyline
          points={geometry.path}
          fill="none"
          stroke={INK}
          strokeWidth={2}
          strokeDasharray="6 5"
        />
        <polyline
          points={geometry.fingertip}
          fill="none"
          stroke={PRIMARY}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {geometry.start && (
          <circle
            cx={geometry.start.x}
            cy={geometry.start.y}
            r={7}
            fill="none"
            stroke={INK}
            strokeWidth={2}
          />
        )}
      </svg>
      <ul className="flex flex-wrap gap-4 text-base">
        <li className="flex items-center gap-2">
          <svg width={28} height={10} aria-hidden>
            <line x1={0} y1={5} x2={28} y2={5} stroke={INK} strokeWidth={2} strokeDasharray="6 5" />
          </svg>
          {t("adminSession.series.path")}
        </li>
        <li className="flex items-center gap-2">
          <svg width={28} height={10} aria-hidden>
            <line x1={0} y1={5} x2={28} y2={5} stroke={PRIMARY} strokeWidth={2} />
          </svg>
          {t("adminSession.series.fingertip")}
        </li>
      </ul>
    </figure>
  );
}

/** Paint the wall: the elbow range reached in each stripe, with the range it asked for dashed. */
export function RangeChart({ run }: { run: GameRunDetail }) {
  const data = rangeSeries(run.trials);
  if (!data.some((point) => point.range !== null)) return null;
  return (
    <figure>
      <figcaption className="mb-2 font-semibold">{t("adminSession.rangeChart")}</figcaption>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
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
              width={56}
              unit="°"
              tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: MUTED, fillOpacity: 0.1 }}
              labelFormatter={(trialNo) => t("adminSession.chartTrial", { n: String(trialNo) })}
              formatter={(value, name) => [
                t("adminSession.degrees", { value: Math.round(Number(value)) }),
                name,
              ]}
            />
            <Legend wrapperStyle={{ color: INK }} />
            <Bar
              dataKey="range"
              name={t("adminSession.series.achievedRange")}
              fill={PRIMARY}
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="target"
              name={t("adminSession.series.targetRange")}
              stroke={INK}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
