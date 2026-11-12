import type { AdaptationLogRow, L2Extra } from "@/types/api";

/** Ring boundaries of the target's distance fraction (server: app/engine/l2_bayes.py). */
export const RING_BOUNDS: Readonly<Record<number, readonly [number, number]>> = {
  1: [0.4, 0.55],
  2: [0.55, 0.85],
  3: [0.85, 1.0],
  4: [1.0, 1.1],
};

export interface SectorCell {
  name: string;
  /** The lane's direction in degrees (Fruit catch: out 0, across 180). */
  directionDeg: number;
  ring: number;
  /** The posterior mean chance of success, 0-1. */
  mean: number;
  /** Trials the engine has learned from in this sector. */
  trials: number;
}

export interface TargetDot {
  /** The trial the target was for (1 = the first). */
  order: number;
  directionDeg: number;
  distanceFrac: number;
  sector: string;
}

/** "D3R2" -> 135 degrees, ring 2; "out-R1" -> 0, ring 1; "across-R3" -> 180, ring 3. */
export function parseSector(name: string): { directionDeg: number; ring: number } | null {
  const match = /^(?:D([0-7])|(out|across)-)R([1-4])$/.exec(name);
  if (!match) return null;
  const directionDeg =
    match[1] !== undefined ? Number(match[1]) * 45 : match[2] === "out" ? 0 : 180;
  return { directionDeg, ring: Number(match[3]) };
}

/** The run's L2 beliefs after its last decision, one cell per sector; empty for L0 and L1. */
export function sectorCells(logs: readonly AdaptationLogRow[]): SectorCell[] {
  const last = [...logs].sort((a, b) => a.trial_no - b.trial_no).at(-1);
  const extra = (last?.state_after as { extra?: L2Extra } | undefined)?.extra;
  if (!extra?.sectors) return [];
  const cells: SectorCell[] = [];
  for (const [name, ab] of Object.entries(extra.sectors)) {
    const place = parseSector(name);
    if (!place || ab.length !== 2 || ab[0] + ab[1] <= 0) continue;
    cells.push({
      name,
      ...place,
      mean: ab[0] / (ab[0] + ab[1]),
      trials: extra.seen?.[name] ?? 0,
    });
  }
  return cells.sort((a, b) => a.directionDeg - b.directionDeg || a.ring - b.ring);
}

/** Where L2 put each target, in the order of the trials (the decision after trial n chose the
 * target of trial n + 1). */
export function targetDots(logs: readonly AdaptationLogRow[]): TargetDot[] {
  return [...logs]
    .sort((a, b) => a.trial_no - b.trial_no)
    .flatMap((log) => {
      const target = log.details?.target;
      if (!target || !Number.isFinite(target.distance_frac)) return [];
      const place = parseSector(target.sector);
      const directionDeg =
        target.direction_deg ?? place?.directionDeg ?? (target.side === "across" ? 180 : 0);
      return [
        {
          order: log.trial_no + 1,
          directionDeg,
          distanceFrac: target.distance_frac,
          sector: target.sector,
        },
      ];
    });
}

/** A colourblind-safe sequential scale: pale for unlikely, dark teal for likely success. */
export function meanColour(mean: number): string {
  const m = Math.min(1, Math.max(0, mean));
  // From #F2E6D9 (warm pale) through #8CC2BB to #0F5C5C (primary).
  const stops: [number, number, number][] = [
    [242, 230, 217],
    [140, 194, 187],
    [15, 92, 92],
  ];
  const position = m * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const share = position - index;
  const [a, b] = [stops[index], stops[index + 1]];
  const mix = a.map((value, i) => Math.round(value + (b[i] - value) * share));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}
