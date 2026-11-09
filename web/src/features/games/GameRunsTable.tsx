import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { GameRun } from "@/types/api";

import { meanReachSeconds } from "./results";

const COLUMNS: TranslationKey[] = [
  "gameResults.column.game",
  "gameResults.column.status",
  "gameResults.column.score",
  "gameResults.column.successes",
  "gameResults.column.meanReach",
];

/** One row per game played: score, targets reached and average reach time. */
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
          {runs.map((run) => {
            const reach = meanReachSeconds(run);
            return (
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
                <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                  {run.summary
                    ? t("gameResults.successesValue", {
                        done: run.summary.successes,
                        total: run.trials_done,
                      })
                    : notRecorded}
                </td>
                <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                  {reach === null ? notRecorded : t("game.results.seconds", { value: reach })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
