import { useCallback, useEffect, useMemo, useState } from "react";

import type { Side } from "@/types/api";
import { visionEngine } from "@/vision/visionEngine";

import { CvGripSource, DEFAULT_GRIP_REFS, type GripRefs } from "./cvGripSource";
import { EmgSource } from "./emgSource";
import { DEFAULT_SOURCE_ID, InputManager } from "./inputManager";
import { KeyboardSource } from "./keyboardSource";
import type { ActivationSourceId } from "./types";

export interface UseActivationOptions {
  affectedSide: Side | null;
  refs?: GripRefs;
  /**
   * Re-render with every new level. Leave it on for a meter; a game's own animation loop should
   * turn it off and call getLevel() each frame instead.
   */
  liveLevel?: boolean;
}

export interface ActivationValue {
  sourceId: ActivationSourceId;
  level: number;
  ready: boolean;
  /** The current level, read without waiting for React. Stable between renders. */
  getLevel: () => number;
  /** Null until the affected side is known. */
  manager: InputManager | null;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The activation level from the camera (closing the affected hand) by default. In development
 * builds, pressing K turns keyboard input (hold Space) on and off.
 */
export function useActivation({
  affectedSide,
  refs = DEFAULT_GRIP_REFS,
  liveLevel = true,
}: UseActivationOptions): ActivationValue {
  const { openRef, closedRef } = refs;
  const manager = useMemo(
    () =>
      affectedSide
        ? new InputManager([
            new CvGripSource({ affectedSide, engine: visionEngine, refs: { openRef, closedRef } }),
            new KeyboardSource(),
            new EmgSource(),
          ])
        : null,
    [affectedSide, openRef, closedRef],
  );
  const [sourceId, setSourceId] = useState<ActivationSourceId>(DEFAULT_SOURCE_ID);
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!manager) return;
    const unsubscribe = manager.subscribe((snapshot) => {
      setSourceId(snapshot.sourceId);
      setReady(snapshot.ready);
      if (liveLevel) setLevel(snapshot.level);
    });
    manager.start();
    return () => {
      unsubscribe();
      manager.stop();
    };
  }, [manager, liveLevel]);

  useEffect(() => {
    // Vite replaces DEV with false in a production build, which removes this shortcut.
    if (!import.meta.env.DEV || !manager) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || event.repeat || isTyping(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      manager.toggleKeyboard();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [manager]);

  const getLevel = useCallback(() => manager?.getLevel() ?? 0, [manager]);

  return {
    sourceId,
    level: manager ? level : 0,
    ready: manager ? ready : false,
    getLevel,
    manager,
  };
}
