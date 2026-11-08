import { t } from "@/i18n";

import { gaugeArc, gaugeDegrees, gaugePoint } from "./demo";
import type { MeasureUnit, Thresholds } from "./exercises";
import { formatMeasure } from "./feedback";

const WIDTH = 240;
const HEIGHT = 136;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 120;
const RADIUS = 96;
const STROKE = 16;

interface AngleGaugeProps {
  value: number | null;
  best: number | null;
  thresholds: Thresholds;
  /** The gauge's ends, in the measure's unit. Defaults to 0–180 degrees. */
  range?: { min: number; max: number };
  unit?: MeasureUnit;
}

/** A semicircle from the range's minimum to its maximum, with the target band and best so far. */
export function AngleGauge({
  value,
  best,
  thresholds,
  range = { min: 0, max: 180 },
  unit = "deg",
}: AngleGaugeProps) {
  const toDeg = (measure: number) => gaugeDegrees(measure, range.min, range.max);
  const arc = (from: number, to: number) =>
    gaugeArc(toDeg(from), toDeg(to), CENTER_X, CENTER_Y, RADIUS);
  const at = (measure: number, radius: number) =>
    gaugePoint(toDeg(measure), CENTER_X, CENTER_Y, radius);
  const needle = value === null ? null : at(value, RADIUS - 14);
  const bestInner = best === null ? null : at(best, RADIUS - STROKE);
  const bestOuter = best === null ? null : at(best, RADIUS + STROKE);
  const none = t("warmup.gauge.none");
  const shown = value === null ? none : formatMeasure(value, unit);
  const bestShown = best === null ? none : formatMeasure(best, unit);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={t(unit === "deg" ? "warmup.gauge.label" : "warmup.gauge.labelMeasure", {
        value: shown,
        best: bestShown,
      })}
      className="w-full"
    >
      <path
        d={arc(range.min, range.max)}
        fill="none"
        stroke="var(--color-muted)"
        strokeOpacity={0.25}
        strokeWidth={STROKE}
      />
      <path
        d={arc(thresholds.low, thresholds.high)}
        fill="none"
        stroke="var(--color-primary)"
        strokeOpacity={0.55}
        strokeWidth={STROKE}
      />
      {bestInner && bestOuter && (
        <line
          x1={bestInner.x}
          y1={bestInner.y}
          x2={bestOuter.x}
          y2={bestOuter.y}
          stroke="var(--color-success)"
          strokeWidth={5}
          strokeLinecap="round"
        />
      )}
      {needle && (
        <line
          x1={CENTER_X}
          y1={CENTER_Y}
          x2={needle.x}
          y2={needle.y}
          stroke="var(--color-accent)"
          strokeWidth={6}
          strokeLinecap="round"
        />
      )}
      <circle cx={CENTER_X} cy={CENTER_Y} r={8} fill="var(--color-ink)" />
      <text
        x={CENTER_X}
        y={CENTER_Y - 30}
        textAnchor="middle"
        fontSize={26}
        fontWeight={700}
        fill="var(--color-ink)"
        stroke="var(--color-surface)"
        strokeWidth={6}
        paintOrder="stroke"
      >
        {shown}
      </text>
    </svg>
  );
}
