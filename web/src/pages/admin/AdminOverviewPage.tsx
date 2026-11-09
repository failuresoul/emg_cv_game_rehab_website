import { Activity, BellRing, CalendarCheck, ChevronRight, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { useAlerts, usePatients, useRecentSessions, useStats } from "@/features/admin/hooks";
import { AddPatientModal } from "@/features/admin/PatientModals";
import { PatientStatusBadge } from "@/features/admin/PatientStatusBadge";
import { type AlertToReview, ReviewAlertModal } from "@/features/admin/ReviewAlertModal";
import { QueryError } from "@/components/ui/QueryError";
import { totalScore } from "@/features/games/results";
import { SafetyFlagBadges } from "@/features/session/SafetyFlagBadges";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { t } from "@/i18n";
import { formatDateTime, formatNumber } from "@/lib/format";

const RECENT_PATIENT_COUNT = 5;
const RECENT_SESSION_COUNT = 8;

function Stats() {
  const stats = useStats();

  if (stats.isPending) {
    return (
      <>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </>
    );
  }
  if (stats.isError) {
    return (
      <Card className="sm:col-span-2 xl:col-span-4">
        <QueryError onRetry={() => void stats.refetch()} />
      </Card>
    );
  }

  return (
    <>
      <StatCard
        label={t("admin.stats.totalPatients")}
        value={stats.data.total_patients}
        icon={Users}
      />
      <StatCard
        label={t("admin.stats.activePatients")}
        value={stats.data.active_patients}
        icon={Activity}
      />
      <StatCard
        label={t("admin.stats.sessionsToday")}
        value={stats.data.sessions_today}
        icon={CalendarCheck}
      />
      <StatCard
        label={t("admin.stats.openAlerts")}
        value={stats.data.open_alerts}
        icon={BellRing}
      />
    </>
  );
}

function RecentPatients() {
  const patients = usePatients();

  if (patients.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: RECENT_PATIENT_COUNT }, (_, index) => (
          <Skeleton key={index} className="h-11" />
        ))}
      </div>
    );
  }
  if (patients.isError) return <QueryError onRetry={() => void patients.refetch()} />;
  if (patients.data.length === 0) {
    return <EmptyState title={t("patients.empty")} description={t("patients.emptyDescription")} />;
  }

  // The API lists the oldest patient first.
  const recent = patients.data.slice(-RECENT_PATIENT_COUNT).reverse();
  return (
    <ul className="divide-y divide-black/10">
      {recent.map((patient) => (
        <li key={patient.id}>
          <Link
            to={`/admin/patients/${patient.id}`}
            className="hover:bg-primary-light flex min-h-11 items-center gap-3 rounded-lg px-2 py-2"
          >
            <span className="text-primary font-semibold">{patient.patient_code}</span>
            <span className="min-w-0 flex-1 truncate">{patient.user.full_name}</span>
            <PatientStatusBadge isActive={patient.user.is_active} />
            <ChevronRight size={20} aria-hidden className="text-muted shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Alerts() {
  const alerts = useAlerts(false);
  const [reviewing, setReviewing] = useState<AlertToReview | null>(null);

  if (alerts.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-11" />
        ))}
      </div>
    );
  }
  if (alerts.isError) return <QueryError onRetry={() => void alerts.refetch()} />;
  if (alerts.data.length === 0) {
    return <EmptyState icon={BellRing} title={t("admin.alerts.empty")} />;
  }

  return (
    <>
      <ul className="divide-y divide-black/10">
        {alerts.data.map((alert) => (
          <li key={alert.session_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <Link
              to={`/admin/sessions/${alert.session_id}`}
              className="hover:bg-primary-light -ml-2 flex min-h-11 items-center gap-3 rounded-lg px-2"
            >
              <span className="text-primary font-semibold">{alert.patient_code}</span>
              <span className="text-muted whitespace-nowrap">{formatDateTime(alert.date)}</span>
            </Link>
            <div className="min-w-0 flex-1">
              <SafetyFlagBadges flags={alert.flags} />
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                setReviewing({
                  sessionId: alert.session_id,
                  patientCode: alert.patient_code,
                  date: alert.date,
                  flags: alert.flags,
                })
              }
            >
              {t("admin.alerts.markReviewed")}
            </Button>
          </li>
        ))}
      </ul>
      <ReviewAlertModal alert={reviewing} onClose={() => setReviewing(null)} />
    </>
  );
}

function RecentSessions() {
  const sessions = useRecentSessions(RECENT_SESSION_COUNT);

  if (sessions.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-11" />
        ))}
      </div>
    );
  }
  if (sessions.isError) return <QueryError onRetry={() => void sessions.refetch()} />;
  if (sessions.data.length === 0) {
    return <EmptyState icon={CalendarCheck} title={t("admin.recentSessions.empty")} />;
  }

  return (
    <ul className="divide-y divide-black/10">
      {sessions.data.map((session) => {
        const score = totalScore(session.games);
        return (
          <li key={session.id}>
            <Link
              to={`/admin/sessions/${session.id}`}
              className="hover:bg-primary-light flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2"
            >
              <span className="text-primary font-semibold">{session.patient_code}</span>
              <span className="min-w-0 flex-1 truncate">{session.patient_name}</span>
              <span className="text-muted whitespace-nowrap">
                {formatDateTime(session.started_at)}
              </span>
              <span className="tabular-nums whitespace-nowrap">
                {score === null
                  ? t("admin.recentSessions.noGames")
                  : t("admin.recentSessions.score", { score: formatNumber(score, 0) })}
              </span>
              <SessionStatusBadge status={session.status} />
              <ChevronRight size={20} aria-hidden className="text-muted shrink-0" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminOverviewPage() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t("page.admin.overview.title")}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={20} aria-hidden />
            {t("admin.addPatient")}
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stats />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xl font-bold">{t("admin.recentPatients")}</h2>
          <RecentPatients />
        </Card>
        <Card>
          <h2 className="mb-3 text-xl font-bold">{t("admin.alerts")}</h2>
          <Alerts />
        </Card>
        <Card className="xl:col-span-2">
          <h2 className="mb-3 text-xl font-bold">{t("admin.recentSessions")}</h2>
          <RecentSessions />
        </Card>
      </div>
      <AddPatientModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
