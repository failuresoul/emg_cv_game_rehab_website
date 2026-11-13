import { HeartHandshake } from "lucide-react";

import { t } from "@/i18n";

/**
 * The fixed, approved safety notices (shared/safety-notices.json, sent by the server), shown
 * first on the page in a clearly coloured box. Never written by the model.
 */
export function SafetyNotices({ notices }: { notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <section
      aria-label={t("feedback.safety.label")}
      data-testid="safety-notices"
      className="border-info bg-info/10 flex flex-col gap-3 rounded-xl border-2 p-4 text-lg font-medium"
    >
      {notices.map((notice) => (
        <p key={notice} className="flex items-start gap-3">
          <HeartHandshake size={32} aria-hidden className="text-info shrink-0" />
          <span>{notice}</span>
        </p>
      ))}
    </section>
  );
}
