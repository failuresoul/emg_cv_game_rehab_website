import { useCallback, useEffect, useState } from "react";

import type { GameDefinition, GameFactory } from "./types";

export type FactoryState =
  | { state: "loading"; retry: () => void }
  | { state: "failed"; retry: () => void }
  | { state: "ready"; create: GameFactory; retry: () => void };

/** Loads a game's code (its own chunk) once; a failed download can be tried again. */
export function useGameFactory(definition: GameDefinition): FactoryState {
  const [result, setResult] = useState<{ id: string; create: GameFactory } | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setResult(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    definition
      .load()
      .then((create) => {
        if (!cancelled) setResult({ id: definition.id, create });
      })
      .catch(() => {
        if (!cancelled) setResult("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [definition, attempt]);

  if (result === "failed") return { state: "failed", retry };
  if (result === null || result.id !== definition.id) return { state: "loading", retry };
  return { state: "ready", create: result.create, retry };
}
