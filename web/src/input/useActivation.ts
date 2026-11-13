import { useCallback, useEffect, useMemo, useState } from "react";

import { useOptionalEmgEngine } from "@/emg/EmgProvider";
import type { Side } from "@/types/api";
import { visionEngine } from "@/vision/visionEngine";

import { CvGripSource, DEFAULT_GRIP_REFS, type GripRefs } from "./cvGripSource";
import { EmgSource } from "./emgSource";
import { DEFAULT_SOURCE_ID, InputManager } from "./inputManager";
import { KeyboardSource } from "./keyboardSource";
import { type ActivationSourceId, isTyping } from "./types";

export interface UseActivationOptions {
  affectedSide: Side | null;
  refs?: GripRefs;
  /**
   * Re-render with every new level. Leave it on for a meter; a game's own animation loop should
   * turn it off and call getLevel() each frame instead.
   */
  liveLevel?: boolean;
  /** Prefer the muscle sensor when today's EMG calibration is at the flexors (grip games). */
  preferEmg?: boolean;
}

export interface ActivationValue {
  /** The source in use now (the camera while a preferred muscle sensor is paused). */
  sourceId: ActivationSourceId;
  /** The muscle sensor is preferred but paused: the camera is used until it recovers. */
  emgPaused: boolean;
  level: number;
  ready: boolean;
  /** The current level, read without waiting for React. Stable between renders. */
  getLevel: () => number;
  /** Null until the affected side is known. */
  manager: InputManager | null;
}

/**
 * The activation level from the camera (closing the affected hand) by default. In development
 * builds, pressing K turns keyboard input (hold Space) on and off.
 */
export function useActivation({
  affectedSide,
  refs = DEFAULT_GRIP_REFS,
  liveLevel = true,
  preferEmg = false,
}: UseActivationOptions): ActivationValue {
  const { openRef, closedRef } = refs;
  const emgEngine = useOptionalEmgEngine();
  const built = useMemo(() => {
    if (!affectedSide) return null;
    const emg = new EmgSource({ channel: "flexor", engine: emgEngine });
    const manager = new InputManager<ActivationSourceId>(
      [
        new CvGripSource({ affectedSide, engine: visionEngine, refs: { openRef, closedRef } }),
        new KeyboardSource(),
        emg,
      ],
      DEFAULT_SOURCE_ID,
      // A paused muscle sensor falls back to the camera.
      { emg: "cv_grip" },
    );
    return { manager, emg };
  }, [affectedSide, openRef, closedRef, emgEngine]);
  const manager = built?.manager ?? null;
  const [sourceId, setSourceId] = useState<ActivationSourceId>(DEFAULT_SOURCE_ID);
  const [emgPaused, setEmgPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!manager) return;
    const unsubscribe = manager.subscribe((snapshot) => {
      setSourceId(snapshot.sourceId);
      setEmgPaused(snapshot.selectedId === "emg" && snapshot.fallback === true);
      setReady(snapshot.ready);
      if (liveLevel) setLevel(snapshot.level);
    });
    manager.start();
    return () => {
      unsubscribe();
      manager.stop();
    };
  }, [manager, liveLevel]);

  // Priority: the muscle sensor (calibrated at the flexors today), then the camera. The keyboard
  // (development) is only ever chosen with K.
  useEffect(() => {
    if (!built || !preferEmg || !emgEngine) return undefined;
    const choose = () => {
      if (built.manager.keyboardActive) return;
      if (built.emg.isAvailable()) built.manager.select("emg");
      else if (built.manager.sourceId === "emg") built.manager.select(DEFAULT_SOURCE_ID);
    };
    choose();
    return emgEngine.subscribe(choose);
  }, [built, preferEmg, emgEngine]);

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
    emgPaused: manager ? emgPaused : false,
    level: manager ? level : 0,
    ready: manager ? ready : false,
    getLevel,
    manager,
  };
}
