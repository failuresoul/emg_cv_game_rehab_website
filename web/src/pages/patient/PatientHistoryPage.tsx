import { ChevronRight, History } from "lucide-react";
import { Link } from "react-router";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useOwnSessions } from "@/features/patient/usePatientData";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { t } from "@/i18n";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";

function SessionList() {
  const sessions = useOwnSessions();

  if (sessions.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-16" />
        ))}
      </div>
    );
  }
  if (sessions.isError) return <QueryError onRetry={() => void sessions.refetch()} />;
  if (sessions.data.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={t("patient.historyPage.emptyTitle")}
        description={t("patient.historyPage.emptyDescription")}
      />
    );
  }

  return (
    <ul className="divide-y divide-black/10">
      {sessions.data.map((session) => {
        const date = formatDateTime(session.started_at);
        return (
          <li key={session.id}>
            <Link
              to={`/patient/history/${session.id}`}
              aria-label={t("sessions.viewLabel", { date })}
              className="hover:bg-primary-light flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg p-3"
            >
              <span className="min-w-52 font-semibold">{date}</span>
              <SessionStatusBadge status={session.status} />
              <span className="text-muted">
                {session.duration_seconds === null
                  ? t("sessions.notRecorded")
                  : formatDuration(session.duration_seconds)}
              </span>
              {session.hull_area_sw2 !== null && (
                <span className="text-muted">
                  {t("calibrate.result.area", { area: formatNumber(session.hull_area_sw2) })}
                </span>
              )}
              <ChevronRight size={22} aria-hidden className="text-muted ml-auto shrink-0" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function PatientHistoryPage() {
  return (
    <>
      <PageHeader title={t("page.patient.history.title")} />
      <Card>
        <SessionList />
      </Card>
    </>
  );
}
