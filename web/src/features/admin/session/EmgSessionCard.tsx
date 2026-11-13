import { Activity } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { AdminSessionDetail, EmgCalibrationRead } from "@/types/api";

import { emgRunTraces, type EmgTrialTrace, readinessRows, tracePath, traceX } from "./emgCard";

const WIDTH = 220;
const HEIGHT = 70;

const SITE_KEYS: Record<EmgCalibrationRead["site"], TranslationKey> = {
  flexors: "emgCard.site.flexors",
  extensors: "emgCard.site.extensors",
};

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const mv = (value: number) => t("emgCard.mv", { value: formatNumber(value, 1) });

/** One trial's %MVC trace with its onset (green) and offset (amber) marks. */
function TrialTrace({ trial }: { trial: EmgTrialTrace }) {
  const onset = traceX(trial.trace, trial.metrics.onset_ms, WIDTH);
  const offset = traceX(trial.trace, trial.metrics.offset_ms, WIDTH);
  const peak = trial.metrics.peak_mvc;
  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={t("emgCard.traceLabel", { n: trial.trialNo })}
        className="rounded bg-black/5"
      >
        {/* 100 %MVC */}
        <line
          x1={0}
          x2={WIDTH}
          y1={HEIGHT - (100 / 120) * HEIGHT}
          y2={HEIGHT - (100 / 120) * HEIGHT}
          className="stroke-black/20"
          strokeDasharray="3 3"
        />
        <path d={tracePath(trial.trace, WIDTH, HEIGHT)} fill="none" className="stroke-primary" />
        {onset !== null && (
          <line x1={onset} x2={onset} y1={0} y2={HEIGHT} className="stroke-green-600" />
        )}
        {offset !== null && (
          <line x1={offset} x2={offset} y1={0} y2={HEIGHT} className="stroke-amber-500" />
        )}
      </svg>
      <figcaption className="text-muted text-sm tabular-nums">
        {t("emgCard.traceCaption", {
          n: trial.trialNo,
          peak: peak === null ? "–" : formatNumber(peak, 0),
        })}
      </figcaption>
    </figure>
  );
}

/** The admin session page's "Muscle sensor" card: calibration, readiness and per-trial traces. */
export function EmgSessionCard({ session }: { session: AdminSessionDetail }) {
  const calibration = session.emg_calibration ?? null;
  if (!calibration) return null;
  const runs = emgRunTraces(session.games);
  const checks = readinessRows(calibration.readiness);

  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-2 text-xl font-bold">{t("emgCard.title")}</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
        <Figure label={t("emgCard.site")} value={t(SITE_KEYS[calibration.site])} />
        <Figure
          label={t("emgCard.rest")}
          value={`${mv(calibration.rest_mean_mv)} ± ${formatNumber(calibration.rest_sd_mv, 1)}`}
        />
        <Figure label={t("emgCard.mvc")} value={mv(calibration.mvc_mv)} />
        <Figure label={t("emgCard.threshold")} value={mv(calibration.threshold_mv)} />
        <Figure
          label={t("emgCard.source")}
          value={t(
            calibration.source === "serial" ? "emgCard.source.serial" : "emgCard.source.simulated",
          )}
        />
      </dl>

      {checks.length > 0 && (
        <>
          <h3 className="mt-4 mb-2 text-lg font-semibold">{t("emgCard.readiness")}</h3>
          <ul className="flex flex-wrap gap-2">
            {checks.map((check) => (
              <li
                key={check.id}
                className={
                  check.pass === false
                    ? "rounded-full bg-amber-100 px-3 py-1 text-amber-900"
                    : "rounded-full bg-green-100 px-3 py-1 text-green-900"
                }
              >
                {t(check.labelKey)}: {t(check.pass === false ? "emgCard.fail" : "emgCard.pass")}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-4 mb-1 text-lg font-semibold">{t("emgCard.tracesTitle")}</h3>
      <p className="text-muted mb-3">{t("emgCard.tracesHint")}</p>
      {runs.length === 0 ? (
        <EmptyState icon={Activity} title={t("emgCard.noTraces")} />
      ) : (
        runs.map((run) => (
          <section key={run.runId} className="mb-4">
            <h4 className="mb-2 font-semibold">{t(`game.${run.gameId}.name` as TranslationKey)}</h4>
            <div className="flex flex-wrap gap-4">
              {run.trials.map((trial) => (
                <TrialTrace key={trial.trialNo} trial={trial} />
              ))}
            </div>
          </section>
        ))
      )}
    </Card>
  );
}
