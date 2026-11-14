import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertsTable } from "@/features/alerts/AlertsTable";
import { t } from "@/i18n";

/** /admin/alerts: every alert, with filters and actions. */
export function AdminAlertsPage() {
  return (
    <>
      <PageHeader title={t("page.admin.alerts.title")} description={t("alert.pageIntro")} />
      <Card>
        <AlertsTable />
      </Card>
    </>
  );
}
