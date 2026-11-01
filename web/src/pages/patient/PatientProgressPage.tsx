import { TrendingUp } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { t } from "@/i18n";

export function PatientProgressPage() {
  return (
    <>
      <PageHeader title={t("page.patient.progress.title")} />
      <Card>
        <EmptyState
          icon={TrendingUp}
          title={t("patient.progressPage.emptyTitle")}
          description={t("patient.progressPage.emptyDescription")}
        />
      </Card>
    </>
  );
}
