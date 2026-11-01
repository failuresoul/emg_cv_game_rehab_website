import { t } from "@/i18n";
import type { PointPair, Side } from "@/types/api";

const WIDTH = 600;
const HEIGHT = 460;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const PLOT_RADIUS = 150;
const LABEL_RADIUS = 172;
const MIN_EXTENT_SW = 1;

const toPoints = (points: readonly string[]) => points.join(" ");

interface ReachMapProps {
  /** Reach points in the body frame, one for each of directionsDeg. */
  points: readonly PointPair[];
  hull: readonly PointPair[];
  directionsDeg: readonly number[];
  directionLabels: readonly string[];
  /** Places outward on the same side as in the mirrored camera view. */
  affectedSide: Side;
  /** An earlier hull, drawn as a dashed outline. */
  previousHull?: readonly PointPair[] | null;
  /** Directions drawn as hollow points because their measurement was not reliable. */
  valid?: readonly boolean[];
}

export function ReachMap({
  points,
  hull,
  directionsDeg,
  directionLabels,
  affectedSide,
  previousHull,
  valid,
}: ReachMapProps) {
  const outward = affectedSide === "left" ? -1 : 1;
  const extent = Math.max(
    MIN_EXTENT_SW,
    ...[...points, ...(previousHull ?? [])].map(([x, y]) => Math.hypot(x, y)),
  );
  const scale = PLOT_RADIUS / extent;
  const toSvgX = (x: number) => CENTER_X + outward * x * scale;
  const toSvgY = (y: number) => CENTER_Y - y * scale;
  const polygon = (corners: readonly PointPair[]) =>
    toPoints(corners.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={t("reachMap.label")}
      className="w-full"
    >
      {directionsDeg.map((deg) => {
        const radians = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={CENTER_X}
            y1={CENTER_Y}
            x2={CENTER_X + outward * PLOT_RADIUS * Math.cos(radians)}
            y2={CENTER_Y - PLOT_RADIUS * Math.sin(radians)}
            stroke="var(--color-muted)"
            strokeOpacity={0.25}
          />
        );
      })}

      {previousHull && (
        <polygon
          points={polygon(previousHull)}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={2}
          strokeDasharray="8 6"
        />
      )}
      <polygon
        points={polygon(hull)}
        fill="var(--color-primary)"
        fillOpacity={0.2}
        stroke="var(--color-primary)"
        strokeWidth={3}
        strokeLinejoin="round"
      />

      {points.map(([x, y], index) => (
        <circle
          key={directionsDeg[index]}
          cx={toSvgX(x)}
          cy={toSvgY(y)}
          r={7}
          strokeWidth={3}
          stroke="var(--color-accent)"
          fill={valid && !valid[index] ? "var(--color-surface)" : "var(--color-accent)"}
        />
      ))}

      <circle cx={CENTER_X} cy={CENTER_Y} r={8} fill="var(--color-ink)" />
      <text
        x={CENTER_X}
        y={CENTER_Y + 26}
        textAnchor="middle"
        fontSize={15}
        fill="var(--color-ink)"
        stroke="var(--color-surface)"
        strokeWidth={4}
        paintOrder="stroke"
      >
        {t("reachMap.shoulder")}
      </text>

      {directionsDeg.map((deg, index) => {
        const radians = (deg * Math.PI) / 180;
        const dx = outward * Math.cos(radians);
        const dy = -Math.sin(radians);
        let anchor: "start" | "middle" | "end" = "middle";
        if (dx > 0.1) anchor = "start";
        if (dx < -0.1) anchor = "end";
        return (
          <text
            key={deg}
            x={CENTER_X + LABEL_RADIUS * dx}
            y={CENTER_Y + LABEL_RADIUS * dy + 6 + 14 * dy}
            textAnchor={anchor}
            fontSize={16}
            fontWeight={500}
            fill="var(--color-ink)"
          >
            {directionLabels[index]}
          </text>
        );
      })}
    </svg>
  );
}
