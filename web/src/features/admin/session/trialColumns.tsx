import type { ReactNode } from "react";

import { MarkerShape } from "@/components/ReachMap";
import { t, type TranslationKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { GameId, TrialRead } from "@/types/api";

import { OUTCOME_STYLE, outcomeLabelKey } from "./outcomes";

export interface TrialColumn {
  key: TranslationKey;
  cell: (trial: TrialRead, gameId: GameId) => ReactNode;
  /** Numbers line up better right next to each other. */
  numeric?: boolean;
}

const dash = "–";
const whole = (value: number | null | undefined) =>
  value === null || value === undefined ? dash : formatNumber(value, 0);
const decimal = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? dash : formatNumber(value, digits);
const share = (value: number | null | undefined) =>
  value === null || value === undefined
    ? dash
    : t("patient.lastSession.percent", { value: Math.round(value * 100) });

const COMPENSATION_KEYS: Record<string, TranslationKey> = {
  trunk: "adminSession.compensation.trunk",
  lean: "adminSession.compensation.lean",
  shoulder: "adminSession.compensation.shoulder",
  upper_arm: "adminSession.compensation.upperArm",
};

/** "trunk+lean" as words; unknown kinds are shown as saved. */
export function compensationText(trial: TrialRead): string {
  if (!trial.compensation.flagged) return t("adminSession.compensatedNo");
  const type = trial.compensation.type;
  if (!type) return t("adminSession.compensatedYes");
  return type
    .split("+")
    .map((kind) => (COMPENSATION_KEYS[kind] ? t(COMPENSATION_KEYS[kind]) : kind))
    .join(", ");
}

function OutcomeCell({ trial, gameId }: { trial: TrialRead; gameId: GameId }) {
  const style = OUTCOME_STYLE[trial.outcome];
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
        <MarkerShape shape={style.shape} x={8} y={8} size={5} color={style.color} />
      </svg>
      {t(outcomeLabelKey(gameId, trial.outcome))}
    </span>
  );
}

const outcome: TrialColumn = {
  key: "adminSession.column.outcome",
  cell: (trial, gameId) => <OutcomeCell trial={trial} gameId={gameId} />,
};
const sector: TrialColumn = {
  key: "adminSession.column.sector",
  cell: (trial) => trial.target?.sector ?? dash,
};
const reaction: TrialColumn = {
  key: "adminSession.column.reaction",
  cell: (trial) => whole(trial.metrics.reaction_ms),
  numeric: true,
};
const movement: TrialColumn = {
  key: "adminSession.column.movement",
  cell: (trial) => whole(trial.metrics.movement_ms),
  numeric: true,
};
const efficiency: TrialColumn = {
  key: "adminSession.column.efficiency",
  cell: (trial) => decimal(trial.metrics.path_efficiency),
  numeric: true,
};
const compensated: TrialColumn = {
  key: "adminSession.column.compensated",
  cell: (trial) => compensationText(trial),
};

const FAILED_PHASE_KEYS: Record<"open" | "close" | "hold" | "relax", TranslationKey> = {
  open: "adminSession.phase.open",
  close: "adminSession.phase.close",
  hold: "adminSession.phase.hold",
  relax: "adminSession.phase.relax",
};

const bloomColumns: readonly TrialColumn[] = [
  {
    key: "adminSession.column.timeToOpen",
    cell: (trial) => whole(trial.metrics.time_to_open_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.peakOpenness",
    cell: (trial) => share(trial.metrics.peak_openness),
    numeric: true,
  },
  {
    key: "adminSession.column.holdStability",
    cell: (trial) => decimal(trial.metrics.hold_stability, 3),
    numeric: true,
  },
  {
    key: "adminSession.column.timeToClose",
    cell: (trial) => whole(trial.metrics.time_to_close_ms),
    numeric: true,
  },
  outcome,
  {
    key: "adminSession.column.failedPhase",
    cell: (trial) =>
      trial.metrics.failed_phase ? t(FAILED_PHASE_KEYS[trial.metrics.failed_phase]) : dash,
  },
  compensated,
];

const FINGER_SHORT_KEYS: Record<string, TranslationKey> = {
  index: "warmup.sequence.index",
  middle: "warmup.sequence.middle",
  ring: "warmup.sequence.ring",
  little: "warmup.sequence.little",
};

export const SHAPE_KEYS: Record<string, TranslationKey> = {
  line: "shape.line",
  arc: "shape.arc",
  s_curve: "shape.s_curve",
  circle_part: "shape.circle_part",
};

const percentOf100 = (value: number | null | undefined) =>
  value === null || value === undefined
    ? dash
    : t("patient.lastSession.percent", { value: Math.round(value) });
const degrees = (value: number | null | undefined) =>
  value === null || value === undefined
    ? dash
    : t("adminSession.degrees", { value: Math.round(value) });

const pathTraceColumns: readonly TrialColumn[] = [
  {
    key: "adminSession.column.shape",
    cell: (trial) => {
      const shape = trial.target?.shape;
      return shape ? (SHAPE_KEYS[shape] ? t(SHAPE_KEYS[shape]) : shape) : dash;
    },
  },
  {
    key: "adminSession.column.inCorridor",
    cell: (trial) => percentOf100(trial.metrics.time_in_corridor_pct),
    numeric: true,
  },
  {
    key: "adminSession.column.trackingError",
    cell: (trial) => decimal(trial.metrics.mean_tracking_error_sw, 3),
    numeric: true,
  },
  {
    key: "adminSession.column.lag",
    cell: (trial) => whole(trial.metrics.lag_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.sparc",
    cell: (trial) => decimal(trial.metrics.sparc),
    numeric: true,
  },
  outcome,
  compensated,
];

const paintWallColumns: readonly TrialColumn[] = [
  {
    key: "adminSession.column.elbowRange",
    cell: (trial) => degrees(trial.metrics.achieved_range_deg),
    numeric: true,
  },
  {
    key: "adminSession.column.sweeps",
    cell: (trial) =>
      trial.metrics.full_sweeps == null
        ? dash
        : t("adminSession.sweepsValue", {
            full: trial.metrics.full_sweeps,
            partial: trial.metrics.partial_sweeps ?? 0,
          }),
    numeric: true,
  },
  {
    key: "adminSession.column.meanSweep",
    cell: (trial) => whole(trial.metrics.mean_sweep_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.angularSparc",
    cell: (trial) => decimal(trial.metrics.angular_sparc),
    numeric: true,
  },
  {
    key: "adminSession.column.upperArm",
    cell: (trial) => degrees(trial.metrics.upper_arm_motion_deg),
    numeric: true,
  },
  outcome,
  compensated,
];

const fingerPianoColumns: readonly TrialColumn[] = [
  {
    key: "adminSession.column.melody",
    cell: (trial) =>
      trial.target?.notes
        ?.map((note) => (FINGER_SHORT_KEYS[note] ? t(FINGER_SHORT_KEYS[note]) : note))
        .join(" · ") ?? dash,
  },
  {
    key: "adminSession.column.notesHit",
    cell: (trial) =>
      trial.metrics.hits == null || trial.metrics.notes_total == null
        ? dash
        : t("gameResults.successesValue", {
            done: trial.metrics.hits,
            total: trial.metrics.notes_total,
          }),
    numeric: true,
  },
  {
    key: "adminSession.column.wrongFinger",
    cell: (trial) => whole(trial.metrics.wrong_finger),
    numeric: true,
  },
  {
    key: "adminSession.column.missedNotes",
    cell: (trial) => whole(trial.metrics.missed),
    numeric: true,
  },
  {
    key: "adminSession.column.timingError",
    cell: (trial) => whole(trial.metrics.mean_timing_error_ms),
    numeric: true,
  },
  outcome,
  compensated,
];

const SOURCE_KEYS: Record<string, TranslationKey> = {
  cv_grip: "game.source.webcam",
  keyboard: "game.source.keyboard",
  emg: "game.source.emg",
};

const pickPlaceColumns: readonly TrialColumn[] = [
  {
    key: "adminSession.column.reachTime",
    cell: (trial) => whole(trial.metrics.reach_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.graspLatency",
    cell: (trial) => whole(trial.metrics.grasp_latency_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.transport",
    cell: (trial) => whole(trial.metrics.transport_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.drops",
    cell: (trial) => whole(trial.metrics.drops),
    numeric: true,
  },
  {
    key: "adminSession.column.releaseError",
    cell: (trial) => decimal(trial.metrics.release_error_sw),
    numeric: true,
  },
  outcome,
  compensated,
];

const gripHoldColumns: readonly TrialColumn[] = [
  {
    key: "adminSession.column.timeToBand",
    cell: (trial) => whole(trial.metrics.time_to_band_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.inBand",
    cell: (trial) =>
      trial.metrics.time_in_band_pct == null
        ? dash
        : t("patient.lastSession.percent", { value: Math.round(trial.metrics.time_in_band_pct) }),
    numeric: true,
  },
  {
    key: "adminSession.column.longestHold",
    cell: (trial) => whole(trial.metrics.longest_continuous_hold_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.overshoots",
    cell: (trial) => whole(trial.metrics.overshoot_count),
    numeric: true,
  },
  {
    key: "adminSession.column.steadiness",
    cell: (trial) => decimal(trial.metrics.steadiness, 3),
    numeric: true,
  },
  {
    key: "adminSession.column.relaxation",
    cell: (trial) => whole(trial.metrics.relaxation_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.inputSource",
    cell: (trial) => {
      const source = trial.metrics.input_source;
      return source ? t(SOURCE_KEYS[source] ?? "game.source.webcam") : dash;
    },
  },
  outcome,
  {
    key: "adminSession.column.failedPhase",
    cell: (trial) =>
      trial.metrics.failed_phase ? t(FAILED_PHASE_KEYS[trial.metrics.failed_phase]) : dash,
  },
  compensated,
];

/** The trial table's columns, after the trial number, for each game. */
export const TRIAL_COLUMNS: Partial<Record<GameId, readonly TrialColumn[]>> = {
  reach_activate: [
    sector,
    outcome,
    reaction,
    movement,
    efficiency,
    {
      key: "adminSession.column.latency",
      cell: (trial) => whole(trial.metrics.activation_latency_ms),
      numeric: true,
    },
    compensated,
  ],
  balloon_pop: [
    sector,
    {
      key: "adminSession.column.height",
      cell: (trial) => share(trial.target?.distance_frac),
      numeric: true,
    },
    outcome,
    reaction,
    movement,
    efficiency,
    {
      key: "adminSession.column.armElevation",
      cell: (trial) =>
        trial.metrics.peak_arm_elevation_deg == null
          ? dash
          : t("adminSession.degrees", { value: Math.round(trial.metrics.peak_arm_elevation_deg) }),
      numeric: true,
    },
    compensated,
  ],
  fruit_catch: [
    {
      key: "adminSession.column.side",
      cell: (trial) =>
        trial.metrics.side ? t(trial.metrics.side === "out" ? "side.out" : "side.across") : dash,
    },
    {
      key: "adminSession.column.lateralDistance",
      cell: (trial) => decimal(trial.metrics.lateral_distance_sw),
      numeric: true,
    },
    outcome,
    reaction,
    movement,
    {
      key: "adminSession.column.lateralEfficiency",
      cell: (trial) => decimal(trial.metrics.lateral_path_efficiency),
      numeric: true,
    },
    {
      key: "adminSession.column.overshoot",
      cell: (trial) => decimal(trial.metrics.overshoot_sw),
      numeric: true,
    },
    compensated,
  ],
  bloom: bloomColumns,
  finger_piano: fingerPianoColumns,
  path_trace: pathTraceColumns,
  paint_wall: paintWallColumns,
  pick_place: pickPlaceColumns,
  grip_hold: gripHoldColumns,
};

/** Games without their own list show the reaching columns. */
export function columnsFor(gameId: GameId): readonly TrialColumn[] {
  return TRIAL_COLUMNS[gameId] ?? (TRIAL_COLUMNS.reach_activate as readonly TrialColumn[]);
}
