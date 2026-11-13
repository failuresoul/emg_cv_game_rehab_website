import { ArrowRight, FileText, HeartHandshake } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { usePatientReports } from "@/features/feedback/hooks";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { Language, PatientReportItem } from "@/types/api";

/** The language a report is written in, named in that language. */
export function LanguageBadge({ language }: { language: Language }) {
  return (
    <Badge variant="muted">
      {t(language === "bn" ? "feedback.language.bn" : "feedback.language.en")}
    </Badge>
  );
}

function ReportRow({ item }: { item: PatientReportItem }) {
  const ready = item.status === "done" || item.status === "fallback";
  return (
    <li>
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold">
            {t("feedback.reports.session", { number: item.session_no })}
          </h2>
          <span className="text-muted">{formatDateTime(item.date)}</span>
          <LanguageBadge language={item.language} />
          {item.has_safety_notice && (
            <span className="text-info flex items-center gap-1 font-semibold">
              <HeartHandshake size={20} aria-hidden />
              {t("feedback.home.notice")}
            </span>
          )}
        </div>
        <p lang={item.language} className="text-lg">
          {ready ? item.preview : t("feedback.reports.preparing")}
        </p>
        {ready && (
          <Link
            to={`/patient/reports/${item.job_id}`}
            className={buttonClasses("secondary", "md", "self-start")}
          >
            {t("feedback.reports.open")}
            <ArrowRight size={20} aria-hidden />
          </Link>
        )}
      </Card>
    </li>
  );
}

/** The patient's feedback reports, newest first. */
export function PatientReportsPage() {
  const reports = usePatientReports();
  return (
    <>
      <PageHeader title={t("page.patient.reports.title")} />
      {reports.isPending && <Skeleton className="h-40 rounded-xl" />}
      {reports.isError && (
        <Card>
          <QueryError onRetry={() => void reports.refetch()} />
        </Card>
      )}
      {reports.data && reports.data.length === 0 && (
        <Card>
          <EmptyState
            icon={FileText}
            title={t("patient.reportsPage.emptyTitle")}
            description={t("patient.reportsPage.emptyDescription")}
          />
        </Card>
      )}
      {reports.data && reports.data.length > 0 && (
        <ul className="flex flex-col gap-4">
          {reports.data.map((item) => (
            <ReportRow key={item.job_id} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}
