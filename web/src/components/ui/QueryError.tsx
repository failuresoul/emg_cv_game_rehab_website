import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { t } from "@/i18n";

export function QueryError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title={t("common.loadError")}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      }
    />
  );
}
