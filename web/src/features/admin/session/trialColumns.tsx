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

const FAILED_PHASE_KEYS: Record<"open" | "close", TranslationKey> = {
  open: "adminSession.phase.open",
  close: "adminSession.phase.close",
};

const bloomColumns: readonly TrialColumn[] = [
  outcome,
  {
    key: "adminSession.column.failedPhase",
    cell: (trial) =>
      trial.metrics.failed_phase ? t(FAILED_PHASE_KEYS[trial.metrics.failed_phase]) : dash,
  },
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
    key: "adminSession.column.riseRate",
    cell: (trial) => decimal(trial.metrics.openness_rise_rate),
    numeric: true,
  },
  {
    key: "adminSession.column.timeToClose",
    cell: (trial) => whole(trial.metrics.time_to_close_ms),
    numeric: true,
  },
  {
    key: "adminSession.column.peakGrip",
    cell: (trial) => share(trial.metrics.peak_grip),
    numeric: true,
  },
  compensated,
];

const FINGER_SHORT_KEYS: Record<string, TranslationKey> = {
  index: "warmup.sequence.index",
  middle: "warmup.sequence.middle",
  ring: "warmup.sequence.ring",
  little: "warmup.sequence.little",
};

const fingerPianoColumns: readonly TrialColumn[] = [
  {
    key: "adminSession.column.melody",
    cell: (trial) =>
      trial.target?.notes
        ?.map((note) => (FINGER_SHORT_KEYS[note] ? t(FINGER_SHORT_KEYS[note]) : note))
        .join(" · ") ?? dash,
  },
  outcome,
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
    key: "adminSession.column.hitRate",
    cell: (trial) => share(trial.metrics.hit_rate),
    numeric: true,
  },
  {
    key: "adminSession.column.timingError",
    cell: (trial) => whole(trial.metrics.mean_timing_error_ms),
    numeric: true,
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
};

/** Games without their own list show the reaching columns. */
export function columnsFor(gameId: GameId): readonly TrialColumn[] {
  return TRIAL_COLUMNS[gameId] ?? (TRIAL_COLUMNS.reach_activate as readonly TrialColumn[]);
}
