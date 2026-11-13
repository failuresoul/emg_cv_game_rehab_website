import { Printer, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { t } from "@/i18n";
import type { FeedbackReportRead, Language } from "@/types/api";

import type { FeedbackState } from "./feedbackJob";
import { FeedbackReportView } from "./FeedbackReportView";
import { LanguageToggle } from "./LanguageToggle";
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

/** A report request in any state: preparing, the report (the template looks the same), or an
 * error with Try again. */
export function FeedbackStateView({
  state,
  onRetry,
  showNotices,
}: {
  state: FeedbackState;
  onRetry: () => void;
  showNotices: boolean;
}) {
  if (state.status === "ready" || state.status === "fallback") {
    // Keyed by report, so switching language starts a fresh rating form.
    return <FinishedReport key={state.read.job_id} read={state.read} showNotices={showNotices} />;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-lg">
          {t(state.reason === "timeout" ? "feedback.errorTimeout" : "feedback.error")}
        </p>
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={20} aria-hidden />
          {t("feedback.tryAgain")}
        </Button>
      </div>
    );
  }
  return <PreparingCard />;
}

/** The language a request is about: the one asked for, else the finished report's. */
export function shownLanguage(state: FeedbackState, asked: Language | undefined): Language | null {
  if (asked) return asked;
  if (state.status === "ready" || state.status === "fallback") return state.read.language;
  return null;
}

/** "Your feedback" on the session summary, with English / বাংলা. The safety notices are shown
 * at the top of the page instead, above everything. */
export function FeedbackSection({
  state,
  onRetry,
  language,
  onLanguage,
}: {
  state: FeedbackState;
  onRetry: () => void;
  language?: Language | undefined;
  onLanguage?: (language: Language) => void;
}) {
  const shown = shownLanguage(state, language);
  return (
    <Card aria-labelledby="summary-feedback" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="summary-feedback" className="text-xl font-bold">
          {t("summary.feedbackTitle")}
        </h2>
        {shown && onLanguage && (
          <LanguageToggle
            value={shown}
            onChange={onLanguage}
            disabled={state.status === "preparing"}
          />
        )}
      </div>
      <FeedbackStateView state={state} onRetry={onRetry} showNotices={false} />
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
