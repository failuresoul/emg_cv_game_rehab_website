import { FileText } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { t } from "@/i18n";

export function PatientReportsPage() {
  return (
    <>
      <PageHeader title={t("page.patient.reports.title")} />
      <Card>
        <EmptyState
          icon={FileText}
          title={t("patient.reportsPage.emptyTitle")}
          description={t("patient.reportsPage.emptyDescription")}
        />
      </Card>
    </>
  );
}
