import { Target, TrendingUp } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/features/auth/AuthContext";
import { usePatientProgress } from "@/features/progress/hooks";
import { MetricCharts } from "@/features/progress/MetricCharts";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { t } from "@/i18n";
import { formatDate, formatNumber } from "@/lib/format";
import type { ReachSnapshot, Side } from "@/types/api";

function Snapshot({ label, reach }: { label: string; reach: ReachSnapshot }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-lg font-semibold">
        {t("progress.reach.snapshot", {
          date: formatDate(reach.date),
          area: formatNumber(reach.hull_area_sw2),
        })}
      </dd>
    </div>
  );
}

/** The latest reach map with the first one dashed underneath. */
function ReachHistory({
  first,
  latest,
  affectedSide,
}: {
  first: ReachSnapshot | null;
  latest: ReachSnapshot | null;
  affectedSide: Side;
}) {
  if (!latest || !first) return <EmptyState icon={Target} title={t("patient.reachMap.empty")} />;
  const same = first.session_id === latest.session_id;

  return (
    <div className="grid items-center gap-6 lg:grid-cols-3">
      <div className="mx-auto w-full max-w-2xl lg:col-span-2">
        <CalibrationReachMap
          radii={latest.reach_radii_sw}
          hull={latest.hull_sw}
          valid={latest.valid}
          previousHull={same ? null : first.hull_sw}
          affectedSide={affectedSide}
        />
      </div>
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col gap-4">
          {!same && <Snapshot label={t("progress.reach.first")} reach={first} />}
          <Snapshot label={t("progress.reach.latest")} reach={latest} />
        </dl>
        <p className="text-muted">{t(same ? "progress.reach.onlyOne" : "progress.reach.dashed")}</p>
      </div>
    </div>
  );
}

export function PatientProgressPage() {
  const { user } = useAuth();
  const progress = usePatientProgress();
  const affectedSide = user?.patient_profile?.affected_side ?? "right";

  return (
    <>
      <PageHeader title={t("page.patient.progress.title")} />
      {progress.isPending && <Skeleton className="h-96 rounded-xl" />}
      {progress.isError && (
        <Card>
          <QueryError onRetry={() => void progress.refetch()} />
        </Card>
      )}
      {progress.isSuccess &&
        (progress.data.series.length === 0 && !progress.data.latest_reach ? (
          <Card>
            <EmptyState
              icon={TrendingUp}
              title={t("patient.progressPage.emptyTitle")}
              description={t("patient.progressPage.emptyDescription")}
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <MetricCharts />
            <Card>
              <h2 className="mb-3 text-xl font-bold">{t("progress.reach.title")}</h2>
              <ReachHistory
                first={progress.data.first_reach}
                latest={progress.data.latest_reach}
                affectedSide={affectedSide}
              />
            </Card>
          </div>
        ))}
    </>
  );
}
