import { t } from "@/i18n";
import type { PointPair, Side } from "@/types/api";

const WIDTH = 600;
const HEIGHT = 460;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const PLOT_RADIUS = 150;
const LABEL_RADIUS = 172;
const MIN_EXTENT_SW = 1;

const MARKER_RADIUS = 6;
const MARKER_RING_RADIUS = 11;

const toPoints = (points: readonly string[]) => points.join(" ");

export type ReachMapMarkerShape = "circle" | "square" | "diamond";

/** One marker at (x, y) in SVG units: a dot, a square or a diamond of about the same area. */
export function MarkerShape({
  shape = "circle",
  x,
  y,
  size,
  color,
}: {
  shape?: ReachMapMarkerShape;
  x: number;
  y: number;
  size: number;
  color: string;
}) {
  const common = { fill: color, stroke: "var(--color-surface)", strokeWidth: 2 };
  if (shape === "square") {
    const half = size * 0.9;
    return <rect x={x - half} y={y - half} width={half * 2} height={half * 2} {...common} />;
  }
  if (shape === "diamond") {
    const r = size * 1.25;
    return (
      <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`} {...common} />
    );
  }
  return <circle cx={x} cy={y} r={size} {...common} />;
}

/** A point drawn on the map, such as a game target, in the body frame. */
export interface ReachMapMarker {
  key: string;
  x: number;
  y: number;
  /** A CSS colour, such as a token: var(--color-success). */
  color: string;
  /** A second cue besides colour, so markers differ for colour-blind readers too. */
  shape?: ReachMapMarkerShape;
  /** Draws a ring around the dot. */
  ring?: boolean;
}

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
  /** Extra dots on top of the map, such as where game targets were. */
  markers?: readonly ReachMapMarker[];
}

export function ReachMap({
  points,
  hull,
  directionsDeg,
  directionLabels,
  affectedSide,
  previousHull,
  valid,
  markers = [],
}: ReachMapProps) {
  const outward = affectedSide === "left" ? -1 : 1;
  const extent = Math.max(
    MIN_EXTENT_SW,
    ...[...points, ...(previousHull ?? [])].map(([x, y]) => Math.hypot(x, y)),
    ...markers.map(({ x, y }) => Math.hypot(x, y)),
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

      {markers.map((marker) => (
        <g key={marker.key}>
          {marker.ring && (
            <circle
              cx={toSvgX(marker.x)}
              cy={toSvgY(marker.y)}
              r={MARKER_RING_RADIUS}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={2}
            />
          )}
          <MarkerShape
            shape={marker.shape}
            x={toSvgX(marker.x)}
            y={toSvgY(marker.y)}
            size={MARKER_RADIUS}
            color={marker.color}
          />
        </g>
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
