import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  FeedbackStateView,
  FinishedReport,
  PreparingCard,
} from "@/features/feedback/FeedbackSection";
import { useFeedback, useReport } from "@/features/feedback/hooks";
import { LanguageToggle } from "@/features/feedback/LanguageToggle";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { Language } from "@/types/api";

/** One report, laid out as on the session summary: safety notices first. */
export function PatientReportDetailPage() {
  const { jobId } = useParams();
  const id = Number(jobId);
  const report = useReport(Number.isInteger(id) && id > 0 ? id : null);
  const data = report.data;
  // The other language, when asked for: the session's report in it (written if missing).
  const [asked, setAsked] = useState<Language | null>(null);
  const other = asked !== null && data && asked !== data.language ? asked : null;
  const otherFeedback = useFeedback(
    other !== null && data ? data.session_id : null,
    other ?? undefined,
  );
  const finished = data?.status === "done" || data?.status === "fallback";

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
        <Card className="flex flex-col gap-4">
          {finished && (
            <LanguageToggle
              value={other ?? data.language}
              onChange={(language) => setAsked(language === data.language ? null : language)}
              disabled={other !== null && otherFeedback.state.status === "preparing"}
            />
          )}
          {other !== null ? (
            <FeedbackStateView
              state={otherFeedback.state}
              onRetry={otherFeedback.retry}
              showNotices
            />
          ) : finished ? (
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
