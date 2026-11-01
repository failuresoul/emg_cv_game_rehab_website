import { Badge } from "@/components/ui/Badge";
import { t, type TranslationKey } from "@/i18n";
import type { SessionStatus } from "@/types/api";

const STATUS_DISPLAY: Record<
  SessionStatus,
  { labelKey: TranslationKey; variant: "neutral" | "success" | "warning" }
> = {
  active: { labelKey: "sessionStatus.active", variant: "neutral" },
  completed: { labelKey: "sessionStatus.completed", variant: "success" },
  aborted: { labelKey: "sessionStatus.aborted", variant: "warning" },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const { labelKey, variant } = STATUS_DISPLAY[status];
  return <Badge variant={variant}>{t(labelKey)}</Badge>;
}
