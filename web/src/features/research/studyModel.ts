import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { t, type TranslationKey } from "@/i18n";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { SILENT } from "@/lib/apiErrors";
import type {
  ConditionResult,
  EngineMode,
  Estimate,
  GameId,
  Study,
  StudyCreate,
  StudyParticipant,
  StudyProgress,
  StudyResults,
  StudyUpdate,
} from "@/types/api";

export const STUDIES_KEY = ["admin", "studies"] as const;
export const ENGINE_MODES: readonly EngineMode[] = ["L0", "L1", "L2"];

export const CONDITION_LABEL_KEYS: Record<EngineMode, TranslationKey> = {
  L0: "adminLevels.mode.L0",
  L1: "adminLevels.mode.L1",
  L2: "adminLevels.mode.L2",
};

export const STATUS_LABEL_KEYS: Record<Study["status"], TranslationKey> = {
  draft: "study.status.draft",
  active: "study.status.active",
  closed: "study.status.closed",
};

// ---- The form ---------------------------------------------------------------------------------

export interface StudyDraft {
  name: string;
  description: string;
  design: StudyCreate["design"];
  conditions: EngineMode[];
  sessions_per_condition: number;
  games: GameId[];
}

export const EMPTY_DRAFT: StudyDraft = {
  name: "",
  description: "",
  design: "within_subject",
  conditions: ["L0", "L1", "L2"],
  sessions_per_condition: 2,
  games: ["reach_activate", "grip_hold", "bloom"],
};

export function draftOf(study: Study): StudyDraft {
  return {
    name: study.name,
    description: study.description ?? "",
    design: study.design,
    conditions: [...study.conditions],
    sessions_per_condition: study.sessions_per_condition,
    games: [...study.games],
  };
}

/** The server's rules, worded for the admin; empty when the study can be saved. */
export function validateStudy(draft: StudyDraft): TranslationKey[] {
  const problems: TranslationKey[] = [];
  if (draft.name.trim() === "") problems.push("study.error.name");
  if (draft.conditions.length < 2) problems.push("study.error.conditions");
  if (
    !Number.isInteger(draft.sessions_per_condition) ||
    draft.sessions_per_condition < 1 ||
    draft.sessions_per_condition > 20
  ) {
    problems.push("study.error.sessions");
  }
  if (draft.games.length === 0) problems.push("study.error.games");
  return problems;
}

/** Keeps the conditions in L0, L1, L2 order. */
export function toggleCondition(draft: StudyDraft, mode: EngineMode, on: boolean): StudyDraft {
  const chosen = new Set(draft.conditions);
  if (on) chosen.add(mode);
  else chosen.delete(mode);
  return { ...draft, conditions: ENGINE_MODES.filter((m) => chosen.has(m)) };
}

/** Games keep the order they were turned on in: that is the order every session plays them. */
export function toggleGame(draft: StudyDraft, game: GameId, on: boolean): StudyDraft {
  const games = draft.games.filter((g) => g !== game);
  return { ...draft, games: on ? [...games, game] : games };
}

export function toPayload(draft: StudyDraft): StudyCreate {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    design: draft.design,
    conditions: draft.conditions,
    sessions_per_condition: draft.sessions_per_condition,
    games: draft.games,
  };
}

/** A participant's conditions, such as "L0 → L2 → L1" (admin only). */
export function conditionsText(participant: StudyParticipant): string {
  const order =
    participant.condition_order ??
    (participant.assigned_condition ? [participant.assigned_condition] : []);
  return order.map((mode) => t(CONDITION_LABEL_KEYS[mode])).join(" → ");
}

// ---- Results ----------------------------------------------------------------------------------

export interface ResultMetric {
  key: keyof Pick<
    ConditionResult,
    | "success_rate"
    | "challenge_error"
    | "time_in_zone"
    | "compensation_rate"
    | "mean_level"
    | "enjoyment"
    | "fatigue"
    | "report_rating"
  >;
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  /** Drawn and shown times this (100 for shares, so they read as percentages). */
  scale: number;
  percent: boolean;
  domain?: [number, number];
}

export const RESULT_METRICS: readonly ResultMetric[] = [
  {
    key: "success_rate",
    titleKey: "study.metric.success",
    hintKey: "study.hint.higher",
    scale: 100,
    percent: true,
    domain: [0, 100],
  },
  {
    key: "challenge_error",
    titleKey: "study.metric.challenge",
    hintKey: "study.hint.lower",
    scale: 1,
    percent: false,
  },
  {
    key: "time_in_zone",
    titleKey: "study.metric.zone",
    hintKey: "study.hint.higher",
    scale: 100,
    percent: true,
    domain: [0, 100],
  },
  {
    key: "compensation_rate",
    titleKey: "study.metric.compensation",
    hintKey: "study.hint.lower",
    scale: 100,
    percent: true,
    domain: [0, 100],
  },
  {
    key: "mean_level",
    titleKey: "study.metric.level",
    hintKey: "study.hint.level",
    scale: 1,
    percent: false,
    domain: [0, 10],
  },
  {
    key: "enjoyment",
    titleKey: "study.metric.enjoyment",
    hintKey: "study.hint.higher",
    scale: 1,
    percent: false,
    domain: [0, 5],
  },
  {
    key: "fatigue",
    titleKey: "study.metric.fatigue",
    hintKey: "study.hint.lower",
    scale: 1,
    percent: false,
    domain: [0, 10],
  },
  {
    key: "report_rating",
    titleKey: "study.metric.rating",
    hintKey: "study.hint.higher",
    scale: 1,
    percent: false,
    domain: [0, 5],
  },
];

export interface ResultBar {
  condition: EngineMode;
  label: string;
  mean: number | null;
  /** Below and above the mean, for the error bar; null without an interval. */
  error: [number, number] | null;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** One bar per condition, with its 95% interval, scaled for display. */
export function resultBars(results: StudyResults, metric: ResultMetric): ResultBar[] {
  return results.conditions.map((condition) => {
    const estimate: Estimate = condition[metric.key];
    const scaled = (value: number | null) => (value === null ? null : round(value * metric.scale));
    const mean = scaled(estimate.mean);
    const low = scaled(estimate.ci_low);
    const high = scaled(estimate.ci_high);
    return {
      condition: condition.condition,
      label: t(CONDITION_LABEL_KEYS[condition.condition]),
      mean,
      error:
        mean !== null && low !== null && high !== null
          ? [round(mean - low), round(high - mean)]
          : null,
      ciLow: low,
      ciHigh: high,
      n: estimate.n,
    };
  });
}

/** A value as shown: "72%" for shares, "0.12" or "6.5" otherwise. */
export function formatResult(metric: ResultMetric, value: number | null): string {
  if (value === null) return "–";
  const digits = metric.percent ? 0 : metric.key === "challenge_error" ? 2 : 1;
  const text = formatNumber(value, digits);
  return metric.percent ? t("measure.percent", { value: text }) : text;
}

// ---- Hooks ------------------------------------------------------------------------------------

export function useStudies() {
  return useQuery({
    queryKey: STUDIES_KEY,
    queryFn: async () => (await api.get<Study[]>("/admin/studies")).data,
  });
}

export function useStudyProgress(id: number | null) {
  return useQuery({
    queryKey: [...STUDIES_KEY, id, "progress"],
    queryFn: async () => (await api.get<StudyProgress>(`/admin/studies/${id}/progress`)).data,
    enabled: id !== null,
    placeholderData: keepPreviousData,
  });
}

export function useStudyResults(id: number | null) {
  return useQuery({
    queryKey: [...STUDIES_KEY, id, "results"],
    queryFn: async () => (await api.get<StudyResults>(`/admin/studies/${id}/results`)).data,
    enabled: id !== null,
  });
}

function useInvalidateStudies() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: STUDIES_KEY });
}

export function useSaveStudy(id: number | null) {
  const invalidate = useInvalidateStudies();
  return useMutation({
    mutationFn: async (payload: StudyCreate | StudyUpdate) =>
      id === null
        ? (await api.post<Study>("/admin/studies", payload)).data
        : (await api.patch<Study>(`/admin/studies/${id}`, payload)).data,
    meta: SILENT,
    onSuccess: invalidate,
  });
}

export function useDeleteStudy() {
  const invalidate = useInvalidateStudies();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/studies/${id}`);
    },
    meta: SILENT,
    onSuccess: invalidate,
  });
}

export function useEnrol(id: number) {
  const invalidate = useInvalidateStudies();
  return useMutation({
    mutationFn: async (patientId: number) =>
      (
        await api.post<StudyParticipant>(`/admin/studies/${id}/participants`, {
          patient_id: patientId,
        })
      ).data,
    meta: SILENT,
    onSuccess: invalidate,
  });
}

export function useWithdraw(id: number) {
  const invalidate = useInvalidateStudies();
  return useMutation({
    mutationFn: async (participantId: number) =>
      (
        await api.post<StudyParticipant>(
          `/admin/studies/${id}/participants/${participantId}/withdraw`,
        )
      ).data,
    meta: SILENT,
    onSuccess: invalidate,
  });
}
