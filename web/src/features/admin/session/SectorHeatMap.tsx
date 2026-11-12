import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { AdaptationLogRow, Calibration, Side } from "@/types/api";

import { meanColour, RING_BOUNDS, sectorCells, targetDots } from "./sectorMap";

const SIZE = 520;
const CENTER = SIZE / 2;
const PLOT_RADIUS = 210;
/** Each lane is drawn 40 degrees wide, leaving a small gap between directions. */
const HALF_WIDTH_DEG = 20;

/**
 * L2's beliefs for one run on the patient's reach: each workspace sector (a direction and a ring
 * of distance) coloured by its chance of success after the run (0-1), with the trials it has
 * learned from; the targets L2 chose, in order, as numbered dots.
 */
export function SectorHeatMap({
  logs,
  calibration,
  affectedSide,
}: {
  logs: readonly AdaptationLogRow[];
  calibration: Calibration | null;
  affectedSide: Side | null;
}) {
  const cells = sectorCells(logs);
  if (cells.length === 0) return null;
  const dots = targetDots(logs);
  const outward = affectedSide === "left" ? -1 : 1;
  // Each direction's calibrated reach (SW); without a calibration every direction counts as 1.
  const radii = calibration?.reach_radii_sw ?? Array.from({ length: 8 }, () => 1);
  const reachAt = (deg: number) => radii[Math.round(deg / 45) % 8] ?? 1;
  const extent = Math.max(...radii.map((r) => r * RING_BOUNDS[4][1]), 0.0001);
  const scale = PLOT_RADIUS / extent;
  const point = (deg: number, distanceSw: number) => {
    const radians = (deg * Math.PI) / 180;
    return [
      CENTER + outward * Math.cos(radians) * distanceSw * scale,
      CENTER - Math.sin(radians) * distanceSw * scale,
    ] as const;
  };
  const wedge = (deg: number, inner: number, outer: number) => {
    const [a0, a1] = [deg - HALF_WIDTH_DEG, deg + HALF_WIDTH_DEG];
    const p = (angle: number, r: number) => point(angle, r).join(",");
    return `M${p(a0, inner)} L${p(a0, outer)} L${p(a1, outer)} L${p(a1, inner)} Z`;
  };

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="font-semibold">{t("adminAdaptation.sectors.title")}</figcaption>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={t("adminAdaptation.sectors.label")}
        className="mx-auto w-full max-w-lg"
      >
        {cells.map((cell) => {
          const [low, high] = RING_BOUNDS[cell.ring];
          const reach = reachAt(cell.directionDeg);
          const [lx, ly] = point(cell.directionDeg, reach * ((low + high) / 2));
          return (
            <g key={cell.name}>
              <path
                d={wedge(cell.directionDeg, reach * low, reach * high)}
                fill={meanColour(cell.mean)}
                stroke="var(--color-surface)"
                strokeWidth={2}
              >
                <title>
                  {t("adminAdaptation.sectors.cell", {
                    sector: cell.name,
                    mean: formatNumber(cell.mean, 2),
                    n: cell.trials,
                  })}
                </title>
              </path>
              {cell.trials > 0 && (
                <text
                  x={lx}
                  y={ly + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill={cell.mean > 0.55 ? "#FFFFFF" : "var(--color-ink)"}
                >
                  {cell.trials}
                </text>
              )}
            </g>
          );
        })}
        {dots.map((dot) => {
          const [x, y] = point(dot.directionDeg, reachAt(dot.directionDeg) * dot.distanceFrac);
          return (
            <circle
              key={dot.order}
              cx={x}
              cy={y}
              r={3.5}
              fill="var(--color-accent)"
              fillOpacity={0.35 + (0.65 * dot.order) / Math.max(1, dots.length)}
              stroke="var(--color-ink)"
              strokeWidth={0.6}
            >
              <title>
                {t("adminAdaptation.sectors.dot", { n: dot.order, sector: dot.sector })}
              </title>
            </circle>
          );
        })}
        <circle cx={CENTER} cy={CENTER} r={6} fill="var(--color-ink)" />
      </svg>
      <div className="text-muted flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
        <span className="flex items-center gap-2">
          {t("adminAdaptation.sectors.low")}
          <span
            aria-hidden
            className="inline-block h-3 w-28 rounded"
            style={{
              background: `linear-gradient(90deg, ${meanColour(0)}, ${meanColour(0.5)}, ${meanColour(1)})`,
            }}
          />
          {t("adminAdaptation.sectors.high")}
        </span>
        <span>{t("adminAdaptation.sectors.numbers")}</span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="bg-accent inline-block size-3 rounded-full" />
          {t("adminAdaptation.sectors.dots")}
        </span>
      </div>
    </figure>
  );
}
