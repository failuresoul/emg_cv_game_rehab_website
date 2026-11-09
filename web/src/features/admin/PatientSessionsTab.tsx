import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { SessionStatusBadge } from "@/features/session/SessionStatusBadge";
import { t, type TranslationKey } from "@/i18n";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { totalScore } from "@/features/games/results";

import { usePatientSessions } from "./hooks";

const COLUMNS: TranslationKey[] = [
  "sessions.column.date",
  "sessions.column.status",
  "sessions.column.duration",
  "sessions.column.area",
  "sessions.column.warmup",
  "sessions.column.games",
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
              <td className="px-3 py-3 whitespace-nowrap">
                <Link
                  to={`/admin/sessions/${session.id}`}
                  aria-label={t("sessions.viewLabel", { date: formatDateTime(session.started_at) })}
                  className="text-primary inline-flex min-h-11 items-center gap-1 font-semibold underline"
                >
                  {formatDateTime(session.started_at)}
                  <ChevronRight size={18} aria-hidden />
                </Link>
              </td>
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
              <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                {session.warmup_summary
                  ? t("sessions.warmupValue", {
                      reps: session.warmup_summary.total_reps,
                      goals: session.warmup_summary.goals_reached,
                      total: session.warmup_summary.exercises_total,
                    })
                  : notRecorded}
              </td>
              <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                {session.games && session.games.length > 0
                  ? t("sessions.gamesValue", {
                      count: session.games.length,
                      score: formatNumber(totalScore(session.games) ?? 0, 0),
                    })
                  : notRecorded}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
