import {
  Armchair,
  CalendarCheck,
  Coffee,
  Compass,
  Dumbbell,
  Footprints,
  Gamepad2,
  Hand,
  HandHeart,
  Lamp,
  Lightbulb,
  type LucideIcon,
  Move,
  PartyPopper,
  Sparkles,
  Sprout,
  Target,
  TrendingUp,
  Wind,
} from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@/i18n";
import { useBengaliFont } from "@/lib/bengaliFont";
import type { FeedbackReport } from "@/types/api";

import { SafetyNotices } from "./SafetyNotices";

/** An icon for each suggestion of the catalogue (server/app/feedback/catalogue.yaml). */
export const SUGGESTION_ICONS: Record<string, LucideIcon> = {
  REST_BREAKS: Coffee,
  POSTURE_TRUNK: Armchair,
  SHOULDER_RELAX: Wind,
  CELEBRATE_PROGRESS: PartyPopper,
  FIRST_SESSIONS: Sprout,
  STEADY_EFFORT: Footprints,
  STEADY_HOLD: Hand,
  RELAX_AFTER_SQUEEZE: HandHeart,
  PRACTICE_DIRECTION: Compass,
  SETUP_LIGHTING: Lamp,
  LEVEL_UP: TrendingUp,
  ROUTINE: CalendarCheck,
  NEXT_FOCUS: Target,
};

/** Movement (K), range (R), hand (H) and game (G) measures. */
export function highlightIcon(metricId: string): LucideIcon {
  const icons: Record<string, LucideIcon> = { K: Move, R: Dumbbell, H: Hand, G: Gamepad2 };
  return icons[metricId.charAt(0)] ?? Sparkles;
}

/**
 * A report as the patient sees it: the safety notices first (unless the page shows them
 * itself), the summary, highlights, tips, the next session, and the disclaimer. Every text from
 * the model is a plain React text node: never HTML. The template report (fallback) looks the
 * same. The therapist summary is never shown here.
 */
export function FeedbackReportView({
  report,
  notices,
  showNotices = true,
  actions,
}: {
  report: FeedbackReport;
  notices: readonly string[];
  showNotices?: boolean;
  actions?: ReactNode;
}) {
  useBengaliFont(report.language === "bn");
  return (
    <article lang={report.language} className="flex flex-col gap-5">
      {showNotices && <SafetyNotices notices={notices} />}
      <p className="text-lg whitespace-pre-line" data-testid="patient-summary">
        {report.patient_summary}
      </p>
      {report.highlights.length > 0 && (
        <section aria-labelledby="feedback-highlights" className="flex flex-col gap-2">
          <h3 id="feedback-highlights" className="text-lg font-bold">
            {t("feedback.highlightsTitle")}
          </h3>
          <ul className="grid gap-3 md:grid-cols-3">
            {report.highlights.map((item, index) => {
              const Icon = highlightIcon(item.metric_id);
              return (
                <li
                  key={`${item.metric_id}-${index}`}
                  className="bg-primary-light flex items-start gap-3 rounded-xl p-4"
                >
                  <Icon size={24} aria-hidden className="text-primary shrink-0" />
                  <span>{item.text}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {report.suggestions.length > 0 && (
        <section aria-labelledby="feedback-tips" className="flex flex-col gap-2">
          <h3 id="feedback-tips" className="text-lg font-bold">
            {t("feedback.suggestionsTitle")}
          </h3>
          <ul className="grid gap-3 md:grid-cols-3">
            {report.suggestions.map((item) => {
              const Icon = SUGGESTION_ICONS[item.id] ?? Lightbulb;
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-black/10 p-4"
                >
                  <Icon size={28} aria-hidden className="text-accent shrink-0" />
                  <span>{item.text}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="text-lg">
        <span className="font-bold">{t("feedback.nextTime")}</span> {report.next_session_text}
      </p>
      {actions}
      <p className="text-muted border-t border-black/10 pt-3 text-sm">{t("feedback.disclaimer")}</p>
    </article>
  );
}
