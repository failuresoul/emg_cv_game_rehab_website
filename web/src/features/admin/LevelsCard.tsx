import { Gauge } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { GAMES, isGameId } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import type { EngineMode } from "@/types/api";

import { useAdminPatientLevels } from "./hooks";

const MODE_KEYS: Record<EngineMode, TranslationKey> = {
  L0: "adminLevels.mode.L0",
  L1: "adminLevels.mode.L1",
  L2: "adminLevels.mode.L2",
};

/** The patient's current difficulty level in each game, the engine that sets it, and when. */
export function LevelsCard({ patientId }: { patientId: number }) {
  const levels = useAdminPatientLevels(patientId);
  return (
    <section aria-labelledby="ai-levels" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="ai-levels" className="text-xl font-bold">
          {t("adminLevels.title")}
        </h2>
        {levels.data && <Badge>{t(MODE_KEYS[levels.data.engine_mode])}</Badge>}
      </div>
      {levels.isPending && <Skeleton className="h-32" />}
      {levels.isError && <QueryError onRetry={() => void levels.refetch()} />}
      {levels.data && levels.data.games.length === 0 && (
        <EmptyState icon={Gauge} title={t("adminLevels.empty")} />
      )}
      {levels.data && levels.data.games.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-black/10">
                {(
                  [
                    "adminLevels.column.game",
                    "adminLevels.column.level",
                    "adminLevels.column.trials",
                    "adminLevels.column.updated",
                  ] as const
                ).map((key) => (
                  <th key={key} scope="col" className="text-muted px-3 py-2 font-semibold">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {levels.data.games.map((game) => (
                <tr key={`${game.game_id}-${game.engine}`}>
                  <th scope="row" className="px-3 py-2 font-semibold">
                    {isGameId(game.game_id) ? t(GAMES[game.game_id].nameKey) : game.game_id}
                  </th>
                  <td className="px-3 py-2 text-lg font-bold tabular-nums">
                    {t("adminLevels.levelValue", { n: game.level })}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatNumber(game.trials_seen, 0)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatRelativeTime(game.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
