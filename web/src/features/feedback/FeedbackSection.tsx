import { Printer, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { t } from "@/i18n";
import type { FeedbackReportRead, Language } from "@/types/api";

import type { FeedbackState } from "./feedbackJob";
import { FeedbackReportView } from "./FeedbackReportView";
import { RatingForm } from "./RatingForm";
import { ReadAloudButton } from "./ReadAloudButton";
import { speechText } from "./readAloud";

/** A calm card with a slow breathing circle (still when reduced motion is asked for). */
export function PreparingCard() {
  return (
    <div role="status" className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="bg-primary/20 border-primary motion-safe:animate-breathe size-24 rounded-full border-4" />
      <p className="text-xl font-semibold">{t("feedback.preparing")}</p>
      <p className="text-muted">{t("feedback.preparingHint")}</p>
    </div>
  );
}

/** Read aloud, print and "Was this helpful?" under a finished report. */
export function ReportActions({ read, rate = true }: { read: FeedbackReportRead; rate?: boolean }) {
  if (!read.report) return null;
  const language: Language = read.report.language;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 print:hidden">
        <ReadAloudButton
          text={speechText(read.report, read.safety_notices ?? [])}
          language={language}
        />
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={20} aria-hidden />
          {t("feedback.print")}
        </Button>
      </div>
      {rate && <RatingForm jobId={read.job_id} />}
    </div>
  );
}

/** A finished report with its actions; the template (fallback) is shown exactly the same way. */
export function FinishedReport({
  read,
  showNotices = true,
  rate = true,
}: {
  read: FeedbackReportRead;
  showNotices?: boolean;
  rate?: boolean;
}) {
  if (!read.report) return null;
  return (
    <FeedbackReportView
      report={read.report}
      notices={read.safety_notices ?? []}
      showNotices={showNotices}
      actions={<ReportActions read={read} rate={rate} />}
    />
  );
}

/** "Your feedback" on the session summary. The safety notices are shown at the top of the page
 * instead, above everything. */
export function FeedbackSection({ state, onRetry }: { state: FeedbackState; onRetry: () => void }) {
  return (
    <Card aria-labelledby="summary-feedback" className="flex flex-col gap-4">
      <h2 id="summary-feedback" className="text-xl font-bold">
        {t("summary.feedbackTitle")}
      </h2>
      {(state.status === "preparing" || state.status === "idle") && <PreparingCard />}
      {(state.status === "ready" || state.status === "fallback") && (
        <FinishedReport read={state.read} showNotices={false} />
      )}
      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-lg">
            {t(state.reason === "timeout" ? "feedback.errorTimeout" : "feedback.error")}
          </p>
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw size={20} aria-hidden />
            {t("feedback.tryAgain")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** The safety notices to show at the top of the summary: the report's, once it is here;
 * before that, the questionnaire's stop notice when its flags call for it. */
export function summaryNotices(state: FeedbackState, stopNoticeFromFlags: string | null): string[] {
  if ((state.status === "ready" || state.status === "fallback") && state.read.safety_notices) {
    return state.read.safety_notices;
  }
  return stopNoticeFromFlags ? [stopNoticeFromFlags] : [];
}
