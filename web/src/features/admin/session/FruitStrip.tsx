import { MarkerShape } from "@/components/ReachMap";
import { lateralRange } from "@/games/fruitCatch/lateral";
import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { Calibration, GameRunDetail, Side } from "@/types/api";

import { OutcomeLegend } from "./OutcomeLegend";
import { OUTCOME_STYLE, outcomeLabelKey } from "./outcomes";

const WIDTH = 640;
const PAD_X = 56;
const TOP = 44;
const ROW = 20;
const BOTTOM = 16;
const MARKER = 6;
const RING = 10;

/**
 * Where an x position (in SW, outward positive) goes across the strip, mirrored like the camera
 * view: outward is on the left for a left-affected patient and on the right otherwise.
 */
export function stripX(
  x: number,
  range: { min: number; max: number },
  affectedSide: Side,
  width = WIDTH,
  pad = PAD_X,
): number {
  const span = range.max - range.min || 1;
  const share = (x - range.min) / span;
  const fromLeft = affectedSide === "left" ? 1 - share : share;
  return pad + fromLeft * (width - 2 * pad);
}

/**
 * Every fruit of a run along the sideways reach, one row per fruit from the top, by outcome:
 * where it fell relative to the shoulder and the reach out and across.
 */
export function FruitStrip({
  run,
  calibration,
  affectedSide,
}: {
  run: GameRunDetail;
  calibration: Calibration | null;
  affectedSide: Side | null;
}) {
  const side = affectedSide ?? "right";
  const range = lateralRange(calibration?.reach_radii_sw ?? null);
  const trials = [...run.trials]
    .filter((trial) => trial.target)
    .sort((a, b) => a.trial_no - b.trial_no);
  const height = TOP + Math.max(1, trials.length) * ROW + BOTTOM;
  const at = (x: number) => stripX(x, range, side);
  const outEnd = at(range.max);
  const acrossEnd = at(range.min);
  const caught = trials.filter((trial) => trial.outcome === "success").length;

  return (
    <figure className="w-full">
      <figcaption className="mb-2 font-semibold">{t("adminSession.stripTitle")}</figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={t("adminSession.stripLabel", { caught, total: trials.length })}
        className="w-full"
      >
        {/* The reach, the shoulder, and which way is out and across. */}
        <line
          x1={acrossEnd}
          x2={outEnd}
          y1={TOP - 12}
          y2={TOP - 12}
          stroke="var(--color-primary)"
          strokeWidth={4}
          strokeLinecap="round"
        />
        <line
          x1={at(0)}
          x2={at(0)}
          y1={TOP - 20}
          y2={height - BOTTOM}
          stroke="var(--color-muted)"
          strokeOpacity={0.5}
          strokeDasharray="4 4"
        />
        <text x={at(0)} y={14} textAnchor="middle" fontSize={15} fill="var(--color-ink)">
          {t("reachMap.shoulder")}
        </text>
        {[
          { x: outEnd, label: t("adminSession.stripOut") },
          { x: acrossEnd, label: t("adminSession.stripAcross") },
        ].map(({ x, label }) => (
          <text
            key={label}
            x={x}
            y={14}
            textAnchor={x < WIDTH / 2 ? "start" : "end"}
            fontSize={15}
            fontWeight={600}
            fill="var(--color-ink)"
          >
            {label}
          </text>
        ))}

        {trials.map((trial, index) => {
          const style = OUTCOME_STYLE[trial.outcome];
          const x = at(trial.target?.x_sw ?? 0);
          const y = TOP + index * ROW + ROW / 2;
          return (
            <g key={trial.id}>
              <title>
                {t("adminSession.stripPoint", {
                  n: trial.trial_no,
                  outcome: t(outcomeLabelKey(run.game_id, trial.outcome)),
                  x: formatNumber(trial.target?.x_sw ?? 0, 2),
                })}
              </title>
              <line
                x1={PAD_X}
                x2={WIDTH - PAD_X}
                y1={y}
                y2={y}
                stroke="var(--color-muted)"
                strokeOpacity={0.12}
              />
              {trial.compensation.flagged && (
                <circle
                  cx={x}
                  cy={y}
                  r={RING}
                  fill="none"
                  stroke="var(--color-ink)"
                  strokeWidth={2}
                />
              )}
              <MarkerShape shape={style.shape} x={x} y={y} size={MARKER} color={style.color} />
            </g>
          );
        })}
      </svg>
      <OutcomeLegend
        gameId={run.game_id}
        outcomes={trials.map((trial) => trial.outcome)}
        compensated={trials.some((trial) => trial.compensation.flagged)}
      />
    </figure>
  );
}
