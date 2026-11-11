import type { TranslationKey } from "@/i18n";
import {
  type FingerName,
  type GameId,
  type GameRun,
  type GameRunDetail,
  type GameSummary,
  isSpatialTarget,
  type LastSessionGame,
  type TrialMetrics,
  type TrialOutcome,
  type TrialRead,
} from "@/types/api";

/** Summary `details` keys the games fill in. */
export const DETAIL_HIGHEST_POPPED = "highest_popped_frac";
export const DETAIL_WIDEST_CATCH = "widest_catch_frac";
export const DETAIL_MEAN_TIME_TO_OPEN = "mean_time_to_open_ms";
export const DETAIL_NOTE_HIT_RATE = "note_hit_rate";
export const DETAIL_BEST_OPENNESS = "best_openness";
export const DETAIL_BEST_FINGER = "best_finger";
export const DETAIL_TOTAL_STARS = "total_stars";
export const DETAIL_MEAN_IN_CORRIDOR = "mean_in_corridor_pct";
export const DETAIL_BEST_SPARC = "best_sparc";
export const DETAIL_MEAN_RANGE_DEG = "mean_range_deg";
export const DETAIL_BEST_RANGE_DEG = "best_range_deg";
export const DETAIL_MEAN_TRANSPORT_MS = "mean_transport_ms";
export const DETAIL_TOTAL_DROPS = "total_drops";

/** Runs the patient finished or stopped; a run left open has no result yet. */
export function finishedRuns<T extends Pick<GameRun, "status">>(runs: readonly T[]): T[] {
  return runs.filter((run) => run.status !== "active");
}

/** The session's game score: every finished run's score added up. Null if none has a score. */
export function totalScore(
  runs: readonly (Pick<GameRun, "status" | "score"> | LastSessionGame)[],
): number | null {
  const scores = runs
    .filter((run) => !("status" in run) || run.status !== "active")
    .map((run) => run.score)
    .filter((score): score is number => score !== null);
  return scores.length > 0 ? scores.reduce((total, score) => total + score, 0) : null;
}

/** Average reach time in seconds, to one decimal, or null when there is none. */
export function meanReachSeconds(run: Pick<GameRun, "summary">): number | null {
  const ms = run.summary?.mean_movement_ms;
  return ms === null || ms === undefined ? null : Math.round(ms / 100) / 10;
}

/** A share from 0 to 1 as a whole percentage. */
export function percent(share: number | null | undefined): number | null {
  return share === null || share === undefined ? null : Math.round(share * 100);
}

export interface MainMeasure {
  labelKey: TranslationKey;
  /** The value's text and its numbers, or null when the game has nothing to show yet. */
  value: { key: TranslationKey; params: Record<string, number> } | null;
}

const detail = (summary: GameSummary | null, key: string): number | null => {
  const value = summary?.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/**
 * Each game's headline figure, shown on the results screen, in history and to the admin: the
 * average reach time for Reach and squeeze, the highest balloon popped for Balloon pop and the
 * widest catch for Fruit catch (both shares of the patient's own reach), the flowers grown for
 * Bloom, and the share of notes played for Finger piano. The server's report works out the same
 * figures (app/services/game_measures.py).
 */
export function mainMeasure(gameId: GameId, summary: GameSummary | null): MainMeasure {
  if (gameId === "balloon_pop") {
    const share = percent(detail(summary, DETAIL_HIGHEST_POPPED));
    return {
      labelKey: "measure.highestBalloon",
      value: share === null ? null : { key: "measure.ofReach", params: { value: share } },
    };
  }
  if (gameId === "fruit_catch") {
    const share = percent(detail(summary, DETAIL_WIDEST_CATCH));
    return {
      labelKey: "measure.widestCatch",
      value: share === null ? null : { key: "measure.ofReach", params: { value: share } },
    };
  }
  if (gameId === "finger_piano") {
    const share = percent(detail(summary, DETAIL_NOTE_HIT_RATE));
    return {
      labelKey: "measure.hitRate",
      value: share === null ? null : { key: "measure.ofNotes", params: { value: share } },
    };
  }
  if (gameId === "path_trace") {
    const stars = detail(summary, DETAIL_TOTAL_STARS);
    return {
      labelKey: "measure.stars",
      value: stars === null ? null : { key: "measure.count", params: { value: stars } },
    };
  }
  if (gameId === "paint_wall") {
    return {
      labelKey: "measure.stripesFinished",
      value: summary ? { key: "measure.count", params: { value: summary.successes } } : null,
    };
  }
  if (gameId === "bloom") {
    return {
      labelKey: "measure.flowersGrown",
      value: summary ? { key: "measure.count", params: { value: summary.successes } } : null,
    };
  }
  const seconds = summary ? meanReachSeconds({ summary }) : null;
  return {
    labelKey: "measure.meanReach",
    value: seconds === null ? null : { key: "game.results.seconds", params: { value: seconds } },
  };
}

/**
 * More figures shown beside the headline, for the games that have them: the best openness for
 * Bloom; the finger played best for Finger piano; the average time in the corridor and the best
 * smoothness for Path trace; the best elbow range for Paint the wall. Empty for other games.
 */
export function extraMeasures(gameId: GameId, summary: GameSummary | null): MainMeasure[] {
  if (gameId === "bloom") {
    const share = percent(detail(summary, DETAIL_BEST_OPENNESS));
    return [
      {
        labelKey: "measure.bestOpenness",
        value: share === null ? null : { key: "measure.percent", params: { value: share } },
      },
    ];
  }
  if (gameId === "finger_piano") {
    const best = summary?.details?.[DETAIL_BEST_FINGER];
    const finger = isFinger(best) ? best : null;
    return [
      {
        labelKey: "measure.bestFinger",
        value: finger ? { key: FINGER_LABEL_KEYS[finger], params: {} } : null,
      },
    ];
  }
  if (gameId === "path_trace") {
    const inCorridor = detail(summary, DETAIL_MEAN_IN_CORRIDOR);
    const smoothness = detail(summary, DETAIL_BEST_SPARC);
    return [
      {
        labelKey: "measure.meanInCorridor",
        value:
          inCorridor === null
            ? null
            : { key: "measure.percent", params: { value: Math.round(inCorridor) } },
      },
      {
        labelKey: "measure.bestSmoothness",
        value:
          smoothness === null
            ? null
            : { key: "measure.number", params: { value: Math.round(smoothness * 100) / 100 } },
      },
    ];
  }
  if (gameId === "paint_wall") {
    const range = detail(summary, DETAIL_BEST_RANGE_DEG);
    return [
      {
        labelKey: "measure.bestElbowRange",
        value:
          range === null ? null : { key: "measure.degrees", params: { value: Math.round(range) } },
      },
    ];
  }
  return [];
}

/** The headline and every extra figure of a game, in the order they are shown. */
export function allMeasures(gameId: GameId, summary: GameSummary | null): MainMeasure[] {
  return [mainMeasure(gameId, summary), ...extraMeasures(gameId, summary)];
}

export const FINGER_LABEL_KEYS: Record<FingerName, TranslationKey> = {
  index: "warmup.sequence.index",
  middle: "warmup.sequence.middle",
  ring: "warmup.sequence.ring",
  little: "warmup.sequence.little",
};
export const FINGER_NAMES: readonly FingerName[] = ["index", "middle", "ring", "little"];

export function isFinger(value: unknown): value is FingerName {
  return typeof value === "string" && (FINGER_NAMES as readonly string[]).includes(value);
}

/** The summary detail holding one finger's hit rate in a Finger piano run. */
export const fingerHitRateDetail = (finger: FingerName) => `hit_rate_${finger}`;

export interface FingerTally {
  finger: FingerName;
  hits: number;
  attempts: number;
}

/** Hits and notes asked for each finger, added up over the trials, in finger order. */
export function fingerTallies(
  trials: readonly { metrics: Pick<TrialMetrics, "per_finger">; outcome: TrialOutcome }[],
): FingerTally[] {
  const totals = new Map<FingerName, FingerTally>();
  for (const trial of trials) {
    if (trial.outcome === "aborted") continue;
    for (const [finger, tally] of Object.entries(trial.metrics.per_finger ?? {})) {
      if (!isFinger(finger) || !tally) continue;
      const total = totals.get(finger) ?? { finger, hits: 0, attempts: 0 };
      total.hits += tally.hits;
      total.attempts += tally.attempts;
      totals.set(finger, total);
    }
  }
  return FINGER_NAMES.flatMap((finger) => {
    const total = totals.get(finger);
    return total && total.attempts > 0 ? [total] : [];
  });
}

/**
 * The finger with the highest hit rate; with equal rates, the one with more notes played, then
 * the first in finger order. Null when no note was played.
 */
export function bestFinger(tallies: readonly FingerTally[]): FingerName | null {
  let best: FingerTally | null = null;
  for (const tally of tallies) {
    if (tally.hits === 0) continue;
    const rate = tally.hits / tally.attempts;
    const bestRate = best ? best.hits / best.attempts : -1;
    if (rate > bestRate || (rate === bestRate && best !== null && tally.hits > best.hits)) {
      best = tally;
    }
  }
  return best?.finger ?? null;
}

/** Each finger's hit rate from a Finger piano run's summary, in finger order. */
export function fingerHitRates(
  summary: GameSummary | null,
): { finger: FingerName; rate: number }[] {
  return FINGER_NAMES.flatMap((finger) => {
    const rate = detail(summary, fingerHitRateDetail(finger));
    return rate === null ? [] : [{ finger, rate }];
  });
}

/** The largest value among successful trials, or null if there were none. */
export function bestOfSuccesses(
  trials: readonly { outcome: TrialOutcome; value: number | null | undefined }[],
): number | null {
  const values = trials
    .filter((trial) => trial.outcome === "success")
    .map((trial) => trial.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

export interface TargetMarker {
  key: string;
  /** In the body frame, in shoulder widths. */
  x: number;
  y: number;
  outcome: TrialOutcome;
  compensated: boolean;
}

/** Where every trial's target was, across all runs, for drawing on the reach map. */
export function targetMarkers(runs: readonly GameRunDetail[]): TargetMarker[] {
  return runs.flatMap((run) =>
    run.trials.flatMap((trial) =>
      isSpatialTarget(trial.target)
        ? [
            {
              key: `${run.id}-${trial.trial_no}`,
              x: trial.target.x_sw,
              y: trial.target.y_sw,
              outcome: trial.outcome,
              compensated: trial.compensation.flagged,
            },
          ]
        : [],
    ),
  );
}

export interface MovementPoint {
  trialNo: number;
  /** Seconds; null for a trial that never reached the target. */
  seconds: number | null;
  outcome: TrialOutcome;
}

/** Movement time per trial, in trial order. */
export function movementSeries(trials: readonly TrialRead[]): MovementPoint[] {
  return [...trials]
    .sort((a, b) => a.trial_no - b.trial_no)
    .map((trial) => ({
      trialNo: trial.trial_no,
      seconds:
        trial.metrics.movement_ms === null
          ? null
          : Math.round(trial.metrics.movement_ms / 10) / 100,
      outcome: trial.outcome,
    }));
}

export interface OpennessPoint {
  trialNo: number;
  /** The trial's peak openness, as a percentage; null if none was recorded. */
  peak: number | null;
  /** The openness the trial asked for, as a percentage; null if not in its settings. */
  demand: number | null;
}

/** Bloom's peak openness per trial, with each trial's demand, in trial order. */
export function opennessSeries(
  trials: readonly Pick<TrialRead, "trial_no" | "outcome" | "metrics" | "params">[],
): OpennessPoint[] {
  return [...trials]
    .filter((trial) => trial.outcome !== "aborted")
    .sort((a, b) => a.trial_no - b.trial_no)
    .map((trial) => {
      const demand = trial.params.open_demand;
      return {
        trialNo: trial.trial_no,
        peak: percent(trial.metrics.peak_openness),
        demand: typeof demand === "number" && Number.isFinite(demand) ? percent(demand) : null,
      };
    });
}

export interface RangePoint {
  trialNo: number;
  /** The elbow range reached in the stripe, in degrees; null if not measured. */
  range: number | null;
  /** The range the stripe asked for: its share of the patient's elbow range, in degrees. */
  target: number | null;
}

/** Paint the wall's elbow range per stripe, with the range each one asked for, in trial order. */
export function rangeSeries(
  trials: readonly Pick<TrialRead, "trial_no" | "outcome" | "metrics" | "params">[],
): RangePoint[] {
  return [...trials]
    .filter((trial) => trial.outcome !== "aborted")
    .sort((a, b) => a.trial_no - b.trial_no)
    .map((trial) => {
      const {
        required_range_frac: share,
        elbow_bent_deg: bent,
        elbow_straight_deg: straight,
      } = trial.params;
      const usable = [share, bent, straight].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      );
      const range = trial.metrics.achieved_range_deg;
      return {
        trialNo: trial.trial_no,
        range: typeof range === "number" ? Math.round(range * 10) / 10 : null,
        target: usable ? Math.round(share * (straight - bent) * 10) / 10 : null,
      };
    });
}
