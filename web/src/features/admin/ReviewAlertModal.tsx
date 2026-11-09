import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { SafetyFlagBadges } from "@/features/session/SafetyFlagBadges";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { SafetyFlag } from "@/types/api";

import { useReviewAlert } from "./hooks";

export const REVIEW_NOTE_MAX = 500;

export interface AlertToReview {
  sessionId: number;
  patientCode: string;
  date: string;
  flags: SafetyFlag[];
}

interface ReviewAlertModalProps {
  alert: AlertToReview | null;
  onClose: () => void;
}

// The form mounts only while open, so reopening starts with an empty note and no old error.

function ReviewForm({ alert, onClose }: { alert: AlertToReview; onClose: () => void }) {
  const reviewAlert = useReviewAlert();
  const showToast = useToast();
  const [note, setNote] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    reviewAlert.mutate(
      { sessionId: alert.sessionId, note },
      {
        onSuccess: () => {
          showToast("success", t("admin.alerts.reviewedToast", { code: alert.patientCode }));
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="font-semibold">
        {t("admin.alerts.reviewSubtitle", {
          code: alert.patientCode,
          date: formatDateTime(alert.date),
        })}
      </p>
      <SafetyFlagBadges flags={alert.flags} />
      <Textarea
        label={t("admin.alerts.note")}
        value={note}
        maxLength={REVIEW_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
      />
      {reviewAlert.isError && (
        <p role="alert" className="text-danger font-medium">
          {t("admin.alerts.reviewError")}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={reviewAlert.isPending}>
          {t("admin.alerts.markReviewed")}
        </Button>
      </div>
    </form>
  );
}

export function ReviewAlertModal({ alert, onClose }: ReviewAlertModalProps) {
  return (
    <Modal open={alert !== null} title={t("admin.alerts.reviewTitle")} onClose={onClose}>
      {alert && <ReviewForm alert={alert} onClose={onClose} />}
    </Modal>
  );
}
