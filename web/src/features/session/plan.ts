import { useQuery } from "@tanstack/react-query";

import { t, type TranslationKey } from "@/i18n";
import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";
import type { GameId, PlannedGame, SessionPlan } from "@/types/api";

import type { PlanRow } from "./gameQueue";

/** Today's plan from the planner; made once per session on the server. */
export function useSessionPlan(sessionId: number | null) {
  return useQuery({
    queryKey: ["session", sessionId, "plan"],
    queryFn: async () => (await api.get<SessionPlan>(`/sessions/${sessionId}/plan`)).data,
    enabled: sessionId !== null,
    staleTime: Infinity,
    retry: 1,
    meta: SILENT,
  });
}

/** Records the games the patient kept and their order, for analysis; quietly. */
export async function sendPlanOverride(sessionId: number, games: readonly GameId[]) {
  try {
    await api.post(`/sessions/${sessionId}/plan/override`, { games });
  } catch {
    // Only analysis data: the session carries on.
  }
}

const MOVEMENTS = [
  "reach",
  "shoulder",
  "elbow",
  "hand_opening",
  "fingers",
  "grip",
  "smoothness",
] as const;
type Movement = (typeof MOVEMENTS)[number];

const isMovement = (value: unknown): value is Movement =>
  typeof value === "string" && (MOVEMENTS as readonly string[]).includes(value);

/** A movement in plain words, such as "opening your hand". */
export function movementWords(movement: string): string {
  return isMovement(movement) ? t(`plan.movement.${movement}` as TranslationKey) : movement;
}

/** A reach direction in plain words, such as "up and out". */
export function directionWords(degrees: number): string {
  const rounded = (((Math.round(degrees / 45) * 45) % 360) + 360) % 360;
  return t(`calibrate.direction.${rounded}` as TranslationKey).toLowerCase();
}

/** "Why this game?" in plain words, from the planner's reason key. Never a word about "AI". */
export function reasonText(game: Pick<PlannedGame, "reason_key" | "reason_params">): string {
  const { reason_key: key, reason_params: params } = game;
  if (key.startsWith("focus_")) {
    const movement = key.slice("focus_".length);
    if (isMovement(movement)) return t(`plan.reason.focus.${movement}` as TranslationKey);
  }
  switch (key) {
    case "practise_weak_direction": {
      const degrees = Number(params.direction_deg);
      return Number.isFinite(degrees)
        ? t("plan.reason.weakDirection", { direction: directionWords(degrees) })
        : t("plan.reason.keepPractising", { movement: "" });
    }
    case "variety":
      return t("plan.reason.variety");
    case "favourite":
      return t("plan.reason.favourite");
    case "lighter_today":
      return t("plan.reason.lighter");
    case "balance":
      return t("plan.reason.balance", { movement: movementWords(String(params.movement ?? "")) });
    default:
      return t("plan.reason.keepPractising", {
        movement: movementWords(String(params.movement ?? "")),
      });
  }
}

/** The rows the plan page starts with: the plan's games ticked and in order, then every other
 * available game unticked. Games the plan names that are not available are left out. */
export function planRows(plan: SessionPlan, available: readonly GameId[]): PlanRow[] {
  const planned = plan.games.map((game) => game.game_id).filter((id) => available.includes(id));
  return [
    ...planned.map((id) => ({ id, selected: true })),
    ...available.filter((id) => !planned.includes(id)).map((id) => ({ id, selected: false })),
  ];
}

/** The ticked games, in order, differ from the plan's. */
export function changedFromPlan(rows: readonly PlanRow[], plan: SessionPlan | undefined): boolean {
  if (!plan) return false;
  const chosen = rows.filter((row) => row.selected).map((row) => row.id);
  const planned = plan.games.map((game) => game.game_id);
  return chosen.length !== planned.length || chosen.some((id, index) => id !== planned[index]);
}
