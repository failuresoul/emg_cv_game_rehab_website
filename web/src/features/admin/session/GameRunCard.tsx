import { Gamepad2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { mainMeasure, movementSeries, percent } from "@/features/games/results";
import { RUN_QUALITY_STYLE, runQuality } from "@/features/metrics/metricDisplay";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import {
  type Calibration,
  type GameRunDetail,
  type InputSource,
  isSpatialTarget,
  type Side,
} from "@/types/api";

import { FruitStrip } from "./FruitStrip";
import { AdaptationPanel } from "./AdaptationPanel";
import { FingerHitChart, InBandChart, OpennessChart } from "./HandCharts";
import { PathTracePlot, RangeChart } from "./MovementCharts";
import { PickPlaceMap } from "./PickPlaceMap";
import { RunTargetMap } from "./RunTargetMap";
import { columnsFor } from "./trialColumns";

const PRIMARY = "var(--color-primary)";
const MUTED = "var(--color-muted)";
const AXIS_FONT_SIZE = 16;

const SOURCE_KEYS: Record<InputSource, TranslationKey> = {
  cv_grip: "game.source.webcam",
  keyboard: "game.source.keyboard",
  emg: "game.source.emg",
};

const dash = "–";

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** Movement time per trial. Trials that never reached the target leave a gap. */
function MovementChart({ run }: { run: GameRunDetail }) {
  const data = movementSeries(run.trials);
  if (!data.some((point) => point.seconds !== null)) return null;
  return (
    <figure>
      <figcaption className="mb-2 font-semibold">{t("adminSession.movementChart")}</figcaption>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
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
              width={48}
              unit=" s"
              tick={{ fill: MUTED, fontSize: AXIS_FONT_SIZE }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: MUTED, fillOpacity: 0.1 }}
              labelFormatter={(trialNo) => t("adminSession.chartTrial", { n: String(trialNo) })}
              formatter={(value) => [
                t("game.results.seconds", { value: Number(value) }),
                t("adminSession.column.movement"),
              ]}
            />
            <Bar dataKey="seconds" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/**
 * One game run: its figures, where its targets were (a reach map for reaching and raising, a
 * strip across the sideways reach for catching), every trial with the game's own columns, and
 * movement time per trial.
 */
export function GameRunCard({
  run,
  calibration,
  affectedSide,
}: {
  run: GameRunDetail;
  calibration: Calibration | null;
  affectedSide: Side | null;
}) {
  const rate = percent(run.summary?.success_rate);
  const measure = mainMeasure(run.game_id, run.summary);
  const trials = [...run.trials].sort((a, b) => a.trial_no - b.trial_no);
  const columns = columnsFor(run.game_id);
  const quality = runQuality(run.trials);

  return (
    <Card className="flex flex-col gap-4 lg:col-span-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">{t(GAMES[run.game_id].nameKey)}</h2>
        <SessionStatusBadge status={run.status} />
        <Badge>{t("adminSession.engine", { engine: run.engine })}</Badge>
        <Badge>{t(SOURCE_KEYS[run.input_source])}</Badge>
        <Badge variant={RUN_QUALITY_STYLE[quality].tone}>
          {t("dataQuality.label", { status: t(RUN_QUALITY_STYLE[quality].labelKey) })}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure
          label={t("game.results.score")}
          value={run.score === null ? dash : formatNumber(run.score, 0)}
        />
        <Figure
          label={t("game.results.successes")}
          value={
            run.summary
              ? t("gameResults.successesValue", {
                  done: run.summary.successes,
                  total: run.trials_done,
                })
              : dash
          }
        />
        <Figure
          label={t("adminSession.successRate")}
          value={rate === null ? dash : t("patient.lastSession.percent", { value: rate })}
        />
        <Figure
          label={t(measure.labelKey)}
          value={measure.value ? t(measure.value.key, measure.value.params) : dash}
        />
      </dl>

      {trials.length === 0 ? (
        <EmptyState icon={Gamepad2} title={t("adminSession.noTrials")} />
      ) : (
        <>
          {run.game_id === "fruit_catch" ? (
            <FruitStrip run={run} calibration={calibration} affectedSide={affectedSide} />
          ) : run.game_id === "pick_place" ? (
            <PickPlaceMap run={run} calibration={calibration} affectedSide={affectedSide} />
          ) : (
            // Hand games have no places to show.
            trials.some((trial) => isSpatialTarget(trial.target)) && (
              <RunTargetMap run={run} calibration={calibration} affectedSide={affectedSide} />
            )
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-black/10">
                  <th scope="col" className="text-muted px-3 py-2 font-semibold whitespace-nowrap">
                    {t("adminSession.column.no")}
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className="text-muted px-3 py-2 font-semibold whitespace-nowrap"
                    >
                      {t(column.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {trials.map((trial) => (
                  <tr key={trial.id}>
                    <th scope="row" className="px-3 py-2 font-semibold tabular-nums">
                      {formatNumber(trial.trial_no, 0)}
                    </th>
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={
                          column.numeric
                            ? "px-3 py-2 whitespace-nowrap tabular-nums"
                            : "px-3 py-2 whitespace-nowrap"
                        }
                      >
                        {column.cell(trial, run.game_id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {run.game_id === "bloom" && <OpennessChart run={run} />}
          {run.game_id === "finger_piano" && <FingerHitChart run={run} />}
          {run.game_id === "path_trace" && (
            <PathTracePlot run={run} affectedSide={affectedSide ?? "right"} />
          )}
          {run.game_id === "paint_wall" && <RangeChart run={run} />}
          {run.game_id === "grip_hold" && <InBandChart run={run} />}
          <MovementChart run={run} />
          <AdaptationPanel logs={run.adaptation ?? []} />
        </>
      )}
    </Card>
  );
}
