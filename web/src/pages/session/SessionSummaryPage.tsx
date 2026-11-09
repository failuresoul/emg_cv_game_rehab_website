import { PartyPopper } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { GameRunsTable } from "@/features/games/GameRunsTable";
import { finishedRuns, totalScore } from "@/features/games/results";
import { useOwnSession, useSessionGames } from "@/features/patient/usePatientData";
import { useForgetSession, useSession } from "@/features/session/SessionContext";
import { t } from "@/i18n";
import { formatDuration, formatNumber } from "@/lib/format";

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted">{label}</dt>
      <dd className="text-3xl font-bold tabular-nums">{children}</dd>
    </div>
  );
}

/** What the session added up to, before going back home. */
export function SessionSummaryPage() {
  const navigate = useNavigate();
  const forgetSession = useForgetSession();
  const { sessionId } = useSession();
  const session = useOwnSession(sessionId === null ? "" : String(sessionId));
  const games = useSessionGames(sessionId);
  const notRecorded = t("sessions.notRecorded");

  async function goHome() {
    await navigate("/patient");
    // Forgotten only after leaving, so the next Start session begins afresh.
    forgetSession();
  }

  const isPending = session.isPending || games.isPending;
  const isError = session.isError || games.isError;
  const warmup = session.data?.warmup_summary;
  const score = games.data ? totalScore(games.data) : null;
  const runs = games.data ? finishedRuns(games.data) : [];

  return (
    <Card className="m-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <PartyPopper size={40} aria-hidden className="text-accent shrink-0" />
        <h1 className="text-2xl font-bold">{t("summary.title")}</h1>
      </div>
      {isPending && <Skeleton className="h-32" />}
      {isError && (
        <QueryError
          onRetry={() => {
            void session.refetch();
            void games.refetch();
          }}
        />
      )}
      {!isPending && !isError && (
        <dl className="grid gap-6 sm:grid-cols-3">
          <Figure label={t("summary.duration")}>
            {session.data?.duration_seconds == null
              ? notRecorded
              : formatDuration(session.data.duration_seconds)}
          </Figure>
          <Figure label={t("summary.warmupGoals")}>
            {warmup
              ? t("summary.warmupGoalsValue", {
                  done: warmup.goals_reached,
                  total: warmup.exercises_total,
                })
              : notRecorded}
          </Figure>
          <Figure label={t("summary.gameScore")}>
            {score === null ? notRecorded : formatNumber(score, 0)}
          </Figure>
        </dl>
      )}
      {runs.length > 0 && (
        <section aria-labelledby="summary-games">
          <h2 id="summary-games" className="mb-2 text-xl font-bold">
            {t("summary.gamesTitle")}
          </h2>
          <GameRunsTable runs={runs} />
        </section>
      )}
      <p>{t("summary.thanks")}</p>
      <Button size="lg" className="self-end" onClick={() => void goHome()}>
        {t("summary.home")}
      </Button>
    </Card>
  );
}
