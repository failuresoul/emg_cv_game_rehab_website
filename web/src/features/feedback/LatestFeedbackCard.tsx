import { ArrowRight, HeartHandshake, Sparkles } from "lucide-react";
import { Link } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/i18n";
import { useBengaliFont } from "@/lib/bengaliFont";
import { formatDateTime } from "@/lib/format";

import { usePatientReports } from "./hooks";

/** The patient home's "Latest feedback": the start of the newest finished report. */
export function LatestFeedbackCard({ className }: { className?: string }) {
  const reports = usePatientReports();
  const latest = reports.data?.find((item) => item.status === "done" || item.status === "fallback");
  useBengaliFont(latest?.language === "bn");

  return (
    <Card className={className}>
      <h2 className="mb-2 text-xl font-bold">{t("patient.feedback.title")}</h2>
      {reports.isPending && <Skeleton className="h-24 rounded-lg" />}
      {!reports.isPending && !latest && (
        <EmptyState icon={Sparkles} title={t("patient.feedback.empty")} />
      )}
      {latest && (
        <div className="flex flex-col gap-3">
          <p className="text-muted">
            {t("feedback.reports.session", { number: latest.session_no })} ·{" "}
            {formatDateTime(latest.date)}
          </p>
          {latest.has_safety_notice && (
            <p className="text-info flex items-center gap-2 font-semibold">
              <HeartHandshake size={20} aria-hidden />
              {t("feedback.home.notice")}
            </p>
          )}
          <p lang={latest.language} className="text-lg">
            {latest.preview}
          </p>
          <Link
            to={`/patient/reports/${latest.job_id}`}
            className={buttonClasses("secondary", "md", "self-start")}
          >
            {t("feedback.home.open")}
            <ArrowRight size={20} aria-hidden />
          </Link>
        </div>
      )}
    </Card>
  );
}
