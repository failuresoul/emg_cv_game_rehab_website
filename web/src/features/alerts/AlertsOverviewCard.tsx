import { ArrowRight, BellRing } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAlerts, useStats } from "@/features/admin/hooks";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";

import { alertSummary, SEVERITY_BADGE, SEVERITY_LABEL_KEYS, TYPE_LABEL_KEYS } from "./alertModel";

const LATEST = 5;

/** The overview's Alerts card: open high and medium counts, and the latest open alerts. */
export function AlertsOverviewCard() {
  const stats = useStats();
  const alerts = useAlerts({ status: ["open"] });
  const counts = stats.data?.alerts;

  return (
    <div className="flex flex-col gap-3">
      {counts && (
        <p className="flex flex-wrap gap-2" aria-live="polite">
          <Badge variant="danger">{t("alert.count.high", { n: counts.open_high })}</Badge>
          <Badge variant="warning">{t("alert.count.medium", { n: counts.open_medium })}</Badge>
          {counts.open_low > 0 && (
            <Badge variant="muted">{t("alert.count.low", { n: counts.open_low })}</Badge>
          )}
        </p>
      )}
      {alerts.isPending && <Skeleton className="h-32" />}
      {alerts.isError && <QueryError onRetry={() => void alerts.refetch()} />}
      {alerts.isSuccess && alerts.data.length === 0 && (
        <EmptyState icon={BellRing} title={t("admin.alerts.empty")} />
      )}
      {alerts.isSuccess && alerts.data.length > 0 && (
        <ul className="divide-y divide-black/10">
          {alerts.data.slice(0, LATEST).map((alert) => (
            <li key={alert.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Badge variant={SEVERITY_BADGE[alert.severity]}>
                {t(SEVERITY_LABEL_KEYS[alert.severity])}
              </Badge>
              <span className="font-semibold">{t(TYPE_LABEL_KEYS[alert.type])}</span>
              {alert.patient_id !== null && alert.patient_code ? (
                <Link
                  to={`/admin/patients/${alert.patient_id}`}
                  className="text-primary font-semibold underline"
                >
                  {alert.patient_code}
                </Link>
              ) : (
                <span className="text-muted">{t("alert.system")}</span>
              )}
              <span className="text-muted min-w-0 flex-1 truncate">{alertSummary(alert)}</span>
              <span className="text-muted whitespace-nowrap">
                {formatDateTime(alert.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/admin/alerts" className={buttonClasses("secondary", "md", "self-start")}>
        {t("alert.viewAll")}
        <ArrowRight size={20} aria-hidden />
      </Link>
    </div>
  );
}
