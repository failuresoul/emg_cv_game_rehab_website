import { History } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { t } from "@/i18n";

export function PatientHistoryPage() {
  return (
    <>
      <PageHeader title={t("page.patient.history.title")} />
      <Card>
        <EmptyState
          icon={History}
          title={t("patient.historyPage.emptyTitle")}
          description={t("patient.historyPage.emptyDescription")}
        />
      </Card>
    </>
  );
}
