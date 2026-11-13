import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { t, type TranslationKey } from "@/i18n";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { AdminReportDetail, Rater, RatingCriterion, ReportStatus } from "@/types/api";

import { PreparingCard } from "./FeedbackSection";
import { FeedbackReportView } from "./FeedbackReportView";
import { useAdminReport, useAdminReportRatings, useRequestReport } from "./hooks";

export const STATUS_DISPLAY: Record<
  ReportStatus,
  { key: TranslationKey; variant: "neutral" | "success" | "warning" | "danger" | "muted" }
> = {
  queued: { key: "feedback.admin.status.queued", variant: "muted" },
  running: { key: "feedback.admin.status.running", variant: "neutral" },
  done: { key: "feedback.admin.status.done", variant: "success" },
  fallback: { key: "feedback.admin.status.fallback", variant: "warning" },
  failed: { key: "feedback.admin.status.failed", variant: "danger" },
};

const RATER_KEYS: Record<Rater, TranslationKey> = {
  participant: "feedback.admin.rater.participant",
  team: "feedback.admin.rater.team",
  clinician: "feedback.admin.rater.clinician",
};

const CRITERION_KEYS: Record<RatingCriterion, TranslationKey> = {
  clarity: "feedback.admin.criterion.clarity",
  usefulness: "feedback.admin.criterion.usefulness",
  accuracy: "feedback.admin.criterion.accuracy",
  tone: "feedback.admin.criterion.tone",
  safety: "feedback.admin.criterion.safety",
  helpfulness: "feedback.admin.criterion.helpfulness",
};

export function StatusBadge({ status }: { status: ReportStatus }) {
  const { key, variant } = STATUS_DISPLAY[status];
  return <Badge variant={variant}>{t(key)}</Badge>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function seconds(ms: number | null): string {
  return ms === null ? "–" : t("feedback.admin.seconds", { seconds: formatNumber(ms / 1000, 1) });
}

/** How the report was made: model, prompt, retries, template, timings and every validation
 * error, then the raw output. */
function MadeWith({ report }: { report: AdminReportDetail }) {
  const yes = t("feedback.admin.yes");
  const no = t("feedback.admin.no");
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg font-bold">{t("feedback.admin.validation")}</h3>
      <dl className="flex flex-col gap-1">
        <Row label={t("feedback.admin.model")}>{report.meta?.model ?? "–"}</Row>
        <Row label={t("feedback.admin.promptVersion")}>{report.meta?.prompt_version ?? "–"}</Row>
        <Row label={t("feedback.admin.retries")}>{report.meta?.retries ?? 0}</Row>
        <Row label={t("feedback.admin.fallback")}>{report.meta?.fallback_used ? yes : no}</Row>
        <Row label={t("feedback.admin.latency")}>{seconds(report.meta?.latency_ms ?? null)}</Row>
        <Row label={t("feedback.admin.tokens")}>
          {report.prompt_tokens ?? "–"} / {report.output_tokens ?? "–"}
        </Row>
        {report.error && <Row label={t("feedback.admin.error")}>{report.error}</Row>}
      </dl>
      <h4 className="font-bold">{t("feedback.admin.validationErrors")}</h4>
      {report.validation_errors.length === 0 ? (
        <p className="text-muted">{t("feedback.admin.noErrors")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {report.validation_errors.map((errors, index) => (
            <li key={index}>
              <p className="font-semibold">{t("feedback.admin.attempt", { number: index + 1 })}</p>
              <ul className="text-muted list-disc pl-6 text-sm">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {report.raw_output && (
        <details>
          <summary className="cursor-pointer font-semibold">
            {t("feedback.admin.rawOutput")}
          </summary>
          <pre className="bg-background mt-2 max-h-80 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
            {report.raw_output}
          </pre>
        </details>
      )}
    </Card>
  );
}

function Ratings({ jobId }: { jobId: number }) {
  const ratings = useAdminReportRatings(jobId);
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg font-bold">{t("feedback.admin.ratings")}</h3>
      {ratings.isPending && <Skeleton className="h-16 rounded-lg" />}
      {ratings.data?.length === 0 && <p className="text-muted">{t("feedback.admin.noRatings")}</p>}
      {ratings.data && ratings.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {ratings.data.map((rating) => (
            <li key={rating.id} className="rounded-lg border border-black/10 p-3">
              <p className="font-semibold">
                {t(RATER_KEYS[rating.rater])} · {formatDateTime(rating.created_at)}
              </p>
              <p>
                {Object.entries(rating.scores)
                  .map(
                    ([name, value]) => `${t(CRITERION_KEYS[name as RatingCriterion])} ${value}/5`,
                  )
                  .join(", ")}
              </p>
              {rating.comment && <p className="text-muted">{rating.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One report for admins: the patient's view, the therapist summary, how it was made, the
 * ratings, and Regenerate. */
export function AdminReportPanel({
  jobId,
  onRegenerated,
}: {
  jobId: number;
  onRegenerated?: (newJobId: number) => void;
}) {
  const report = useAdminReport(jobId);
  const regenerate = useRequestReport();
  const showToast = useToast();

  if (report.isPending) return <Skeleton className="h-72 rounded-xl" />;
  if (report.isError) {
    return (
      <Card>
        <QueryError onRetry={() => void report.refetch()} />
      </Card>
    );
  }
  const data = report.data;
  const finished = data.status === "done" || data.status === "fallback";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={data.status} />
        {data.superseded && <Badge variant="muted">{t("feedback.admin.superseded")}</Badge>}
        <span className="text-muted">{formatDateTime(data.created_at)}</span>
        <Button
          variant="secondary"
          className="ml-auto"
          loading={regenerate.isPending}
          disabled={data.status === "queued" || data.status === "running"}
          onClick={() =>
            regenerate.mutate(
              { sessionId: data.session_id, language: data.language, regenerate: true },
              {
                onSuccess: (job) => {
                  showToast("success", t("feedback.admin.regenerated"));
                  onRegenerated?.(job.job_id);
                },
              },
            )
          }
        >
          <RefreshCw size={20} aria-hidden />
          {t("feedback.admin.regenerate")}
        </Button>
      </div>
      {!finished && data.status !== "failed" && (
        <Card>
          <PreparingCard />
        </Card>
      )}
      {data.status === "failed" && (
        <Card>
          <EmptyState title={t("feedback.error")} description={data.error ?? undefined} />
        </Card>
      )}
      {finished && data.report && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <h3 className="text-lg font-bold">{t("feedback.admin.patientView")}</h3>
            <FeedbackReportView report={data.report} notices={data.safety_notices ?? []} />
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-2">
              <h3 className="text-lg font-bold">{t("feedback.admin.therapistSummary")}</h3>
              <p className="whitespace-pre-line">{data.report.therapist_summary ?? "–"}</p>
            </Card>
            <MadeWith report={data} />
            <Ratings jobId={data.job_id} />
          </div>
        </div>
      )}
    </div>
  );
}
