import type { PointPair, Side } from "@/types/api";

export interface PathPlotGeometry {
  /** The path to follow, as SVG polyline points. */
  path: string;
  /** The fingertip's raw path, as SVG polyline points. */
  fingertip: string;
  /** Where the path starts, in SVG units. */
  start: { x: number; y: number } | null;
  /** SVG units per shoulder width. */
  scale: number;
}

const MARGIN = 0.1;

/**
 * Fits a trace's path and the fingertip's raw path into a `width` × `height` box, keeping their
 * shape (one scale for x and y). Outward is drawn on the same side as in the mirrored camera
 * view, as on the reach map: to the left for a left-affected patient.
 */
export function pathPlotGeometry(
  path: readonly PointPair[],
  trajectory: readonly (readonly number[])[],
  affectedSide: Side,
  width: number,
  height: number,
): PathPlotGeometry {
  const outward = affectedSide === "left" ? -1 : 1;
  const pathPoints = path.map(([x, y]) => ({ x: outward * x, y }));
  const fingertipPoints = trajectory
    .filter((point) => point.length >= 3)
    .map((point) => ({ x: outward * point[1], y: point[2] }));
  const all = [...pathPoints, ...fingertipPoints];
  if (all.length === 0) return { path: "", fingertip: "", start: null, scale: 0 };

  const xs = all.map((point) => point.x);
  const ys = all.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.1);
  const spanY = Math.max(maxY - minY, 0.1);
  const scale = Math.min((width * (1 - 2 * MARGIN)) / spanX, (height * (1 - 2 * MARGIN)) / spanY);
  // The middle of everything drawn goes to the middle of the box; +y is up on screen.
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const toSvg = ({ x, y }: { x: number; y: number }) => ({
    x: Math.round((width / 2 + (x - centreX) * scale) * 10) / 10,
    y: Math.round((height / 2 - (y - centreY) * scale) * 10) / 10,
  });
  const line = (points: readonly { x: number; y: number }[]) =>
    points
      .map(toSvg)
      .map(({ x, y }) => `${x},${y}`)
      .join(" ");
  return {
    path: line(pathPoints),
    fingertip: line(fingertipPoints),
    start: pathPoints.length > 0 ? toSvg(pathPoints[0]) : null,
    scale,
  };
}
