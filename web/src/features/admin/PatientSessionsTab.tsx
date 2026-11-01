import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { t, type TranslationKey } from "@/i18n";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";

import { usePatientSessions } from "./hooks";

const COLUMNS: TranslationKey[] = [
  "sessions.column.date",
  "sessions.column.status",
  "sessions.column.duration",
  "sessions.column.area",
];

export function PatientSessionsTab({ patientId }: { patientId: number }) {
  const sessions = usePatientSessions(patientId);

  if (sessions.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-11" />
        ))}
      </div>
    );
  }
  if (sessions.isError) return <QueryError onRetry={() => void sessions.refetch()} />;
  if (sessions.data.length === 0) {
    return <EmptyState title={t("patient.tab.emptyUntilSessions")} />;
  }

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
          {sessions.data.map((session) => (
            <tr key={session.id}>
              <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(session.started_at)}</td>
              <td className="px-3 py-3">
                <SessionStatusBadge status={session.status} />
              </td>
              <td className="px-3 py-3 whitespace-nowrap">
                {session.duration_seconds === null
                  ? notRecorded
                  : formatDuration(session.duration_seconds)}
              </td>
              <td className="px-3 py-3 tabular-nums">
                {session.hull_area_sw2 === null ? notRecorded : formatNumber(session.hull_area_sw2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
