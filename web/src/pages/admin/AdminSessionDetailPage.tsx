import axios from "axios";
import { Activity, ArrowLeft, SearchX, Target } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAdminSession } from "@/features/admin/hooks";
import { GameRunCard } from "@/features/admin/session/GameRunCard";
import { QuestionnaireCard } from "@/features/admin/session/QuestionnaireCard";
import { SessionMetricsCard } from "@/features/admin/session/SessionMetricsCard";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { t } from "@/i18n";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import type { AdminSessionDetail, DeviceInfo } from "@/types/api";
import { EXERCISE_ORDER } from "@/warmup/exercises";
import { rowsFromSaved } from "@/warmup/goals";
import { WarmupResultsTable } from "@/warmup/WarmupResultsTable";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function deviceText(device: DeviceInfo | null): string {
  if (!device) return t("sessions.notRecorded");
  const parts = [
    device.browser,
    device.fps == null ? null : t("adminSession.fps", { fps: formatNumber(device.fps, 0) }),
    device.delegate,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : t("sessions.notRecorded");
}

function HeaderCard({ session }: { session: AdminSessionDetail }) {
  const notRecorded = t("sessions.notRecorded");
  return (
    <Card className="lg:col-span-1">
      <dl className="flex flex-col gap-4">
        <Detail label={t("adminSession.patient")}>
          <Link to={`/admin/patients/${session.patient_id}`} className="text-primary underline">
            {session.patient_code} · {session.patient_name}
          </Link>
        </Detail>
        <Detail label={t("sessions.column.date")}>{formatDateTime(session.started_at)}</Detail>
        <Detail label={t("sessions.column.status")}>
          <SessionStatusBadge status={session.status} />
        </Detail>
        <Detail label={t("sessions.column.duration")}>
          {session.duration_seconds === null
            ? notRecorded
            : formatDuration(session.duration_seconds)}
        </Detail>
        <Detail label={t("adminSession.device")}>{deviceText(session.device_info)}</Detail>
      </dl>
    </Card>
  );
}

export function AdminSessionDetailPage() {
  const { id = "" } = useParams();
  const session = useAdminSession(id);

  if (session.isPending) return <Skeleton className="h-96 rounded-xl" />;

  if (session.isError) {
    const status = axios.isAxiosError(session.error) ? session.error.response?.status : undefined;
    return (
      <Card>
        {status === 404 || status === 422 ? (
          <EmptyState icon={SearchX} title={t("history.notFound")} />
        ) : (
          <QueryError onRetry={() => void session.refetch()} />
        )}
      </Card>
    );
  }

  const data = session.data;
  const order = (exerciseId: string) =>
    EXERCISE_ORDER.indexOf(exerciseId as (typeof EXERCISE_ORDER)[number]);
  const warmup = [...data.warmup_results].sort(
    (a, b) => order(a.exercise_id) - order(b.exercise_id),
  );

  return (
    <>
      <Link
        to={`/admin/patients/${data.patient_id}`}
        className={buttonClasses("ghost", "md", "mb-2 -ml-3")}
      >
        <ArrowLeft size={20} aria-hidden />
        {t("adminSession.backToPatient", { code: data.patient_code })}
      </Link>
      <PageHeader
        title={t("page.admin.sessionDetail.title")}
        description={t("adminSession.subtitle", {
          code: data.patient_code,
          date: formatDateTime(data.started_at),
        })}
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <HeaderCard session={data} />
        <Card className="lg:col-span-2">
          <h2 className="mb-2 text-xl font-bold">{t("calibrate.result.title")}</h2>
          {data.calibration ? (
            <div className="mx-auto max-w-2xl">
              <CalibrationReachMap
                radii={data.calibration.reach_radii_sw}
                hull={data.calibration.hull_sw}
                valid={data.calibration.quality.valid}
                affectedSide={data.calibration.affected_side}
              />
            </div>
          ) : (
            <EmptyState icon={Target} title={t("history.noMap")} />
          )}
        </Card>
        <QuestionnaireCard session={data} />
        <SessionMetricsCard rows={data.session_metrics ?? []} />
        <Card className="lg:col-span-3">
          <h2 className="mb-2 text-xl font-bold">{t("history.warmupTitle")}</h2>
          {warmup.length > 0 ? (
            <WarmupResultsTable rows={rowsFromSaved(warmup)} />
          ) : (
            <EmptyState icon={Activity} title={t("history.noWarmup")} />
          )}
        </Card>
        {data.games.length > 0 ? (
          data.games.map((run) => (
            <GameRunCard
              key={run.id}
              run={run}
              calibration={data.calibration}
              affectedSide={data.calibration?.affected_side ?? null}
            />
          ))
        ) : (
          <Card className="lg:col-span-3">
            <EmptyState title={t("history.noGames")} />
          </Card>
        )}
      </div>
    </>
  );
}
