import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { DIRECTION_KEYS } from "@/features/session/calibration";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { t, type TranslationKey } from "@/i18n";
import { formatDate, formatDifference, formatNumber } from "@/lib/format";
import type { AdminCalibration, Patient, PatientProgress } from "@/types/api";

import { handProgress } from "./handProgress";
import { useAdminPatientProgress, usePatientCalibrations } from "./hooks";
import { PatientWarmupSection } from "./PatientWarmupSection";

const RADII_COLUMNS: TranslationKey[] = [
  "adminProgress.column.direction",
  "adminProgress.column.latest",
  "adminProgress.column.previous",
  "adminProgress.column.difference",
];

function RadiiTable({
  latest,
  previous,
}: {
  latest: AdminCalibration;
  previous: AdminCalibration | undefined;
}) {
  const none = t("common.notSet");

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-black/10">
            {RADII_COLUMNS.map((column) => (
              <th key={column} scope="col" className="text-muted px-3 py-2 font-semibold">
                {t(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {latest.reach_radii_sw.map((radius, index) => {
            const before = previous?.reach_radii_sw[index];
            return (
              <tr key={DIRECTION_KEYS[index]}>
                <td className="px-3 py-2">{t(DIRECTION_KEYS[index])}</td>
                <td className="px-3 py-2 tabular-nums">{formatNumber(radius)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {before === undefined ? none : formatNumber(before)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {before === undefined ? none : formatDifference(radius - before)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Calibration, warm-up, then the hand games; each shows on its own, so any can be empty. */
export function PatientProgressTab({ patient }: { patient: Patient }) {
  return (
    <div className="flex flex-col gap-10">
      <CalibrationProgress patient={patient} />
      <section>
        <h2 className="mb-4 text-xl font-bold">{t("adminWarmup.title")}</h2>
        <PatientWarmupSection patientId={patient.id} />
      </section>
      <HandGamesProgress patientId={patient.id} />
    </div>
  );
}

const asPercent = (value: number) => t("measure.percent", { value });

/** Bloom's peak openness and Finger piano's hit rate, one point per session. */
function HandGamesProgress({ patientId }: { patientId: number }) {
  const progress = useAdminPatientProgress(patientId);

  return (
    <section aria-labelledby="hand-games-progress" className="flex flex-col gap-4">
      <h2 id="hand-games-progress" className="text-xl font-bold">
        {t("adminProgress.handTitle")}
      </h2>
      {progress.isPending && <Skeleton className="h-64" />}
      {progress.isError && <QueryError onRetry={() => void progress.refetch()} />}
      {progress.isSuccess && <HandGamesCharts series={progress.data.series} />}
    </section>
  );
}

function HandGamesCharts({ series }: { series: PatientProgress["series"] }) {
  const { openness, hitRate } = handProgress(series, formatDate);
  if (openness.length === 0 && hitRate.length === 0) {
    return <EmptyState title={t("adminProgress.handEmpty")} />;
  }
  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <div>
        <h3 className="mb-2 text-lg font-semibold">{t("adminProgress.opennessChartTitle")}</h3>
        <ProgressChart
          points={openness}
          seriesName={t("adminProgress.opennessSeries")}
          emptyTitle={t("adminProgress.handEmpty")}
          formatValue={asPercent}
          yDomain={[0, 100]}
          allowDecimals={false}
        />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-semibold">{t("adminProgress.hitRateChartTitle")}</h3>
        <ProgressChart
          points={hitRate}
          seriesName={t("adminProgress.hitRateSeries")}
          emptyTitle={t("adminProgress.handEmpty")}
          formatValue={asPercent}
          yDomain={[0, 100]}
          allowDecimals={false}
        />
      </div>
    </div>
  );
}

function CalibrationProgress({ patient }: { patient: Patient }) {
  const calibrations = usePatientCalibrations(patient.id);

  if (calibrations.isPending) return <Skeleton className="h-64" />;
  if (calibrations.isError) return <QueryError onRetry={() => void calibrations.refetch()} />;

  // The API lists the newest first.
  const [latest, previous] = calibrations.data;
  if (!latest) return <EmptyState title={t("patient.tab.emptyUntilSessions")} />;

  const chartPoints = [...calibrations.data].reverse().map((calibration) => ({
    label: formatDate(calibration.created_at),
    value: Math.round(calibration.hull_area_sw2 * 100) / 100,
  }));

  return (
    <div className="flex flex-col gap-8">
      <section className="grid items-start gap-6 2xl:grid-cols-2">
        <div className="mx-auto w-full max-w-2xl">
          <h2 className="mb-2 text-xl font-bold">{t("adminProgress.mapTitle")}</h2>
          <CalibrationReachMap
            radii={latest.reach_radii_sw}
            hull={latest.hull_sw}
            previousHull={previous?.hull_sw}
            affectedSide={patient.affected_side}
          />
          {previous && <p className="text-muted">{t("adminProgress.dashed")}</p>}
        </div>
        <div>
          <h2 className="mb-2 text-xl font-bold">{t("adminProgress.radiiTitle")}</h2>
          <RadiiTable latest={latest} previous={previous} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-xl font-bold">{t("adminProgress.chartTitle")}</h2>
        <ProgressChart
          points={chartPoints}
          seriesName={t("adminProgress.chartSeries")}
          emptyTitle={t("patient.tab.emptyUntilSessions")}
        />
      </section>
    </div>
  );
}
