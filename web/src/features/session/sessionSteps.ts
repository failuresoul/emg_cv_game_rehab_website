import type { TranslationKey } from "@/i18n";
import type { GameId, GameQueueState, SessionStep } from "@/types/api";

import { cleanTrials, currentGame, type GameQueue } from "./gameQueue";

export const SESSION_STEPS: readonly SessionStep[] = [
  "setup",
  "calibrate",
  "warmup",
  "plan",
  "game",
  "cooldown",
  "summary",
];

/** The steps shown in the progress bar. The plan and the games share "Games". */
export const BAR_STEPS: readonly { id: string; labelKey: TranslationKey }[] = [
  { id: "setup", labelKey: "sessionBar.setup" },
  { id: "calibrate", labelKey: "sessionBar.calibrate" },
  { id: "warmup", labelKey: "sessionBar.warmup" },
  { id: "games", labelKey: "sessionBar.games" },
  { id: "cooldown", labelKey: "sessionBar.cooldown" },
];

const BAR_INDEX: Record<SessionStep, number> = {
  setup: 0,
  calibrate: 1,
  warmup: 2,
  plan: 3,
  game: 3,
  cooldown: 4,
  // Past the last bar step: everything is done.
  summary: BAR_STEPS.length,
};

/** The bar step to highlight; BAR_STEPS.length on the summary, when every step is done. */
export function barIndex(step: SessionStep): number {
  return BAR_INDEX[step];
}

/** The step a session page belongs to, or null for any other address. */
export function stepForPath(pathname: string): SessionStep | null {
  const match = /^\/session\/([a-z]+)(?:\/|$)/.exec(pathname);
  const segment = match?.[1];
  return SESSION_STEPS.find((step) => step === segment) ?? null;
}

/** Where a saved step resumes. For the games, the current game; after the last, the cool-down. */
export function pathForStep(step: SessionStep, queue: GameQueue | null): string {
  if (step !== "game") return `/session/${step}`;
  if (!queue) return "/session/plan";
  const game = currentGame(queue);
  return game ? `/session/game/${game}` : "/session/cooldown";
}

/** The server's queue as the app's queue, or null if it names a game this app does not know. */
export function queueFromServer(
  sessionId: number,
  state: GameQueueState | null | undefined,
  validIds: readonly GameId[],
): GameQueue | null {
  if (!state || state.games.length === 0) return null;
  if (!state.games.every((id) => validIds.includes(id))) return null;
  const index = Math.max(0, Math.min(state.index, state.games.length));
  const trials = cleanTrials(state.trials, state.games);
  return trials
    ? { sessionId, games: [...state.games], index, trials }
    : { sessionId, games: [...state.games], index };
}

/** The first item of `order` not yet done, or null when all are done. */
export function firstUnfinished<T>(order: readonly T[], done: Iterable<T>): T | null {
  const finished = new Set(done);
  return order.find((item) => !finished.has(item)) ?? null;
}

/** The server ends active sessions this old, so they cannot be resumed. */
export const RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface ResumableSession {
  id: number;
  status: string;
  started_at: string;
  current_step: SessionStep;
  game_queue: GameQueueState | null;
}

export type ResumeDecision =
  /** No session to resume: start a new one as usual. */
  | { kind: "none" }
  /** Already on the saved step, such as after a refresh: carry on without asking. */
  | { kind: "stay" }
  /** Ask: "Continue your session" goes to `path`, "Start over" ends the old session. */
  | { kind: "offer"; path: string; step: SessionStep };

/**
 * Whether to offer to continue an active session, from the patient home page (pathname
 * "/patient") or a session page.
 */
export function decideResume(
  session: ResumableSession | null | undefined,
  pathname: string,
  validIds: readonly GameId[],
  now: number = Date.now(),
): ResumeDecision {
  if (!session || session.status !== "active") return { kind: "none" };
  const startedAt = Date.parse(session.started_at);
  if (!Number.isFinite(startedAt) || now - startedAt >= RESUME_MAX_AGE_MS) return { kind: "none" };

  const queue = queueFromServer(session.id, session.game_queue, validIds);
  const path = pathForStep(session.current_step, queue);
  const step = session.current_step;
  const here = stepForPath(pathname);
  if (here === null) {
    // Off the session pages, such as the home page: always worth offering.
    return { kind: "offer", path, step };
  }
  if (pathname === path) return { kind: "stay" };
  // Nothing done yet: wherever the patient is, there is nothing to go back to.
  if (step === "setup") return { kind: "stay" };
  return { kind: "offer", path, step };
}
