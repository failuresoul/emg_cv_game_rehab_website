import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { FinishedReport, PreparingCard } from "@/features/feedback/FeedbackSection";
import { useReport } from "@/features/feedback/hooks";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";

/** One report, laid out as on the session summary: safety notices first. */
export function PatientReportDetailPage() {
  const { jobId } = useParams();
  const id = Number(jobId);
  const report = useReport(Number.isInteger(id) && id > 0 ? id : null);
  const data = report.data;

  return (
    <>
      <Link to="/patient/reports" className={buttonClasses("ghost", "md", "mb-2 -ml-3")}>
        <ArrowLeft size={20} aria-hidden />
        {t("feedback.reports.back")}
      </Link>
      <PageHeader
        title={t("summary.feedbackTitle")}
        {...(data ? { description: formatDateTime(data.created_at) } : {})}
      />
      {report.isPending && <Skeleton className="h-72 rounded-xl" />}
      {report.isError && (
        <Card>
          {(report.error as { response?: { status?: number } }).response?.status === 404 ? (
            <EmptyState title={t("feedback.reports.notFound")} />
          ) : (
            <QueryError onRetry={() => void report.refetch()} />
          )}
        </Card>
      )}
      {data && (
        <Card>
          {data.status === "done" || data.status === "fallback" ? (
            <FinishedReport read={data} />
          ) : data.status === "failed" ? (
            <EmptyState title={t("feedback.error")} />
          ) : (
            <PreparingCard />
          )}
        </Card>
      )}
    </>
  );
}
