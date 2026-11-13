import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/features/session/SessionContext";
import type { TranslationKey } from "@/i18n";
import type { Side } from "@/types/api";
import { useOptionalEmgEngine } from "@/emg/EmgProvider";
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
import {
  DEFAULT_PINCH_THRESHOLD,
  IDLE_PINCH,
  type PinchListener,
  type PinchSourceId,
  type PinchState,
  pinchThresholdFromWarmup,
} from "./pinch";
import { CvPinchSource, KeyboardPinchSource, PinchManager } from "./pinchSource";
import { KeyboardSource } from "./keyboardSource";
import { CvOpennessSource, OPENNESS_KEY_CODE } from "./opennessSource";
import { TouchManager } from "./touchManager";
import { type ActivationSourceId, type OpennessSourceId, SOURCE_BADGE_KEYS } from "./types";
import { useActivation } from "./useActivation";

/** Which hand signal a game lets the muscle sensor drive (one electrode site per session). */
export type EmgSignal = "grip" | "openness";

/** No muscle sensor can tell fingers apart, so EMG mode keeps the camera for touches. */
const TOUCH_FOR: Record<ActivationSourceId, FingerTouchSourceId> = {
  cv_grip: "cv_touch",
  keyboard: "keyboard",
  emg: "cv_touch",
};

/** A muscle sensor cannot tell a pinch from a squeeze, so EMG mode keeps the camera for pinch. */
const PINCH_FOR: Record<ActivationSourceId, PinchSourceId> = {
  cv_grip: "cv_pinch",
  keyboard: "keyboard",
  emg: "cv_pinch",
};

export interface UseHandInputOptions {
  affectedSide: Side | null;
  /** Open and closed hand apertures, shared by grip and openness. */
  refs?: ApertureRefs;
  /** Thumb-to-fingertip distance, in palm lengths, that counts as a touch. */
  touchThreshold?: number;
  /** Thumb-to-index distance, in palm lengths, that counts as a pinch. */
  pinchThreshold?: number;
  /**
   * Re-render with every new level. Leave it on for meters; a game's own animation loop should
   * turn it off and call getOpenness() and getGrip() each frame instead.
   */
  liveLevel?: boolean;
  /** The signal this game lets the muscle sensor drive, when calibrated at its site. */
  emg?: EmgSignal | null;
}

export interface HandInputManagers {
  grip: InputManager<ActivationSourceId>;
  openness: InputManager<OpennessSourceId>;
  touch: TouchManager;
  pinch: PinchManager;
}

export interface HandInputValue {
  /** The input mode, shared by grip, openness and touch. Saved as a game run's input_source. */
  sourceId: ActivationSourceId;
  /** The source of each level in use now (the camera while a preferred sensor is paused). */
  gripSourceId: ActivationSourceId;
  opennessSourceId: OpennessSourceId;
  /** The muscle sensor is preferred but paused (unplugged, an electrode off, lost samples). */
  emgPaused: boolean;
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
  /**
   * The thumb-and-index pinch: whether pinching, its strength and its point in SW. Re-renders on
   * every pinchStart and pinchEnd; with liveLevel also on every frame.
   */
  pinch: PinchState;
  /** The current values, read without waiting for React. Stable between renders. */
  getOpenness: () => number;
  getGrip: () => number;
  getTouch: () => Finger | null;
  isOpennessReady: () => boolean;
  isTouchReady: () => boolean;
  getPinch: () => PinchState;
  /** Each touchStart and touchEnd as it happens. Returns a function that unsubscribes. */
  subscribeTouch: (listener: FingerTouchListener) => () => void;
  /** Changes the camera's touch distance, in palm lengths, for example per game trial. */
  setTouchThreshold: (threshold: number) => void;
  /** Each pinchStart and pinchEnd as it happens. Returns a function that unsubscribes. */
  subscribePinch: (listener: PinchListener) => () => void;
  /** Changes the camera's pinch distance, in palm lengths. */
  setPinchThreshold: (threshold: number) => void;
  /** Null until the affected side is known. */
  managers: HandInputManagers | null;
}

/**
 * Everything a hand game reads: how open the hand is, how hard it squeezes, which finger the thumb
 * touches and whether thumb and index pinch. From the camera by default; in development builds K
 * switches all four to the keyboard (O opens, Space squeezes, 1–4 touch the index to little
 * finger, P pinches at the fingertip cursor).
 */
export function useHandInput({
  affectedSide,
  refs = DEFAULT_APERTURE_REFS,
  touchThreshold = DEFAULT_TOUCH_THRESHOLD,
  pinchThreshold = DEFAULT_PINCH_THRESHOLD,
  liveLevel = true,
  emg = null,
}: UseHandInputOptions): HandInputValue {
  const { openRef, closedRef } = refs;
  const grip = useActivation({
    affectedSide,
    refs: { openRef, closedRef },
    liveLevel,
    preferEmg: emg === "grip",
  });
  const gripManager = grip.manager;
  const emgEngine = useOptionalEmgEngine();

  const opennessBuilt = useMemo(() => {
    if (!affectedSide) return null;
    const sensor = new EmgSource({ channel: "extensor", engine: emgEngine });
    const manager = new InputManager<OpennessSourceId>(
      [
        new CvOpennessSource({
          affectedSide,
          engine: visionEngine,
          refs: { openRef, closedRef },
        }),
        new KeyboardSource({ code: OPENNESS_KEY_CODE }),
        sensor,
      ],
      "cv_openness",
      // A paused muscle sensor falls back to the camera.
      { emg: "cv_openness" },
    );
    return { manager, sensor };
  }, [affectedSide, openRef, closedRef, emgEngine]);
  const opennessManager = opennessBuilt?.manager ?? null;
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

  const pinchManager = useMemo(
    () =>
      affectedSide
        ? new PinchManager([
            new CvPinchSource({ affectedSide, engine: visionEngine, threshold: pinchThreshold }),
            new KeyboardPinchSource({ affectedSide, engine: visionEngine }),
          ])
        : null,
    [affectedSide, pinchThreshold],
  );

  const [openness, setOpenness] = useState(0);
  const [opennessReady, setOpennessReady] = useState(false);
  const [opennessSourceId, setOpennessSourceId] = useState<OpennessSourceId>("cv_openness");
  const [opennessPaused, setOpennessPaused] = useState(false);
  const [touch, setTouch] = useState<Finger | null>(null);
  const [pinch, setPinch] = useState<PinchState>(IDLE_PINCH);

  useEffect(() => {
    if (!opennessManager) return;
    const unsubscribe = opennessManager.subscribe((snapshot) => {
      setOpennessReady(snapshot.ready);
      setOpennessSourceId(snapshot.sourceId);
      setOpennessPaused(snapshot.selectedId === "emg" && snapshot.fallback === true);
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

  useEffect(() => {
    if (!pinchManager) return;
    const show = () => setPinch(pinchManager.getState());
    const offEvents = pinchManager.subscribe(show);
    const offStates = liveLevel ? pinchManager.subscribeState(show) : () => {};
    pinchManager.start();
    return () => {
      offEvents();
      offStates();
      pinchManager.stop();
      setPinch(IDLE_PINCH);
    };
  }, [pinchManager, liveLevel]);

  // Grip owns the K shortcut; openness, touch and pinch follow its mode. Openness prefers the
  // muscle sensor when this game lets it and today's calibration is at the extensors.
  useEffect(() => {
    if (!gripManager) return undefined;
    const follow = () => {
      const id = gripManager.sourceId;
      const keyboard = id === "keyboard";
      const sensor = emg === "openness" && opennessBuilt?.sensor.isAvailable() === true;
      opennessManager?.select(keyboard ? "keyboard" : sensor ? "emg" : "cv_openness");
      touchManager?.select(TOUCH_FOR[id]);
      pinchManager?.select(PINCH_FOR[id]);
    };
    follow();
    const offGrip = gripManager.subscribe(follow);
    const offEngine = emgEngine?.subscribe(follow) ?? (() => {});
    return () => {
      offGrip();
      offEngine();
    };
  }, [gripManager, opennessManager, opennessBuilt, touchManager, pinchManager, emg, emgEngine]);

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
  const getPinch = useCallback(() => pinchManager?.getState() ?? IDLE_PINCH, [pinchManager]);
  const subscribePinch = useCallback(
    (listener: PinchListener) => pinchManager?.subscribe(listener) ?? (() => {}),
    [pinchManager],
  );
  const setPinchThreshold = useCallback(
    (threshold: number) => pinchManager?.setThreshold(threshold),
    [pinchManager],
  );
  const managers = useMemo(
    () =>
      gripManager && opennessManager && touchManager && pinchManager
        ? {
            grip: gripManager,
            openness: opennessManager,
            touch: touchManager,
            pinch: pinchManager,
          }
        : null,
    [gripManager, opennessManager, touchManager, pinchManager],
  );

  return {
    sourceId: grip.sourceId,
    gripSourceId: grip.sourceId,
    opennessSourceId: opennessManager ? opennessSourceId : "cv_openness",
    emgPaused: grip.emgPaused || (opennessManager ? opennessPaused : false),
    badgeKey: SOURCE_BADGE_KEYS[grip.sourceId],
    openness: opennessManager ? openness : 0,
    opennessReady: opennessManager ? opennessReady : false,
    grip: grip.level,
    gripReady: grip.ready,
    touch: touchManager ? touch : null,
    pinch: pinchManager ? pinch : IDLE_PINCH,
    getOpenness,
    getGrip: grip.getLevel,
    getTouch,
    isOpennessReady,
    isTouchReady,
    getPinch,
    subscribeTouch,
    setTouchThreshold,
    subscribePinch,
    setPinchThreshold,
    managers,
  };
}

/**
 * useHandInput for the session pages: the affected side, the hand references and the touch and
 * pinch distances come from the session, using this session's hand warm-ups when there are some.
 */
export function useSessionHandInput(
  liveLevel = true,
  emg: EmgSignal | null = null,
): HandInputValue {
  const { affectedSide, warmupResults } = useSession();
  const refs = useMemo(() => apertureRefsFromWarmup(warmupResults), [warmupResults]);
  const { threshold } = useMemo(() => touchThresholdFromWarmup(warmupResults), [warmupResults]);
  const pinch = useMemo(() => pinchThresholdFromWarmup(warmupResults), [warmupResults]);
  return useHandInput({
    affectedSide,
    refs,
    touchThreshold: threshold,
    pinchThreshold: pinch.threshold,
    liveLevel,
    emg,
  });
}
