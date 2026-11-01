import { Badge } from "@/components/ui/Badge";
import { t } from "@/i18n";

export function PatientStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge variant={isActive ? "success" : "neutral"}>
      {t(isActive ? "status.active" : "status.inactive")}
    </Badge>
  );
}
