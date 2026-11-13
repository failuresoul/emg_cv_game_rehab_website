import type { TranslationKey } from "@/i18n";
import type { GameId, GameRunDetail, TrialEmgMetrics } from "@/types/api";

/** The games the muscle sensor can drive. */
export const EMG_GAME_IDS: readonly GameId[] = ["reach_activate", "grip_hold", "bloom"];

/** The readiness checks, in the order the session's check showed them. */
const CHECK_IDS = [
  "webSerial",
  "connected",
  "responding",
  "rate",
  "gaps",
  "contact",
  "saturation",
  "relaxed",
  "squeeze",
] as const;

export interface ReadinessRow {
  id: string;
  labelKey: TranslationKey;
  pass: boolean | null;
}

/** The saved readiness record ({id: {pass, value}}) as rows; unknown ids are left out. */
export function readinessRows(readiness: Record<string, unknown>): ReadinessRow[] {
  return CHECK_IDS.filter((id) => id in readiness).map((id) => {
    const entry = readiness[id];
    const pass =
      typeof entry === "object" && entry !== null && "pass" in entry
        ? Boolean((entry as { pass: unknown }).pass)
        : null;
    return { id, labelKey: `emgCheck.${id}` as TranslationKey, pass };
  });
}

export interface EmgTrialTrace {
  trialNo: number;
  trace: [number, number][];
  metrics: TrialEmgMetrics;
}

export interface EmgRunTraces {
  runId: number;
  gameId: GameId;
  trials: EmgTrialTrace[];
}

/** The EMG games' runs that saved %MVC traces, with those trials. */
export function emgRunTraces(games: readonly GameRunDetail[]): EmgRunTraces[] {
  return games
    .filter((run) => EMG_GAME_IDS.includes(run.game_id))
    .map((run) => ({
      runId: run.id,
      gameId: run.game_id,
      trials: run.trials
        .filter((trial) => trial.emg && trial.emg.trace.length > 0)
        .map((trial) => ({
          trialNo: trial.trial_no,
          trace: trial.emg?.trace ?? [],
          metrics: (trial.emg as NonNullable<typeof trial.emg>).metrics,
        })),
    }))
    .filter((run) => run.trials.length > 0);
}

/** The SVG path of a trace, %MVC 0 at the bottom and `maxPercent` at the top. */
export function tracePath(
  trace: readonly [number, number][],
  width: number,
  height: number,
  maxPercent = 120,
): string {
  if (trace.length === 0) return "";
  const last = trace[trace.length - 1]?.[0] ?? 0;
  const span = last > 0 ? last : 1;
  return trace
    .map(([ms, pct], index) => {
      const x = (ms / span) * width;
      const y = height - (Math.min(maxPercent, Math.max(0, pct)) / maxPercent) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Where a moment (ms since spawn) falls on a trace's x axis, or null when it has none. */
export function traceX(
  trace: readonly [number, number][],
  ms: number | null,
  width: number,
): number | null {
  if (ms === null || trace.length === 0) return null;
  const last = trace[trace.length - 1]?.[0] ?? 0;
  if (!(last > 0)) return null;
  return Math.min(width, Math.max(0, (ms / last) * width));
}
