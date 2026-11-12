import { ListChecks } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { directionWords, movementWords, reasonText } from "@/features/session/plan";
import { GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatDate } from "@/lib/format";
import type { GameId } from "@/types/api";

import { useAdminPatientPlan } from "./hooks";

const gameName = (id: GameId) => t(GAMES[id].nameKey);

const BECAUSE: Record<string, TranslationKey> = {
  fatigue: "adminPlan.because.fatigue",
  pain: "adminPlan.because.pain",
  too_hard: "adminPlan.because.tooHard",
};

/** The patient's most recent plan with each game's reason, and any changes they made to it. */
export function LatestPlanCard({ patientId }: { patientId: number }) {
  const latest = useAdminPatientPlan(patientId);
  return (
    <section aria-labelledby="latest-plan" className="flex flex-col gap-3">
      <h2 id="latest-plan" className="text-xl font-bold">
        {t("adminPlan.title")}
      </h2>
      {latest.isPending && <Skeleton className="h-32" />}
      {latest.isError && <QueryError onRetry={() => void latest.refetch()} />}
      {latest.data && !latest.data.plan && (
        <EmptyState icon={ListChecks} title={t("adminPlan.empty")} />
      )}
      {latest.data?.plan && (
        <>
          <p className="text-muted">
            {t("adminPlan.session", {
              date: latest.data.started_at ? formatDate(latest.data.started_at) : "",
              minutes: latest.data.plan.total_minutes,
            })}
          </p>
          {(latest.data.plan.focus.movements.length > 0 ||
            latest.data.plan.focus.directions.length > 0) && (
            <p>
              <span className="font-semibold">{t("adminPlan.focus")}</span>{" "}
              {[
                ...latest.data.plan.focus.movements.map(movementWords),
                ...latest.data.plan.focus.directions.map(directionWords),
              ].join(", ")}
            </p>
          )}
          {latest.data.plan.notes.some((note) => note.key === "lighter_today") && (
            <p className="font-medium">
              {t("adminPlan.lighter", {
                because: t(
                  BECAUSE[
                    latest.data.plan.notes.find((n) => n.key === "lighter_today")?.params.because ??
                      "fatigue"
                  ] ?? BECAUSE.fatigue,
                ),
              })}
            </p>
          )}
          <ol className="flex flex-col gap-2">
            {latest.data.plan.games.map((game, index) => (
              <li key={game.game_id} className="rounded-lg border border-black/10 px-4 py-2">
                <span className="font-semibold">
                  {index + 1}. {gameName(game.game_id)}
                </span>
                <span className="text-muted">
                  {" "}
                  · {t("adminPlan.trials", { n: game.trials, minutes: game.minutes })}
                </span>
                <span className="block">{reasonText(game)}</span>
                <span className="text-muted block text-sm">
                  <code>{game.reason_key}</code>
                </span>
              </li>
            ))}
          </ol>
          <h3 className="text-lg font-semibold">{t("adminPlan.changes")}</h3>
          {latest.data.overrides.length === 0 ? (
            <p className="text-muted">{t("adminPlan.noChanges")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {latest.data.overrides.map((change) => (
                <li key={change.at} className="rounded-lg bg-black/5 px-4 py-2">
                  <span className="block">
                    {t("adminPlan.played", { games: change.games.map(gameName).join(", ") })}
                  </span>
                  {change.removed.length > 0 && (
                    <span className="block">
                      {t("adminPlan.removed", { games: change.removed.map(gameName).join(", ") })}
                    </span>
                  )}
                  {change.added.length > 0 && (
                    <span className="block">
                      {t("adminPlan.added", { games: change.added.map(gameName).join(", ") })}
                    </span>
                  )}
                  {change.reordered && <span className="block">{t("adminPlan.reordered")}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
