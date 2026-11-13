import { FileText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { t, type TranslationKey } from "@/i18n";
import { formatDateTime, formatNumber } from "@/lib/format";

import { AdminReportPanel, StatusBadge } from "./AdminReportPanel";
import { useAdminPatientReports, useAdminSessionReport, useRequestReport } from "./hooks";

const COLUMNS: TranslationKey[] = [
  "feedback.admin.column.date",
  "feedback.admin.column.session",
  "feedback.admin.column.language",
  "feedback.admin.column.status",
  "feedback.admin.column.model",
  "feedback.admin.column.time",
  "feedback.admin.column.ratings",
  "feedback.admin.column.open",
];

/** The patient page's Reports tab: every version, newest first, and the chosen one below. */
export function AdminReportsTab({ patientId }: { patientId: number }) {
  const reports = useAdminPatientReports(patientId);
  const [chosen, setChosen] = useState<number | null>(null);

  if (reports.isPending) return <Skeleton className="h-48 rounded-xl" />;
  if (reports.isError) return <QueryError onRetry={() => void reports.refetch()} />;
  if (reports.data.length === 0) {
    return <EmptyState icon={FileText} title={t("feedback.admin.empty")} />;
  }
  const selected = chosen ?? reports.data[0]?.job_id ?? null;

  return (
    <div className="flex flex-col gap-6">
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
            {reports.data.map((item) => (
              <tr key={item.job_id} className={item.job_id === selected ? "bg-primary-light" : ""}>
                <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                <td className="px-3 py-3">
                  <Link
                    to={`/admin/sessions/${item.session_id}`}
                    className="text-primary font-semibold underline"
                  >
                    {item.session_id}
                  </Link>
                </td>
                <td className="px-3 py-3 uppercase">{item.language}</td>
                <td className="px-3 py-3">
                  <span className="flex flex-wrap gap-1">
                    <StatusBadge status={item.status} />
                    {item.superseded && (
                      <Badge variant="muted">{t("feedback.admin.superseded")}</Badge>
                    )}
                  </span>
                </td>
                <td className="px-3 py-3">{item.model ?? "–"}</td>
                <td className="px-3 py-3 tabular-nums">
                  {item.latency_ms === null
                    ? "–"
                    : t("feedback.admin.seconds", {
                        seconds: formatNumber(item.latency_ms / 1000, 1),
                      })}
                </td>
                <td className="px-3 py-3 tabular-nums">{item.ratings}</td>
                <td className="px-3 py-3">
                  <Button
                    variant="ghost"
                    aria-pressed={item.job_id === selected}
                    onClick={() => setChosen(item.job_id)}
                  >
                    {t("feedback.admin.column.open")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected !== null && (
        <AdminReportPanel key={selected} jobId={selected} onRegenerated={setChosen} />
      )}
    </div>
  );
}

/** The admin session page's report: the current one, or a button to write it. */
export function AdminSessionReportCard({ sessionId }: { sessionId: number }) {
  const report = useAdminSessionReport(sessionId);
  const request = useRequestReport();
  const [jobId, setJobId] = useState<number | null>(null);
  const current = jobId ?? report.data?.job_id ?? null;

  return (
    <Card className="flex flex-col gap-4 lg:col-span-3">
      <h2 className="text-xl font-bold">{t("feedback.admin.sessionReport")}</h2>
      {report.isPending && <Skeleton className="h-32 rounded-lg" />}
      {report.isError && <QueryError onRetry={() => void report.refetch()} />}
      {report.isSuccess && current === null && (
        <EmptyState
          icon={FileText}
          title={t("feedback.admin.noReport")}
          action={
            <Button
              loading={request.isPending}
              onClick={() =>
                request.mutate({ sessionId }, { onSuccess: (job) => setJobId(job.job_id) })
              }
            >
              {t("feedback.admin.generate")}
            </Button>
          }
        />
      )}
      {current !== null && (
        <AdminReportPanel key={current} jobId={current} onRegenerated={setJobId} />
      )}
    </Card>
  );
}
