import type { ProgressPoint as ChartPoint } from "@/features/patient/ProgressChart";
import type { ProgressPoint } from "@/types/api";

export interface HandProgress {
  /** Bloom's average peak openness per session, as a percentage. */
  openness: ChartPoint[];
  /** Finger piano's hit rate per session, as a percentage. */
  hitRate: ChartPoint[];
}

/**
 * The hand games' figures per session, oldest first, as chart points labelled with each
 * session's date. Sessions without the game are left out of its chart.
 */
export function handProgress(
  series: readonly ProgressPoint[],
  formatDate: (iso: string) => string,
): HandProgress {
  const points = (pick: (point: ProgressPoint) => number | null | undefined): ChartPoint[] =>
    series.flatMap((point) => {
      const share = pick(point);
      return share === null || share === undefined
        ? []
        : [{ label: formatDate(point.date), value: Math.round(share * 100) }];
    });
  return {
    openness: points((point) => point.bloom_peak_openness),
    hitRate: points((point) => point.piano_hit_rate),
  };
}
