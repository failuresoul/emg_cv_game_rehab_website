import { Gamepad2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { MarkerShape } from "@/components/ReachMap";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { meanReachSeconds, movementSeries, percent } from "@/features/games/results";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { GameRunDetail, InputSource } from "@/types/api";

import { OUTCOME_STYLE } from "./outcomes";

const PRIMARY = "var(--color-primary)";
const MUTED = "var(--color-muted)";
const AXIS_FONT_SIZE = 16;

const COLUMNS: TranslationKey[] = [
  "adminSession.column.no",
  "adminSession.column.sector",
  "adminSession.column.outcome",
  "adminSession.column.reaction",
  "adminSession.column.movement",
  "adminSession.column.efficiency",
  "adminSession.column.latency",
  "adminSession.column.compensated",
];

const SOURCE_KEYS: Record<InputSource, TranslationKey> = {
  cv_grip: "game.source.webcam",
  keyboard: "game.source.keyboard",
  emg: "game.source.emg",
};

const COMPENSATION_KEYS: Record<string, TranslationKey> = {
  trunk: "adminSession.compensation.trunk",
  lean: "adminSession.compensation.lean",
  shoulder: "adminSession.compensation.shoulder",
};

/** "trunk+lean" as words; unknown kinds are shown as saved. */
function compensationText(type: string | null): string {
  if (!type) return t("adminSession.compensatedYes");
  return type
    .split("+")
    .map((kind) => (COMPENSATION_KEYS[kind] ? t(COMPENSATION_KEYS[kind]) : kind))
    .join(", ");
}

const dash = "–";
const ms = (value: number | null) => (value === null ? dash : formatNumber(value, 0));

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

/** One game run: its figures, every trial in a table, and movement time per trial. */
export function GameRunCard({ run }: { run: GameRunDetail }) {
  const reach = meanReachSeconds(run);
  const rate = percent(run.summary?.success_rate);
  const trials = [...run.trials].sort((a, b) => a.trial_no - b.trial_no);

  return (
    <Card className="flex flex-col gap-4 lg:col-span-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">{t(GAMES[run.game_id].nameKey)}</h2>
        <SessionStatusBadge status={run.status} />
        <Badge>{t("adminSession.engine", { engine: run.engine })}</Badge>
        <Badge>{t(SOURCE_KEYS[run.input_source])}</Badge>
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
          label={t("game.results.meanReach")}
          value={reach === null ? dash : t("game.results.seconds", { value: reach })}
        />
      </dl>

      {trials.length === 0 ? (
        <EmptyState icon={Gamepad2} title={t("adminSession.noTrials")} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-black/10">
                  {COLUMNS.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="text-muted px-3 py-2 font-semibold whitespace-nowrap"
                    >
                      {t(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {trials.map((trial) => {
                  const style = OUTCOME_STYLE[trial.outcome];
                  const efficiency = trial.metrics.path_efficiency;
                  return (
                    <tr key={trial.id}>
                      <th scope="row" className="px-3 py-2 font-semibold tabular-nums">
                        {formatNumber(trial.trial_no, 0)}
                      </th>
                      <td className="px-3 py-2">{trial.target?.sector ?? dash}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
                            <MarkerShape
                              shape={style.shape}
                              x={8}
                              y={8}
                              size={5}
                              color={style.color}
                            />
                          </svg>
                          {t(style.labelKey)}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{ms(trial.metrics.reaction_ms)}</td>
                      <td className="px-3 py-2 tabular-nums">{ms(trial.metrics.movement_ms)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {efficiency === null ? dash : formatNumber(efficiency, 2)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {ms(trial.metrics.activation_latency_ms)}
                      </td>
                      <td className="px-3 py-2">
                        {trial.compensation.flagged
                          ? compensationText(trial.compensation.type)
                          : t("adminSession.compensatedNo")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <MovementChart run={run} />
        </>
      )}
    </Card>
  );
}
