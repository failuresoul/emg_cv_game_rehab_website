import {
  Activity,
  ArrowRight,
  Camera,
  Flame,
  Gamepad2,
  type LucideIcon,
  MessageSquareText,
  Move,
  Sparkles,
  Target,
} from "lucide-react";
import { Link } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/features/auth/AuthContext";
import { percent } from "@/features/games/results";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { usePatientDashboard } from "@/features/patient/usePatientDashboard";
import { useLatestCalibration } from "@/features/patient/usePatientData";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { StartSessionButton } from "@/features/session/StartSessionButton";
import { GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { LastSession, LastWarmup, Side, TodayPlanStep } from "@/types/api";

const STEP_DISPLAY: Partial<Record<string, { labelKey: TranslationKey; icon: LucideIcon }>> = {
  camera_check: { labelKey: "patient.step.cameraCheck", icon: Camera },
  calibration: { labelKey: "patient.step.calibration", icon: Target },
  warmup: { labelKey: "patient.step.warmup", icon: Move },
  games: { labelKey: "patient.step.games", icon: Gamepad2 },
  feedback: { labelKey: "patient.step.feedback", icon: MessageSquareText },
};

function greetingKey(hour: number): TranslationKey {
  if (hour < 12) return "patient.greeting.morning";
  if (hour < 18) return "patient.greeting.afternoon";
  return "patient.greeting.evening";
}

function currentHour(): number {
  return new Date().getHours();
}

function TodayCard({ plan }: { plan: TodayPlanStep[] }) {
  const totalMinutes = plan.reduce((total, step) => total + step.minutes, 0);

  return (
    <Card className="lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-bold">{t("patient.today.title")}</h2>
        <p className="text-muted font-medium">
          {t("patient.today.total", { minutes: totalMinutes })}
        </p>
      </div>
      <ul className="mb-6 divide-y divide-black/10">
        {plan.map(({ step, minutes }) => {
          const display = STEP_DISPLAY[step];
          if (!display) return null;
          const { labelKey, icon: Icon } = display;
          return (
            <li key={step} className="flex items-center gap-3 py-3">
              <Icon size={28} aria-hidden className="text-primary shrink-0" />
              <span className="flex-1 font-medium">{t(labelKey)}</span>
              <span className="text-muted">{t("patient.today.minutes", { minutes })}</span>
            </li>
          );
        })}
      </ul>
      <StartSessionButton className="w-full text-xl" />
    </Card>
  );
}

function ReachMapCard({ affectedSide }: { affectedSide: Side }) {
  const latest = useLatestCalibration();

  return (
    <Card className="lg:col-span-2">
      <h2 className="mb-2 text-xl font-bold">{t("calibrate.result.title")}</h2>
      {latest.isPending && <Skeleton className="h-64" />}
      {latest.isError && <QueryError onRetry={() => void latest.refetch()} />}
      {latest.isSuccess && !latest.data && (
        <EmptyState icon={Target} title={t("patient.reachMap.empty")} />
      )}
      {latest.data && (
        <div className="mx-auto max-w-2xl">
          <CalibrationReachMap
            radii={latest.data.reach_radii_sw}
            hull={latest.data.hull_sw}
            valid={latest.data.quality.valid}
            affectedSide={affectedSide}
          />
          <p className="text-center font-semibold">
            {t("calibrate.result.area", { area: formatNumber(latest.data.hull_area_sw2) })}
          </p>
        </div>
      )}
    </Card>
  );
}

function WarmupStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function LastWarmupCard({ warmup }: { warmup: LastWarmup | null }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{t("patient.lastWarmup.title")}</h2>
      {warmup ? (
        <>
          <p className="text-muted">{formatDateTime(warmup.date)}</p>
          <dl className="flex flex-col gap-2">
            <WarmupStat
              label={t("patient.lastWarmup.exercises")}
              value={t("patient.lastWarmup.exercisesValue", {
                done: warmup.exercises_done,
                total: warmup.exercises_total,
              })}
            />
            <WarmupStat
              label={t("patient.lastWarmup.reps")}
              value={formatNumber(warmup.total_reps, 0)}
            />
            <WarmupStat
              label={t("patient.lastWarmup.goals")}
              value={t("patient.lastWarmup.exercisesValue", {
                done: warmup.goals_reached,
                total: warmup.exercises_total,
              })}
            />
          </dl>
          <Link
            to={`/patient/history/${warmup.session_id}`}
            className={buttonClasses("secondary", "md", "mt-auto")}
          >
            {t("patient.lastWarmup.details")}
            <ArrowRight size={20} aria-hidden />
          </Link>
        </>
      ) : (
        <EmptyState icon={Activity} title={t("patient.lastWarmup.empty")} />
      )}
    </Card>
  );
}

function LastSessionCard({ session }: { session: LastSession | null | undefined }) {
  const games = session?.games ?? [];
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{t("patient.lastSession.title")}</h2>
      {session ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted">{formatDateTime(session.date)}</p>
            <SessionStatusBadge status={session.status} />
          </div>
          {games.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {games.map((game, index) => {
                const rate = percent(game.success_rate);
                return (
                  <li key={`${game.game_id}-${index}`} className="flex flex-col gap-1">
                    <p className="font-semibold">{t(GAMES[game.game_id].nameKey)}</p>
                    <dl className="flex flex-col gap-1">
                      <WarmupStat
                        label={t("patient.lastSession.score")}
                        value={game.score === null ? "–" : formatNumber(game.score, 0)}
                      />
                      <WarmupStat
                        label={t("patient.lastSession.successRate")}
                        value={
                          rate === null ? "–" : t("patient.lastSession.percent", { value: rate })
                        }
                      />
                    </dl>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted">{t("patient.lastSession.noGames")}</p>
          )}
        </>
      ) : (
        <EmptyState icon={Gamepad2} title={t("patient.lastSession.empty")} />
      )}
    </Card>
  );
}

function StreakCard({ days }: { days: number }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 text-center">
      <Flame size={40} aria-hidden className="text-accent" />
      <h2 className="text-xl font-bold">{t("patient.streak.title")}</h2>
      <p className="text-4xl font-bold">
        {t(days === 1 ? "patient.streak.day" : "patient.streak.days", { days })}
      </p>
      {days === 0 && <p className="text-muted">{t("patient.streak.empty")}</p>}
    </Card>
  );
}

export function PatientHomePage() {
  const { user } = useAuth();
  const dashboard = usePatientDashboard();
  const firstName = user?.full_name.split(" ")[0] ?? "";
  const lastSession = dashboard.data?.last_session;

  return (
    <>
      <h1 className="mb-6 text-3xl font-bold">
        {t(greetingKey(currentHour()), { name: firstName })}
      </h1>

      {dashboard.isPending && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {dashboard.isError && (
        <Card>
          <QueryError onRetry={() => void dashboard.refetch()} />
        </Card>
      )}

      {dashboard.isSuccess && (
        <div className="grid gap-4 lg:grid-cols-3">
          <TodayCard plan={dashboard.data.today_plan} />
          <StreakCard days={dashboard.data.streak_days} />
          <ReachMapCard affectedSide={dashboard.data.profile.affected_side} />
          <LastWarmupCard warmup={dashboard.data.last_warmup} />
          <Card className="lg:col-span-2">
            <h2 className="mb-2 text-xl font-bold">{t("patient.progress.title")}</h2>
            {lastSession && (
              <p className="text-muted mb-2">
                {t("patient.progress.lastSession", { date: formatDateTime(lastSession.date) })}
              </p>
            )}
            {/* Charts for patients come later; only the admin area shows them for now. */}
            <ProgressChart
              points={[]}
              seriesName={t("patient.progress.title")}
              emptyTitle={t(lastSession ? "patient.progress.chartLater" : "patient.progress.empty")}
            />
          </Card>
          <LastSessionCard session={lastSession} />
          <Card className="lg:col-span-3">
            <h2 className="mb-2 text-xl font-bold">{t("patient.feedback.title")}</h2>
            <EmptyState icon={Sparkles} title={t("patient.feedback.empty")} />
          </Card>
        </div>
      )}
    </>
  );
}
