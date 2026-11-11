import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { DIRECTION_KEYS } from "@/features/session/calibration";
import { CalibrationReachMap } from "@/features/session/CalibrationReachMap";
import { t, type TranslationKey } from "@/i18n";
import { formatDate, formatDifference, formatNumber } from "@/lib/format";
import type { AdminCalibration, Patient, PatientProgress } from "@/types/api";

import { handProgress, movementQualityProgress } from "./handProgress";
import { MetricsSection } from "./MetricsSection";
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
      <MetricsSection patientId={patient.id} />
      <CalibrationProgress patient={patient} />
      <section>
        <h2 className="mb-4 text-xl font-bold">{t("adminWarmup.title")}</h2>
        <PatientWarmupSection patientId={patient.id} />
      </section>
      <GameProgress patientId={patient.id} />
    </div>
  );
}

const asPercent = (value: number) => t("measure.percent", { value });

const asSparc = (value: number) => t("measure.number", { value });
const asDegrees = (value: number) => t("measure.degrees", { value });
const asSeconds = (value: number) => t("game.results.seconds", { value });
const asWobble = (value: number) => t("measure.wobble", { value });

/**
 * The game figures per session, from one fetch of the patient's progress: the hand games
 * (Bloom's peak openness, Finger piano's hit rate, Grip and hold's steadiness and time to relax)
 * and movement quality (Path trace's smoothness, Paint the wall's elbow range, Pick and place's
 * carry time).
 */
function GameProgress({ patientId }: { patientId: number }) {
  const progress = useAdminPatientProgress(patientId);
  const body = (charts: (series: PatientProgress["series"]) => ReactNode) => (
    <>
      {progress.isPending && <Skeleton className="h-64" />}
      {progress.isError && <QueryError onRetry={() => void progress.refetch()} />}
      {progress.isSuccess && charts(progress.data.series)}
    </>
  );

  return (
    <>
      <section aria-labelledby="hand-games-progress" className="flex flex-col gap-4">
        <h2 id="hand-games-progress" className="text-xl font-bold">
          {t("adminProgress.handTitle")}
        </h2>
        {body((series) => (
          <HandGamesCharts series={series} />
        ))}
      </section>
      <section aria-labelledby="movement-quality-progress" className="flex flex-col gap-4">
        <h2 id="movement-quality-progress" className="text-xl font-bold">
          {t("adminProgress.qualityTitle")}
        </h2>
        {body((series) => (
          <MovementQualityCharts series={series} />
        ))}
      </section>
    </>
  );
}

function MovementQualityCharts({ series }: { series: PatientProgress["series"] }) {
  const { sparc, elbowRange, transport } = movementQualityProgress(series, formatDate);
  if (sparc.length === 0 && elbowRange.length === 0 && transport.length === 0) {
    return <EmptyState title={t("adminProgress.qualityEmpty")} />;
  }
  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <div>
        <h3 className="mb-2 text-lg font-semibold">{t("adminProgress.sparcChartTitle")}</h3>
        <ProgressChart
          points={sparc}
          seriesName={t("adminProgress.sparcSeries")}
          emptyTitle={t("adminProgress.qualityEmpty")}
          formatValue={asSparc}
        />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-semibold">{t("adminProgress.rangeChartTitle")}</h3>
        <ProgressChart
          points={elbowRange}
          seriesName={t("adminProgress.rangeSeries")}
          emptyTitle={t("adminProgress.qualityEmpty")}
          formatValue={asDegrees}
          allowDecimals={false}
        />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-semibold">{t("adminProgress.transportChartTitle")}</h3>
        <ProgressChart
          points={transport}
          seriesName={t("adminProgress.transportSeries")}
          emptyTitle={t("adminProgress.qualityEmpty")}
          formatValue={asSeconds}
        />
      </div>
    </div>
  );
}

function HandGamesCharts({ series }: { series: PatientProgress["series"] }) {
  const { openness, hitRate, steadiness, relaxation } = handProgress(series, formatDate);
  if ([openness, hitRate, steadiness, relaxation].every((points) => points.length === 0)) {
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
      <div>
        <h3 className="mb-2 text-lg font-semibold">{t("adminProgress.steadinessChartTitle")}</h3>
        <ProgressChart
          points={steadiness}
          seriesName={t("adminProgress.steadinessSeries")}
          emptyTitle={t("adminProgress.handEmpty")}
          formatValue={asWobble}
        />
      </div>
      <div>
        <h3 className="mb-2 text-lg font-semibold">{t("adminProgress.relaxationChartTitle")}</h3>
        <ProgressChart
          points={relaxation}
          seriesName={t("adminProgress.relaxationSeries")}
          emptyTitle={t("adminProgress.handEmpty")}
          formatValue={asSeconds}
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
