import { Badge } from "@/components/ui/Badge";
import { t } from "@/i18n";

/** Marks a demo patient, whose sessions are synthetic and not from real practice. */
export function DemoBadge() {
  return (
    <span title={t("patients.demoTitle")}>
      <Badge variant="warning">{t("patients.demo")}</Badge>
    </span>
  );
}
