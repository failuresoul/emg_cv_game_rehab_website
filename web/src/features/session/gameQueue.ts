import type { GameId } from "@/types/api";

/** The games chosen for this session, in order, and how far through them the patient is. */
export interface GameQueue {
  sessionId: number;
  games: GameId[];
  /** The game being played or about to be played. Equal to games.length once all are done. */
  index: number;
}

/**
 * Today's games when the plan opens, in this order: reaching, raising the arm, opening the hand
 * and finger control, about 16 minutes. Other games are listed after them, unticked.
 */
export const DEFAULT_PLAN: readonly GameId[] = [
  "reach_activate",
  "balloon_pop",
  "bloom",
  "finger_piano",
];

export interface PlanRow {
  id: GameId;
  selected: boolean;
}

/** The plan as it first shows: the default games ticked and first, then the rest unticked. */
export function defaultPlanRows(available: readonly GameId[]): PlanRow[] {
  const chosen = DEFAULT_PLAN.filter((id) => available.includes(id));
  const others = available.filter((id) => !chosen.includes(id));
  return [
    ...chosen.map((id) => ({ id, selected: true })),
    ...others.map((id) => ({ id, selected: false })),
  ];
}

const STORAGE_PREFIX = "motionlab.gameQueue.";

export function createQueue(sessionId: number, games: readonly GameId[]): GameQueue {
  return { sessionId, games: [...games], index: 0 };
}

/** The game to play now, or null once every game is done. */
export function currentGame(queue: GameQueue | null): GameId | null {
  return queue && queue.index < queue.games.length ? queue.games[queue.index] : null;
}

/**
 * The game after `gameId` in the queue, or null if it is the last one or not in the queue (for
 * example a game opened directly), in which case the session moves on to the cool-down.
 */
export function nextAfter(queue: GameQueue | null, gameId: GameId): GameId | null {
  if (!queue) return null;
  const position = queue.games.indexOf(gameId, Math.min(queue.index, queue.games.length));
  const from = position >= 0 ? position : queue.games.indexOf(gameId);
  if (from < 0) return null;
  return queue.games[from + 1] ?? null;
}

/** The queue once `gameId` is finished: it points at the following game. */
export function finishGame(queue: GameQueue, gameId: GameId): GameQueue {
  const position = queue.games.indexOf(gameId, Math.min(queue.index, queue.games.length));
  const from = position >= 0 ? position : queue.games.indexOf(gameId);
  if (from < 0) return queue;
  return { ...queue, index: Math.max(queue.index, from + 1) };
}

/** Moves the game at `from` one place up (-1) or down (+1); unchanged at either end. */
export function move<T>(items: readonly T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Keeps the queue for the browser tab, so a refresh carries on where the patient was. Storage can
 * be unavailable (private windows, blocked site data); the queue then lasts until a refresh.
 */
export function saveQueue(queue: GameQueue | null, storage: Storage | undefined = globalStorage()) {
  if (!storage || !queue) return;
  try {
    storage.setItem(STORAGE_PREFIX + queue.sessionId, JSON.stringify(queue));
  } catch {
    // Not kept: fine for this tab.
  }
}

export function loadQueue(
  sessionId: number,
  validIds: readonly GameId[],
  storage: Storage | undefined = globalStorage(),
): GameQueue | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_PREFIX + sessionId);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { games, index } = value as { games?: unknown; index?: unknown };
    if (!Array.isArray(games) || typeof index !== "number" || !Number.isInteger(index)) return null;
    const known = games.filter((id): id is GameId => validIds.includes(id as GameId));
    if (known.length !== games.length) return null;
    return { sessionId, games: known, index: Math.max(0, Math.min(index, known.length)) };
  } catch {
    return null;
  }
}

function globalStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
