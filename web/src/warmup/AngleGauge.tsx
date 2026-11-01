import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";

import { gaugeArc, gaugePoint } from "./demo";
import type { Thresholds } from "./exercises";

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
}

/** A semicircle from 0 to 180 degrees, with the target band and best angle so far. */
export function AngleGauge({ value, best, thresholds }: AngleGaugeProps) {
  const arc = (from: number, to: number) => gaugeArc(from, to, CENTER_X, CENTER_Y, RADIUS);
  const needle = value === null ? null : gaugePoint(value, CENTER_X, CENTER_Y, RADIUS - 14);
  const bestInner = best === null ? null : gaugePoint(best, CENTER_X, CENTER_Y, RADIUS - STROKE);
  const bestOuter = best === null ? null : gaugePoint(best, CENTER_X, CENTER_Y, RADIUS + STROKE);
  const none = t("warmup.gauge.none");
  const shown = value === null ? none : formatNumber(value, 0);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={t("warmup.gauge.label", {
        value: shown,
        best: best === null ? none : formatNumber(best, 0),
      })}
      className="w-full"
    >
      <path
        d={arc(0, 180)}
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
        {value === null ? none : t("warmup.gauge.degrees", { value: shown })}
      </text>
    </svg>
  );
}
