import axios from "axios";
import { Activity, ArrowLeft, Gamepad2, SearchX, Target } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/features/auth/AuthContext";
import { GameRunSection } from "@/features/games/GameRunsTable";
import { useOwnSession, useSessionGames } from "@/features/patient/usePatientData";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { t } from "@/i18n";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { EXERCISE_ORDER } from "@/warmup/exercises";
import { rowsFromSaved } from "@/warmup/goals";
import { useSessionWarmup } from "@/warmup/warmupApi";
import { WarmupResultsTable } from "@/warmup/WarmupResultsTable";

function BackLink() {
  return (
    <Link to="/patient/history" className={buttonClasses("ghost", "md", "mb-2 -ml-3")}>
      <ArrowLeft size={20} aria-hidden />
      {t("history.back")}
    </Link>
  );
}

function WarmupCard({ sessionId }: { sessionId: number }) {
  const warmup = useSessionWarmup(sessionId);
  const order = (id: string) => EXERCISE_ORDER.indexOf(id as (typeof EXERCISE_ORDER)[number]);

  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-2 text-xl font-bold">{t("history.warmupTitle")}</h2>
      {warmup.isPending && <Skeleton className="h-48" />}
      {warmup.isError && <QueryError onRetry={() => void warmup.refetch()} />}
      {warmup.isSuccess && warmup.data.length === 0 && (
        <EmptyState icon={Activity} title={t("history.noWarmup")} />
      )}
      {warmup.isSuccess && warmup.data.length > 0 && (
        <WarmupResultsTable
          rows={rowsFromSaved(
            [...warmup.data].sort((a, b) => order(a.exercise_id) - order(b.exercise_id)),
          )}
        />
      )}
    </Card>
  );
}

function GamesCard({ sessionId }: { sessionId: number }) {
  const games = useSessionGames(sessionId);

  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-2 text-xl font-bold">{t("history.gamesTitle")}</h2>
      {games.isPending && <Skeleton className="h-32" />}
      {games.isError && <QueryError onRetry={() => void games.refetch()} />}
      {games.isSuccess && games.data.length === 0 && (
        <EmptyState icon={Gamepad2} title={t("history.noGames")} />
      )}
      {games.isSuccess && games.data.length > 0 && (
        <div className="flex flex-col divide-y divide-black/10 [&>*]:py-4 [&>*:first-child]:pt-0">
          {games.data.map((run) => (
            <GameRunSection key={run.id} run={run} />
          ))}
        </div>
      )}
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

export function PatientSessionDetailPage() {
  const { sessionId = "" } = useParams();
  const { user } = useAuth();
  const session = useOwnSession(sessionId);
  const affectedSide = user?.patient_profile?.affected_side;

  if (session.isPending) return <Skeleton className="h-96 rounded-xl" />;

  if (session.isError) {
    // 422 means the id in the address is not a number, so no such session can exist.
    const status = axios.isAxiosError(session.error) ? session.error.response?.status : undefined;
    return (
      <>
        <BackLink />
        <Card>
          {status === 404 || status === 422 ? (
            <EmptyState icon={SearchX} title={t("history.notFound")} />
          ) : (
            <QueryError onRetry={() => void session.refetch()} />
          )}
        </Card>
      </>
    );
  }

  const { calibration, duration_seconds: duration, started_at: startedAt } = session.data;
  const notRecorded = t("sessions.notRecorded");

  return (
    <>
      <BackLink />
      <PageHeader title={t("page.patient.sessionDetail.title")} />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <dl className="flex flex-col gap-4">
            <Detail label={t("sessions.column.date")}>{formatDateTime(startedAt)}</Detail>
            <Detail label={t("sessions.column.status")}>
              <SessionStatusBadge status={session.data.status} />
            </Detail>
            <Detail label={t("sessions.column.duration")}>
              {duration === null ? notRecorded : formatDuration(duration)}
            </Detail>
            <Detail label={t("sessions.column.area")}>
              {calibration ? formatNumber(calibration.hull_area_sw2) : notRecorded}
            </Detail>
          </dl>
          {duration === null && session.data.status === "aborted" && (
            <p className="text-muted mt-4">{t("history.notRecordedHint")}</p>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-2 text-xl font-bold">{t("calibrate.result.title")}</h2>
          {calibration && affectedSide ? (
            <>
              <CalibrationReachMap
                radii={calibration.reach_radii_sw}
                hull={calibration.hull_sw}
                valid={calibration.quality.valid}
                affectedSide={affectedSide}
              />
              {calibration.quality.valid.includes(false) && (
                <p className="text-muted">{t("calibrate.result.hollow")}</p>
              )}
            </>
          ) : (
            <EmptyState icon={Target} title={t("history.noMap")} />
          )}
        </Card>
        <WarmupCard sessionId={session.data.id} />
        <GamesCard sessionId={session.data.id} />
      </div>
    </>
  );
}
