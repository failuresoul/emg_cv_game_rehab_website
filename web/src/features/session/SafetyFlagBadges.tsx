import { Badge } from "@/components/ui/Badge";
import { t } from "@/i18n";
import type { SafetyFlag } from "@/types/api";

import { FLAG_LABEL_KEYS } from "./questionnaire";

/** The questionnaire's safety flags, for admins. */
export function SafetyFlagBadges({ flags }: { flags: readonly SafetyFlag[] }) {
  if (flags.length === 0) return <span className="text-muted">{t("safety.noFlags")}</span>;
  return (
    <ul className="flex flex-wrap gap-2">
      {flags.map((flag) => (
        <li key={flag}>
          <Badge variant={flag === "high_fatigue" ? "warning" : "danger"}>
            {t(FLAG_LABEL_KEYS[flag])}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
