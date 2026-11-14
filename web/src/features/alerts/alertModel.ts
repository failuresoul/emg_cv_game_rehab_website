import { t, type TranslationKey } from "@/i18n";
import type { Alert, AlertSeverity, AlertStatus, AlertType } from "@/types/api";

export const ALERT_TYPES: readonly AlertType[] = [
  "pain",
  "new_symptoms",
  "high_fatigue",
  "sharp_decline",
  "missed_sessions",
  "repeated_device_problems",
  "llm_fallback_rate",
];
export const ALERT_SEVERITIES: readonly AlertSeverity[] = ["high", "medium", "low"];
export const ALERT_STATUSES: readonly AlertStatus[] = ["open", "acknowledged", "resolved"];

export const TYPE_LABEL_KEYS: Record<AlertType, TranslationKey> = {
  pain: "alert.type.pain",
  new_symptoms: "alert.type.new_symptoms",
  high_fatigue: "alert.type.high_fatigue",
  sharp_decline: "alert.type.sharp_decline",
  missed_sessions: "alert.type.missed_sessions",
  repeated_device_problems: "alert.type.repeated_device_problems",
  llm_fallback_rate: "alert.type.llm_fallback_rate",
};

export const SEVERITY_LABEL_KEYS: Record<AlertSeverity, TranslationKey> = {
  high: "alert.severity.high",
  medium: "alert.severity.medium",
  low: "alert.severity.low",
};

export const STATUS_LABEL_KEYS: Record<AlertStatus, TranslationKey> = {
  open: "alert.status.open",
  acknowledged: "alert.status.acknowledged",
  resolved: "alert.status.resolved",
};

/** Severity colours: high red, medium amber, low grey. Always shown with the word too. */
export const SEVERITY_BADGE: Record<AlertSeverity, "danger" | "warning" | "muted"> = {
  high: "danger",
  medium: "warning",
  low: "muted",
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** What raised the alert, in a short sentence, from its details. */
export function alertSummary(alert: Pick<Alert, "type" | "details">): string {
  const details = alert.details ?? {};
  switch (alert.type) {
    case "pain": {
      const pain = num(details.pain_0_10);
      return pain === null ? t("alert.summary.painUnknown") : t("alert.summary.pain", { n: pain });
    }
    case "new_symptoms":
      return t("alert.summary.newSymptoms");
    case "high_fatigue": {
      const fatigue = num(details.fatigue_0_10);
      return fatigue === null
        ? t("alert.summary.fatigueUnknown")
        : t("alert.summary.fatigue", { n: fatigue });
    }
    case "sharp_decline": {
      const metrics = Array.isArray(details.metrics) ? details.metrics : [];
      const ids = metrics
        .map((item) => (typeof item === "object" && item && "id" in item ? String(item.id) : ""))
        .filter(Boolean);
      return t("alert.summary.decline", { n: ids.length, ids: ids.join(", ") });
    }
    case "missed_sessions": {
      const days = num(details.days_since);
      return t("alert.summary.missed", { n: days ?? "–" });
    }
    case "repeated_device_problems": {
      const sessions = Array.isArray(details.sessions) ? details.sessions.length : 0;
      return t("alert.summary.device", { n: sessions });
    }
    case "llm_fallback_rate": {
      const share = num(details.fallback_share);
      const reports = num(details.reports);
      return t("alert.summary.llm", {
        pct: share === null ? "–" : Math.round(share * 100),
        n: reports ?? "–",
      });
    }
  }
}

/** The actions an alert still allows. */
export function nextActions(status: AlertStatus): ("acknowledge" | "resolve")[] {
  if (status === "open") return ["acknowledge", "resolve"];
  if (status === "acknowledged") return ["resolve"];
  return [];
}
