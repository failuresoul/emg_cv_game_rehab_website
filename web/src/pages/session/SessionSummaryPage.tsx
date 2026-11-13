import {
  ArrowDownRight,
  ArrowUpRight,
  Equal,
  type LucideIcon,
  PartyPopper,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { FeedbackSection, summaryNotices } from "@/features/feedback/FeedbackSection";
import { useFeedback } from "@/features/feedback/hooks";
import { SafetyNotices } from "@/features/feedback/SafetyNotices";
import { allMeasures, percent } from "@/features/games/results";
import { useSessionReport } from "@/features/progress/hooks";
import { type Comparison, compare } from "@/features/progress/progress";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { NextFocus } from "@/features/session/NextFocus";
import { shouldShowStopNotice } from "@/features/session/questionnaire";
import { useForgetSession, useSession } from "@/features/session/SessionContext";
import { GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatDuration, formatNumber } from "@/lib/format";
import type { Language, SessionReport, SessionReportGame, Side } from "@/types/api";

const COMPARISON_DISPLAY: Record<
  Comparison | "first",
  { key: TranslationKey; icon: LucideIcon; className: string }
> = {
  better: { key: "compare.better", icon: ArrowUpRight, className: "text-success" },
  same: { key: "compare.same", icon: Equal, className: "text-primary" },
  lower: { key: "compare.lower", icon: ArrowDownRight, className: "text-muted" },
  first: { key: "compare.first", icon: Sparkles, className: "text-muted" },
};

/** One calm line on how a figure compares with last time. Nothing when there is no figure. */
function ComparisonLine({ comparison }: { comparison: Comparison | "first" | null }) {
  if (comparison === null) return null;
  const { key, icon: Icon, className } = COMPARISON_DISPLAY[comparison];
  return (
    <p className={`flex items-center gap-1.5 font-medium ${className}`}>
      <Icon size={20} aria-hidden className="shrink-0" />
      <span>{t(key)}</span>
    </p>
  );
}

/** "first" when there is a figure now but none from before. */
function comparisonOf(
  current: number | null | undefined,
  previous: number | null | undefined,
  hasPrevious: boolean,
  rule: Parameters<typeof compare>[2],
): Comparison | "first" | null {
  if (current == null) return null;
  if (!hasPrevious) return "first";
  return compare(current, previous, rule);
}

function Figure({
  label,
  children,
  comparison = null,
}: {
  label: string;
  children: ReactNode;
  comparison?: Comparison | "first" | null;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <dt className="text-muted">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="text-3xl font-bold tabular-nums">{children}</span>
        <ComparisonLine comparison={comparison} />
      </dd>
    </Card>
  );
}

function Figures({ report }: { report: SessionReport }) {
  const notRecorded = t("sessions.notRecorded");
  const { warmup, previous_warmup: previous } = report;
  const seconds = report.active_seconds > 0 ? report.active_seconds : report.duration_seconds;

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Figure label={t("summary.timeSpent")}>
        {seconds == null ? notRecorded : formatDuration(seconds)}
      </Figure>
      <Figure
        label={t("summary.warmupGoals")}
        comparison={comparisonOf(
          warmup?.goals_reached,
          previous?.goals_reached,
          previous !== null,
          "count",
        )}
      >
        {warmup
          ? t("summary.warmupGoalsValue", {
              done: warmup.goals_reached,
              total: warmup.exercises_total,
            })
          : notRecorded}
      </Figure>
      <Figure
        label={t("summary.totalReps")}
        comparison={comparisonOf(
          warmup?.total_reps,
          previous?.total_reps,
          previous !== null,
          "relative",
        )}
      >
        {warmup ? formatNumber(warmup.total_reps, 0) : notRecorded}
      </Figure>
    </dl>
  );
}

function GameCard({ game }: { game: SessionReportGame }) {
  const definition = GAMES[game.game_id];
  const Icon = definition.icon;
  const measures = allMeasures(game.game_id, game.summary);
  const rate = percent(game.success_rate);
  const notRecorded = t("sessions.notRecorded");

  return (
    <Card className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-xl font-bold">
        <Icon size={28} aria-hidden className="text-primary shrink-0" />
        {t(definition.nameKey)}
      </h3>
      {game.level_end != null && game.level_start != null && (
        <p className="font-semibold">
          {t("game.results.level", { end: game.level_end, start: game.level_start })}
        </p>
      )}
      <dl className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">{t("gameResults.column.score")}</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {game.score === null ? notRecorded : formatNumber(game.score, 0)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">{t("gameResults.column.successes")}</dt>
          <dd className="font-semibold tabular-nums">
            {game.successes === null || rate === null
              ? notRecorded
              : t("gameResults.successesRate", {
                  done: game.successes,
                  total: game.trials_done,
                  rate,
                })}
          </dd>
        </div>
        {measures.map((measure) => (
          <div key={measure.labelKey} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{t(measure.labelKey)}</dt>
            <dd className="font-semibold tabular-nums">
              {measure.value ? t(measure.value.key, measure.value.params) : notRecorded}
            </dd>
          </div>
        ))}
      </dl>
      <ComparisonLine
        comparison={comparisonOf(
          game.success_rate,
          game.previous?.success_rate,
          game.previous !== null,
          "share",
        )}
      />
    </Card>
  );
}

function ReachSection({ report, affectedSide }: { report: SessionReport; affectedSide: Side }) {
  const { reach, previous_reach: previous } = report;
  if (!reach) return null;

  return (
    <section aria-labelledby="summary-reach">
      <Card className="flex flex-col gap-2">
        <h2 id="summary-reach" className="text-xl font-bold">
          {t("summary.reachTitle")}
        </h2>
        <div className="mx-auto w-full max-w-2xl">
          <CalibrationReachMap
            radii={reach.reach_radii_sw}
            hull={reach.hull_sw}
            valid={reach.valid}
            previousHull={previous?.hull_sw}
            affectedSide={affectedSide}
          />
        </div>
        <p className="text-center text-lg font-semibold">
          {t("calibrate.result.area", { area: formatNumber(reach.hull_area_sw2) })}
        </p>
        {previous && <p className="text-muted text-center">{t("summary.reachDashed")}</p>}
        <div className="flex justify-center">
          <ComparisonLine
            comparison={comparisonOf(
              reach.hull_area_sw2,
              previous?.hull_area_sw2,
              previous !== null,
              "relative",
            )}
          />
        </div>
      </Card>
    </section>
  );
}

function Report({ report, affectedSide }: { report: SessionReport; affectedSide: Side | null }) {
  return (
    <>
      <Figures report={report} />
      <section aria-labelledby="summary-games" className="flex flex-col gap-3">
        <h2 id="summary-games" className="text-xl font-bold">
          {t("summary.gamesTitle")}
        </h2>
        {report.games.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {report.games.map((game) => (
              <GameCard key={game.run_id} game={game} />
            ))}
          </div>
        ) : (
          <p className="text-muted">{t("history.noGames")}</p>
        )}
      </section>
      {affectedSide && <ReachSection report={report} affectedSide={affectedSide} />}
    </>
  );
}

/** What the session added up to, compared with last time, before going back home. */
export function SessionSummaryPage() {
  const navigate = useNavigate();
  const forgetSession = useForgetSession();
  const { sessionId, affectedSide } = useSession();
  const report = useSessionReport(sessionId);
  // Undefined: the patient's language. The toggle asks for the other one.
  const [feedbackLanguage, setFeedbackLanguage] = useState<Language | undefined>(undefined);
  const feedback = useFeedback(sessionId, feedbackLanguage);
  // Fixed text only, first on the page: the report's notices once it is here, before that the
  // questionnaire's stop notice (pain or something new).
  const notices = summaryNotices(
    feedback.state,
    report.data && shouldShowStopNotice(report.data.flags) ? t("summary.stopNotice") : null,
  );

  async function goHome() {
    await navigate("/patient");
    // Forgotten only after leaving, so the next Start session begins afresh.
    forgetSession();
  }

  return (
    <div className="m-auto flex w-full max-w-5xl flex-col gap-6">
      <SafetyNotices notices={notices} />
      <Card className="flex items-center gap-4">
        <PartyPopper size={48} aria-hidden className="text-accent shrink-0" />
        <div>
          <h1 className="text-3xl font-bold">{t("summary.wellDone")}</h1>
          <p className="text-lg">{t("summary.thanks")}</p>
        </div>
      </Card>
      {sessionId === null && (
        <Card>
          <EmptyState title={t("history.notFound")} />
        </Card>
      )}
      {sessionId !== null && report.isPending && <Skeleton className="h-64 rounded-xl" />}
      {report.isError && (
        <Card>
          <QueryError onRetry={() => void report.refetch()} />
        </Card>
      )}
      {report.data && <Report report={report.data} affectedSide={affectedSide} />}
      {report.data && sessionId !== null && <NextFocus sessionId={sessionId} />}
      {sessionId !== null && (
        <FeedbackSection
          state={feedback.state}
          onRetry={feedback.retry}
          language={feedbackLanguage}
          onLanguage={setFeedbackLanguage}
        />
      )}
      <Button size="lg" className="self-end" onClick={() => void goHome()}>
        {t("summary.home")}
      </Button>
    </div>
  );
}
