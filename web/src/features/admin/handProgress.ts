import type { ProgressPoint as ChartPoint } from "@/features/patient/ProgressChart";
import type { ProgressPoint } from "@/types/api";

export interface HandProgress {
  /** Bloom's average peak openness per session, as a percentage. */
  openness: ChartPoint[];
  /** Finger piano's hit rate per session, as a percentage. */
  hitRate: ChartPoint[];
  /**
   * Grip and hold's steadiness per session: the wobble of the grip level in the zone, in
   * percentage points to one decimal (smaller is steadier).
   */
  steadiness: ChartPoint[];
  /** Grip and hold's time to relax per session, in seconds to one decimal. */
  relaxation: ChartPoint[];
}

/** One chart point per session that has the figure, rounded to `places` after scaling. */
function chartPoints(
  series: readonly ProgressPoint[],
  formatDate: (iso: string) => string,
  pick: (point: ProgressPoint) => number | null | undefined,
  scale: number,
  places: number,
): ChartPoint[] {
  return series.flatMap((point) => {
    const value = pick(point);
    return value === null || value === undefined
      ? []
      : [
          {
            label: formatDate(point.date),
            value: Math.round(value * scale * 10 ** places) / 10 ** places,
          },
        ];
  });
}

/**
 * The hand games' figures per session, oldest first, as chart points labelled with each
 * session's date. Sessions without the game are left out of its chart.
 */
export function handProgress(
  series: readonly ProgressPoint[],
  formatDate: (iso: string) => string,
): HandProgress {
  const points = (
    pick: (point: ProgressPoint) => number | null | undefined,
    scale: number,
    places: number,
  ) => chartPoints(series, formatDate, pick, scale, places);
  return {
    openness: points((point) => point.bloom_peak_openness, 100, 0),
    hitRate: points((point) => point.piano_hit_rate, 100, 0),
    steadiness: points((point) => point.grip_steadiness, 100, 1),
    relaxation: points((point) => point.grip_relaxation_ms, 1 / 1000, 1),
  };
}

export interface MovementQualityProgress {
  /** Path trace's mean SPARC per session, to two decimals (≤ 0; closer to 0 is smoother). */
  sparc: ChartPoint[];
  /** Paint the wall's mean elbow range per session, in whole degrees. */
  elbowRange: ChartPoint[];
  /** Pick and place's mean carry time per session, in seconds to one decimal. */
  transport: ChartPoint[];
}

/** The movement-quality figures per session, oldest first; sessions without a game left out. */
export function movementQualityProgress(
  series: readonly ProgressPoint[],
  formatDate: (iso: string) => string,
): MovementQualityProgress {
  return {
    sparc: chartPoints(series, formatDate, (point) => point.path_sparc, 1, 2),
    elbowRange: chartPoints(series, formatDate, (point) => point.elbow_range_deg, 1, 0),
    transport: chartPoints(series, formatDate, (point) => point.pick_transport_ms, 1 / 1000, 1),
  };
}
