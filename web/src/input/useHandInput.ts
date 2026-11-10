import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/features/session/SessionContext";
import type { TranslationKey } from "@/i18n";
import type { Side } from "@/types/api";
import { visionEngine } from "@/vision/visionEngine";

import {
  type ApertureRefs,
  apertureRefsFromWarmup,
  DEFAULT_APERTURE_REFS,
} from "./cvApertureSource";
import { EmgSource } from "./emgSource";
import {
  DEFAULT_TOUCH_THRESHOLD,
  type Finger,
  type FingerTouchListener,
  type FingerTouchSourceId,
  touchThresholdFromWarmup,
} from "./fingerTouch";
import { CvFingerTouchSource, KeyboardFingerTouchSource } from "./fingerTouchSource";
import { InputManager } from "./inputManager";
import { KeyboardSource } from "./keyboardSource";
import { CvOpennessSource, OPENNESS_KEY_CODE } from "./opennessSource";
import { TouchManager } from "./touchManager";
import { type ActivationSourceId, type OpennessSourceId, SOURCE_BADGE_KEYS } from "./types";
import { useActivation } from "./useActivation";

/** The openness source that goes with each activation source. */
const OPENNESS_FOR: Record<ActivationSourceId, OpennessSourceId> = {
  cv_grip: "cv_openness",
  keyboard: "keyboard",
  emg: "emg",
};

/** No muscle sensor can tell fingers apart, so EMG mode keeps the camera for touches. */
const TOUCH_FOR: Record<ActivationSourceId, FingerTouchSourceId> = {
  cv_grip: "cv_touch",
  keyboard: "keyboard",
  emg: "cv_touch",
};

export interface UseHandInputOptions {
  affectedSide: Side | null;
  /** Open and closed hand apertures, shared by grip and openness. */
  refs?: ApertureRefs;
  /** Thumb-to-fingertip distance, in palm lengths, that counts as a touch. */
  touchThreshold?: number;
  /**
   * Re-render with every new level. Leave it on for meters; a game's own animation loop should
   * turn it off and call getOpenness() and getGrip() each frame instead.
   */
  liveLevel?: boolean;
}

export interface HandInputManagers {
  grip: InputManager<ActivationSourceId>;
  openness: InputManager<OpennessSourceId>;
  touch: TouchManager;
}

export interface HandInputValue {
  /** The input mode, shared by grip, openness and touch. Saved as a game run's input_source. */
  sourceId: ActivationSourceId;
  /** The words for the source badge, such as "Webcam" or "Keyboard". */
  badgeKey: TranslationKey;
  /** 0 a fist, 1 fully open. */
  openness: number;
  opennessReady: boolean;
  /** 0 relaxed, 1 full squeeze: the existing activation. */
  grip: number;
  gripReady: boolean;
  /** The finger the thumb is touching now, or null. */
  touch: Finger | null;
  /** The current values, read without waiting for React. Stable between renders. */
  getOpenness: () => number;
  getGrip: () => number;
  getTouch: () => Finger | null;
  isOpennessReady: () => boolean;
  isTouchReady: () => boolean;
  /** Each touchStart and touchEnd as it happens. Returns a function that unsubscribes. */
  subscribeTouch: (listener: FingerTouchListener) => () => void;
  /** Changes the camera's touch distance, in palm lengths, for example per game trial. */
  setTouchThreshold: (threshold: number) => void;
  /** Null until the affected side is known. */
  managers: HandInputManagers | null;
}

/**
 * Everything a hand game reads: how open the hand is, how hard it squeezes, and which finger the
 * thumb touches. From the camera by default; in development builds K switches all three to the
 * keyboard (O opens, Space squeezes, 1–4 touch the index to little finger).
 */
export function useHandInput({
  affectedSide,
  refs = DEFAULT_APERTURE_REFS,
  touchThreshold = DEFAULT_TOUCH_THRESHOLD,
  liveLevel = true,
}: UseHandInputOptions): HandInputValue {
  const { openRef, closedRef } = refs;
  const grip = useActivation({ affectedSide, refs: { openRef, closedRef }, liveLevel });
  const gripManager = grip.manager;

  const opennessManager = useMemo(
    () =>
      affectedSide
        ? new InputManager<OpennessSourceId>(
            [
              new CvOpennessSource({
                affectedSide,
                engine: visionEngine,
                refs: { openRef, closedRef },
              }),
              new KeyboardSource({ code: OPENNESS_KEY_CODE }),
              new EmgSource({ channel: "extensor" }),
            ],
            "cv_openness",
          )
        : null,
    [affectedSide, openRef, closedRef],
  );
  const touchManager = useMemo(
    () =>
      affectedSide
        ? new TouchManager([
            new CvFingerTouchSource({
              affectedSide,
              engine: visionEngine,
              threshold: touchThreshold,
            }),
            new KeyboardFingerTouchSource(),
          ])
        : null,
    [affectedSide, touchThreshold],
  );

  const [openness, setOpenness] = useState(0);
  const [opennessReady, setOpennessReady] = useState(false);
  const [touch, setTouch] = useState<Finger | null>(null);

  useEffect(() => {
    if (!opennessManager) return;
    const unsubscribe = opennessManager.subscribe((snapshot) => {
      setOpennessReady(snapshot.ready);
      if (liveLevel) setOpenness(snapshot.level);
    });
    opennessManager.start();
    return () => {
      unsubscribe();
      opennessManager.stop();
    };
  }, [opennessManager, liveLevel]);

  useEffect(() => {
    if (!touchManager) return;
    const unsubscribe = touchManager.subscribe(() => setTouch(touchManager.getTouch()));
    touchManager.start();
    return () => {
      unsubscribe();
      touchManager.stop();
      setTouch(null);
    };
  }, [touchManager]);

  // Grip owns the K shortcut; openness and touch follow its mode.
  useEffect(() => {
    if (!gripManager) return;
    const follow = (id: ActivationSourceId) => {
      opennessManager?.select(OPENNESS_FOR[id]);
      touchManager?.select(TOUCH_FOR[id]);
    };
    follow(gripManager.sourceId);
    return gripManager.subscribe((snapshot) => follow(snapshot.sourceId));
  }, [gripManager, opennessManager, touchManager]);

  const getOpenness = useCallback(() => opennessManager?.getLevel() ?? 0, [opennessManager]);
  const isOpennessReady = useCallback(() => opennessManager?.isReady() ?? false, [opennessManager]);
  const getTouch = useCallback(() => touchManager?.getTouch() ?? null, [touchManager]);
  const isTouchReady = useCallback(() => touchManager?.isReady() ?? false, [touchManager]);
  const subscribeTouch = useCallback(
    (listener: FingerTouchListener) => touchManager?.subscribe(listener) ?? (() => {}),
    [touchManager],
  );
  const setTouchThreshold = useCallback(
    (threshold: number) => touchManager?.setThreshold(threshold),
    [touchManager],
  );
  const managers = useMemo(
    () =>
      gripManager && opennessManager && touchManager
        ? { grip: gripManager, openness: opennessManager, touch: touchManager }
        : null,
    [gripManager, opennessManager, touchManager],
  );

  return {
    sourceId: grip.sourceId,
    badgeKey: SOURCE_BADGE_KEYS[grip.sourceId],
    openness: opennessManager ? openness : 0,
    opennessReady: opennessManager ? opennessReady : false,
    grip: grip.level,
    gripReady: grip.ready,
    touch: touchManager ? touch : null,
    getOpenness,
    getGrip: grip.getLevel,
    getTouch,
    isOpennessReady,
    isTouchReady,
    subscribeTouch,
    setTouchThreshold,
    managers,
  };
}

/**
 * useHandInput for the session pages: the affected side, the hand references and the touch
 * distance come from the session, using this session's hand warm-ups when there are some.
 */
export function useSessionHandInput(liveLevel = true): HandInputValue {
  const { affectedSide, warmupResults } = useSession();
  const refs = useMemo(() => apertureRefsFromWarmup(warmupResults), [warmupResults]);
  const { threshold } = useMemo(() => touchThresholdFromWarmup(warmupResults), [warmupResults]);
  return useHandInput({ affectedSide, refs, touchThreshold: threshold, liveLevel });
}
