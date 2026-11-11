import type { ReactNode } from "react";

import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { GameRun } from "@/types/api";

import { FingerHitBars } from "./FingerHitBars";
import { allMeasures, fingerHitRates, mainMeasure, percent } from "./results";

const COLUMNS: TranslationKey[] = [
  "gameResults.column.game",
  "gameResults.column.status",
  "gameResults.column.score",
  "gameResults.column.successes",
  "gameResults.column.main",
];

function successText(run: GameRun): string {
  if (!run.summary) return t("sessions.notRecorded");
  return t("gameResults.successesRate", {
    done: run.summary.successes,
    total: run.trials_done,
    rate: percent(run.summary.success_rate) ?? 0,
  });
}

function measureText(run: GameRun): ReactNode {
  const measure = mainMeasure(run.game_id, run.summary);
  return (
    <>
      <span className="text-muted block text-base">{t(measure.labelKey)}</span>
      {measure.value ? t(measure.value.key, measure.value.params) : t("sessions.notRecorded")}
    </>
  );
}

/** One row per game played: score, targets reached with the success rate, and its main measure. */
export function GameRunsTable({ runs }: { runs: readonly GameRun[] }) {
  const notRecorded = t("sessions.notRecorded");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-black/10">
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="text-muted px-3 py-3 font-semibold">
                {t(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {runs.map((run) => (
            <tr key={run.id}>
              <th scope="row" className="px-3 py-3 font-semibold">
                {t(GAMES[run.game_id].nameKey)}
              </th>
              <td className="px-3 py-3">
                <SessionStatusBadge status={run.status} />
              </td>
              <td className="px-3 py-3 tabular-nums">
                {run.score === null ? notRecorded : formatNumber(run.score, 0)}
              </td>
              <td className="px-3 py-3 whitespace-nowrap tabular-nums">{successText(run)}</td>
              <td className="px-3 py-3 tabular-nums">{measureText(run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One game as its own section: name, what it trains, and its figures. */
export function GameRunSection({ run }: { run: GameRun }) {
  const game = GAMES[run.game_id];
  const Icon = game.icon;
  const measures = allMeasures(run.game_id, run.summary);
  const notRecorded = t("sessions.notRecorded");
  return (
    <section aria-labelledby={`run-${run.id}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Icon size={28} aria-hidden className="text-primary shrink-0" />
        <h3 id={`run-${run.id}`} className="text-lg font-bold">
          {t(game.nameKey)}
        </h3>
        <SessionStatusBadge status={run.status} />
        <span className="text-muted">{t(game.movementKey)}</span>
      </div>
      <dl
        className={
          measures.length > 1
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            : "grid grid-cols-1 gap-3 sm:grid-cols-3"
        }
      >
        <div>
          <dt className="text-muted">{t("gameResults.column.score")}</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {run.score === null ? notRecorded : formatNumber(run.score, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("gameResults.column.successes")}</dt>
          <dd className="text-2xl font-bold tabular-nums">{successText(run)}</dd>
        </div>
        {measures.map((measure) => (
          <div key={measure.labelKey}>
            <dt className="text-muted">{t(measure.labelKey)}</dt>
            <dd className="text-2xl font-bold tabular-nums">
              {measure.value ? t(measure.value.key, measure.value.params) : notRecorded}
            </dd>
          </div>
        ))}
      </dl>
      {run.game_id === "finger_piano" && (
        <FingerHitBars rates={fingerHitRates(run.summary)} title={t("history.fingerBarsTitle")} />
      )}
    </section>
  );
}
