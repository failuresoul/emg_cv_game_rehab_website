import { ClipboardList } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReviewAlertModal } from "@/features/admin/ReviewAlertModal";
import { DIFFICULTY_LABEL_KEYS } from "@/features/session/questionnaire";
import { SafetyFlagBadges } from "@/features/session/SafetyFlagBadges";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { AdminSessionDetail } from "@/types/api";

function Answer({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function ReviewStatus({ session }: { session: AdminSessionDetail }) {
  const [open, setOpen] = useState(false);

  if (!session.needs_review) return null;
  if (session.reviewed_at !== null) {
    return (
      <div className="bg-primary-light rounded-lg p-4">
        <p className="font-semibold">
          {t("adminSession.review.reviewed", { date: formatDateTime(session.reviewed_at) })}
        </p>
        <p className="mt-1 whitespace-pre-wrap">
          {session.review_note ?? t("adminSession.review.noNote")}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/5 p-4">
      <p className="font-semibold">{t("adminSession.review.open")}</p>
      <Button onClick={() => setOpen(true)}>{t("admin.alerts.markReviewed")}</Button>
      <ReviewAlertModal
        alert={
          open
            ? {
                sessionId: session.id,
                patientCode: session.patient_code,
                date: session.started_at,
                flags: session.flags,
              }
            : null
        }
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

/** The cool-down answers, the safety flags they raised and whether an admin has reviewed them. */
export function QuestionnaireCard({ session }: { session: AdminSessionDetail }) {
  const feedback = session.feedback;
  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-3 text-xl font-bold">{t("adminSession.questionnaire.title")}</h2>
      {feedback === null ? (
        <EmptyState icon={ClipboardList} title={t("adminSession.questionnaire.none")} />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Answer label={t("adminSession.questionnaire.pain")}>
              {t("adminSession.questionnaire.outOf", { value: feedback.pain_0_10, max: 10 })}
            </Answer>
            <Answer label={t("adminSession.questionnaire.fatigue")}>
              {t("adminSession.questionnaire.outOf", { value: feedback.fatigue_0_10, max: 10 })}
            </Answer>
            <Answer label={t("adminSession.questionnaire.enjoyment")}>
              {t("adminSession.questionnaire.outOf", { value: feedback.enjoyment_1_5, max: 5 })}
            </Answer>
            <Answer label={t("adminSession.questionnaire.difficulty")}>
              {t(DIFFICULTY_LABEL_KEYS[feedback.difficulty])}
            </Answer>
            <Answer label={t("adminSession.questionnaire.newSymptoms")}>
              {feedback.new_symptoms ? t("cooldown.yes") : t("cooldown.no")}
            </Answer>
            <Answer label={t("adminSession.questionnaire.flags")}>
              <SafetyFlagBadges flags={session.flags} />
            </Answer>
            <div className="sm:col-span-2 lg:col-span-3">
              <Answer label={t("adminSession.questionnaire.comment")}>
                <span className="whitespace-pre-wrap">
                  {feedback.comment ?? t("adminSession.questionnaire.noComment")}
                </span>
              </Answer>
            </div>
          </dl>
          <ReviewStatus session={session} />
        </div>
      )}
    </Card>
  );
}
