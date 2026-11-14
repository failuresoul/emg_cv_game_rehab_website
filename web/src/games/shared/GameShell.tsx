import { Pause, Play } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { cueAction, LevelMessages } from "@/ai/engineCues";
import { FixedProvider } from "@/ai/paramsProvider";
import { RemoteProvider } from "@/ai/remoteProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/features/auth/AuthContext";
import { useSession } from "@/features/session/SessionContext";
import { SessionExitButton } from "@/features/session/SessionExitButton";
import { sessionStops } from "@/features/session/sessionStop";
import { useOptionalEmgEngine } from "@/emg/EmgProvider";
import { buildTrialEmg, EMG_TRACE_STEP_MS, EmgTraceRecorder } from "@/emg/trialEmg";
import { t, type TranslationKey } from "@/i18n";
import {
  ActivationMeter,
  type InputManager,
  signalSourceId,
  SOURCE_BADGE_KEYS,
  useSessionHandInput,
} from "@/input";
import { api } from "@/lib/api";
import { formatClock, formatNumber } from "@/lib/format";
import type { Calibration, Side, TrialCreate } from "@/types/api";
import type { Point } from "@/vision/geometry";
import { ArmLengthTracker, computeJointAngles } from "@/vision/angles";
import { computePosture } from "@/vision/posture";
import type { TrackingState } from "@/vision/tracking";
import { useTracking } from "@/vision/useTracking";
import { visionEngine, type VisionResult } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";
import { CompensationMonitor } from "@/warmup/compensation";
import { COMPENSATION_CONFIG } from "@/warmup/compensationConfig";

import { allMeasures } from "@/features/games/results";

import { gameAudio } from "./audio";
import { COUNTDOWN_FROM, GameRuntime, type PauseReason, type RuntimeStage } from "./gameRuntime";
import { createPlayArea, type PlayArea } from "./playArea";
import { GAMES } from "./registry";
import { RestOverlay } from "./RestOverlay";
import { createRng, newSeed } from "./rng";
import { drawSkeletonLayer, type SkeletonLayerInput } from "./skeletonLayer";
import { type SaveStatus, TrialLogger } from "./trialLogger";
import type {
  GameContext,
  GameDefinition,
  GameFactory,
  GameFeedback,
  GameHudItem,
  GameInstance,
  GameResult,
  GameTracking,
  ParamSpec,
} from "./types";
import { useGameFactory } from "./useGameFactory";

const BACKGROUND = "#0B1416";
const CURSOR_COLOR = "#D9682B";
const CURSOR_RING = "#FFFFFF";
const CURSOR_SW = 0.07;
const CURSOR_MIN_PX = 14;
const HUD_INTERVAL_MS = 250;
/** The top bar's usual height. The play area is fitted below it. */
const HUD_HEIGHT_PX = 72;
const FEEDBACK_SHOW_MS = 2500;
/** Reaching games check every kind of compensation, as the reaching warm-up exercises do. */
const COMPENSATION_EXERCISE = "forward_reach";
/** The posture baseline comes from the game's first second, while the countdown keeps it still. */
const GAME_COMPENSATION_CONFIG = { ...COMPENSATION_CONFIG, baselineMs: 1000 };

const SAVE_KEYS: Record<SaveStatus, TranslationKey | null> = {
  idle: null,
  saving: "game.save.saving",
  saved: "game.save.saved",
  unsaved: "game.save.unsaved",
};

const PAUSE_KEYS: Record<PauseReason, TranslationKey> = {
  manual: "game.paused.manual",
  hand: "game.paused.hand",
  hidden: "game.paused.hidden",
  rest: "game.rest.title",
};

/** The settings the server's engine may change: those with a range and a harder direction. */
function adaptableNames(params: readonly ParamSpec[]): string[] {
  return params
    .filter((spec) => spec.component !== "fixed" && spec.min < spec.max && spec.harder !== null)
    .map((spec) => spec.name);
}

interface Hud {
  trial: number;
  trialsPlanned: number;
  score: number;
  elapsedMs: number;
  items: GameHudItem[];
}

/** The level meter re-renders on its own, so the rest of the screen does not at 60 Hz. */
function LiveMeter({ manager }: { manager: InputManager | null }) {
  const [snapshot, setSnapshot] = useState(() => manager?.snapshot() ?? null);
  useEffect(() => manager?.subscribe(setSnapshot), [manager]);
  return <ActivationMeter level={snapshot?.level ?? 0} ready={snapshot?.ready ?? false} />;
}

interface ResultsProps {
  definition: GameDefinition;
  result: GameResult;
  saveStatus: SaveStatus;
  onRetrySave: () => void;
  onContinue: () => void;
  /** "Next game" while more games are queued, "Continue" otherwise. */
  continueKey: TranslationKey;
  /** The level the game started and ended at, when the difficulty adapts. */
  levels: { start: number; end: number } | null;
}

function Results({
  definition,
  result,
  saveStatus,
  onRetrySave,
  onContinue,
  continueKey,
  levels,
}: ResultsProps) {
  const measures = allMeasures(definition.id, result.summary);
  const saveKey = SAVE_KEYS[saveStatus];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
      <Card className="flex w-full max-w-lg flex-col gap-5" role="dialog" aria-modal="true">
        <h2 className="text-2xl font-bold">{t("game.results.title")}</h2>
        <p className="text-muted">{t(definition.nameKey)}</p>
        {levels && (
          <p className="text-lg font-semibold">
            {t("game.results.level", { end: levels.end, start: levels.start })}
          </p>
        )}
        <dl
          className={
            measures.length > 1
              ? "grid grid-cols-1 gap-4 sm:grid-cols-2"
              : "grid grid-cols-1 gap-4 sm:grid-cols-3"
          }
        >
          <div>
            <dt className="text-muted">{t("game.results.score")}</dt>
            <dd className="text-3xl font-bold tabular-nums">{result.score}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("game.results.successes")}</dt>
            <dd className="text-3xl font-bold tabular-nums">
              {t("game.results.successesValue", {
                done: result.summary.successes,
                total: result.trialsDone,
              })}
            </dd>
          </div>
          {measures.map((measure) => (
            <div key={measure.labelKey}>
              <dt className="text-muted">{t(measure.labelKey)}</dt>
              <dd className="text-3xl font-bold tabular-nums">
                {measure.value
                  ? t(measure.value.key, measure.value.params)
                  : t("game.results.noValue")}
              </dd>
            </div>
          ))}
        </dl>
        {saveKey && (
          <p role="status" className={saveStatus === "unsaved" ? "text-danger font-medium" : ""}>
            {t(saveKey)}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {saveStatus === "unsaved" && (
            <Button variant="secondary" onClick={onRetrySave}>
              {t("game.save.retry")}
            </Button>
          )}
          <Button size="lg" disabled={saveStatus === "saving"} onClick={onContinue}>
            {t(continueKey)}
          </Button>
        </div>
      </Card>
    </div>
  );
}

interface GamePlayProps {
  definition: GameDefinition;
  /** The game's code, loaded before play starts. */
  create: GameFactory;
  sessionId: number;
  affectedSide: Side;
  calibration: Calibration | null;
  subscribeTracking: (listener: (state: TrackingState) => void) => () => void;
  onContinue: () => void;
  continueKey: TranslationKey;
}

const GamePlay = memo(function GamePlay({
  definition,
  create,
  sessionId,
  affectedSide,
  calibration: calibrationAtStart,
  subscribeTracking,
  onContinue,
  continueKey,
}: GamePlayProps) {
  // A refreshed copy of the same calibration must not restart the game.
  const [calibration] = useState(calibrationAtStart);
  const hand = useSessionHandInput(false, definition.emgSignal ?? null);
  // The source of this game's own signal (grip or openness), for the badge and input_source.
  const signalSource = signalSourceId(
    definition.emgSignal ?? null,
    hand.gripSourceId,
    hand.opennessSourceId,
  );
  const emgEngine = useOptionalEmgEngine();
  const emgEngineRef = useRef(emgEngine);
  const [emgRecorder] = useState(() => new EmgTraceRecorder());
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackingRef = useRef<TrackingState | null>(null);
  const visionRef = useRef<VisionResult | null>(null);
  const playAreaRef = useRef<PlayArea | null>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const loggerRef = useRef<TrialLogger | null>(null);
  const handRef = useRef(hand);
  const [monitor] = useState(
    () =>
      new CompensationMonitor(
        definition.compensationExercise ?? COMPENSATION_EXERCISE,
        GAME_COMPENSATION_CONFIG,
      ),
  );
  const [seed] = useState(newSeed);

  const [stage, setStage] = useState<RuntimeStage>("countdown");
  const [count, setCount] = useState<number | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const [hud, setHud] = useState<Hud>({
    trial: 1,
    trialsPlanned: definition.trialsDefault,
    score: 0,
    elapsedMs: 0,
    items: [],
  });
  const [feedback, setFeedback] = useState<(GameFeedback & { id: number }) | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    handRef.current = hand;
    emgEngineRef.current = emgEngine;
  }, [hand, emgEngine]);

  // While the muscle sensor drives the game, its %MVC is kept at 50 Hz in game time, so each
  // trial can save its trace and measures. Only numbers are kept, never the raw signal.
  const emgDriving = signalSource === "emg";
  useEffect(() => {
    if (!emgDriving || !emgEngine) return undefined;
    const timer = setInterval(() => {
      const runtime = runtimeRef.current;
      const percent = emgEngine.percentMvc;
      if (!runtime || percent === null) return;
      emgRecorder.add(runtime.toGameTime(performance.now()), percent);
    }, EMG_TRACE_STEP_MS);
    return () => clearInterval(timer);
  }, [emgDriving, emgEngine, emgRecorder]);

  useEffect(() => subscribeTracking((state) => (trackingRef.current = state)), [subscribeTracking]);

  // A session resumed straight into a game has had no click to start sound yet: the first press
  // of a button or key on this screen starts or resumes it. Repeats cost nothing.
  useEffect(() => {
    const prepare = () => gameAudio.prepare();
    window.addEventListener("pointerdown", prepare);
    window.addEventListener("keydown", prepare);
    return () => {
      window.removeEventListener("pointerdown", prepare);
      window.removeEventListener("keydown", prepare);
    };
  }, []);

  const elevationRef = useRef<number | null>(null);
  const elbowRef = useRef<number | null>(null);
  useEffect(() => {
    const armLengths = new ArmLengthTracker();
    return visionEngine.subscribe((frame) => {
      visionRef.current = frame;
      monitor.addSample(computePosture(frame, affectedSide), frame.timestamp);
      // Unfiltered, for saved data.
      const angles = computeJointAngles(frame, affectedSide, armLengths);
      elevationRef.current = angles.armElevationDeg?.value ?? null;
      elbowRef.current = angles.elbowFlexionDeg?.value ?? null;
    });
  }, [monitor, affectedSide]);

  // Each new message restarts the timer, so the latest one always gets its full time.
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), FEEDBACK_SHOW_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  // This session's warm-up, as it was when the game began.
  const { warmupResults } = useSession();
  const [warmupAtStart] = useState(warmupResults);
  // The patient's engine as the game began: L0 fixed settings, L1 or L2 from the server.
  const { user } = useAuth();
  const { session: sessionRecord } = useSession();
  // In a study session (research mode) the server sets the difficulty for every condition, so
  // the game looks and behaves the same whichever condition it is.
  const [engineMode] = useState(() =>
    sessionRecord?.blinded ? "L1" : (user?.patient_profile?.engine_mode ?? "L0"),
  );
  const provider = useMemo(() => {
    const options = {
      // This game's settings, with the defaults the admin chose for it.
      specsFor: (id: typeof definition.id) =>
        id === definition.id ? definition.params : GAMES[id].params,
      seed,
      defaultsFor: (id: typeof definition.id) => GAMES[id].personalDefaults?.(warmupAtStart) ?? {},
    };
    if (engineMode === "L0") return new FixedProvider(options);
    return new RemoteProvider({
      ...options,
      engine: engineMode,
      adaptableFor: (id) => adaptableNames(options.specsFor(id)),
    });
  }, [seed, warmupAtStart, definition, engineMode]);
  const [level, setLevel] = useState<number | null>(null);
  const [startLevel, setStartLevel] = useState<number | null>(null);
  const [banner, setBanner] = useState<TranslationKey | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const context2d = canvas?.getContext("2d");
    if (!canvas || !container || !context2d) return;

    const hull = calibration?.hull_sw.map(([x, y]) => ({ x, y })) ?? null;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      playAreaRef.current = createPlayArea({
        width,
        height,
        affectedSide,
        hull,
        insets: { top: HUD_HEIGHT_PX },
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("resize", resize);

    let feedbackId = 0;
    const area = () => playAreaRef.current as PlayArea;
    // The trial's part of the %MVC trace, when the muscle sensor drove it. Trials are logged as
    // they end, so the spawn was `timings.end` ms ago in game time.
    const withTrialEmg = (trial: TrialCreate): TrialCreate => {
      const engine = emgEngineRef.current;
      const runtime = runtimeRef.current;
      const emgCalibration = engine?.calibrationValues ?? null;
      const site = engine?.site ?? null;
      if (!definition.emgSignal || !runtime || !emgCalibration || !site) return trial;
      if (emgRecorder.size === 0) return trial;
      const now = runtime.toGameTime(performance.now());
      const spawn = now - (trial.timings.end ?? 0);
      const trace = emgRecorder.slice(spawn, now);
      if (trace.length === 0) return trial;
      return {
        ...trial,
        emg: buildTrialEmg({
          site,
          trace,
          gameId: definition.id,
          timings: trial.timings,
          target: trial.target,
          calibration: emgCalibration,
        }),
      };
    };
    const firstParams = provider.nextParams(definition.id, []);
    const logger = new TrialLogger({
      http: api,
      sessionId,
      // Read when the game starts, so a source switched during the countdown is the one saved.
      run: () => ({
        game_id: definition.id,
        engine: provider.engine,
        input_source: signalSourceId(
          definition.emgSignal ?? null,
          handRef.current.gripSourceId,
          handRef.current.opennessSourceId,
        ),
        params_initial: { ...firstParams, seed },
        trials_planned: definition.trialsDefault,
      }),
    });
    loggerRef.current = logger;
    const unsubscribeLogger = logger.subscribe(setSaveStatus);
    const rng = createRng(seed);

    const gameContext: GameContext = {
      gameId: definition.id,
      get width() {
        return area().width;
      },
      get height() {
        return area().height;
      },
      trialsPlanned: definition.trialsDefault,
      toScreen: (point: Point) => area().toScreen(point),
      toBody: (point: Point) => area().toBody(point),
      get pixelsPerSw() {
        return area().pixelsPerSw;
      },
      getTracking(): GameTracking {
        const tracking = trackingRef.current;
        const timestamp = tracking?.timestamp ?? performance.now();
        return {
          rawSw: tracking?.fingertipRawSw ?? null,
          smoothSw: tracking?.fingertipSmoothSw ?? null,
          handLost: !(tracking?.handPresent ?? false),
          handLostMs: tracking?.handLostMs ?? 0,
          armElevationDeg: elevationRef.current,
          elbowFlexionDeg: elbowRef.current,
          timestamp: runtimeRef.current?.toGameTime(timestamp) ?? timestamp,
        };
      },
      activation: {
        get sourceId() {
          return handRef.current.gripSourceId;
        },
        getLevel: () => handRef.current.getGrip(),
        isReady: () => handRef.current.managers?.grip.isReady() ?? false,
      },
      hand: {
        getOpenness: () => handRef.current.getOpenness(),
        isOpennessReady: () => handRef.current.isOpennessReady(),
        getTouch: () => handRef.current.getTouch(),
        isTouchReady: () => handRef.current.isTouchReady(),
        // The affected side is fixed for a session, so the touch manager does not change mid-game.
        subscribeTouch: (listener) =>
          handRef.current.subscribeTouch((event) =>
            listener({ ...event, t: runtimeRef.current?.toGameTime(event.t) ?? event.t }),
          ),
        setTouchThreshold: (threshold) => handRef.current.setTouchThreshold(threshold),
        getPinch: () => {
          const pinch = handRef.current.getPinch();
          return { ...pinch, t: runtimeRef.current?.toGameTime(pinch.t) ?? pinch.t };
        },
        subscribePinch: (listener) =>
          handRef.current.subscribePinch((event) =>
            listener({ ...event, t: runtimeRef.current?.toGameTime(event.t) ?? event.t }),
          ),
      },
      calibration,
      affectedSide,
      rng,
      audio: gameAudio,
      params: {
        engine: provider.engine,
        next: (trialNo?: number) => provider.nextParams(definition.id, logger.history, trialNo),
      },
      logger: {
        log: (trial) => {
          logger.log(withTrialEmg(trial));
          // The engine learns from each trial as it ends.
          if (provider instanceof RemoteProvider) provider.report(definition.id, trial);
        },
      },
      compensation: monitor,
      emit: (item) => setFeedback({ ...item, id: ++feedbackId }),
    };

    const game: GameInstance = create(gameContext);
    let started = false;
    let finished = false;
    const runtime = new GameRuntime(game, {
      onCountdown: (value) => {
        setCount(value);
        gameAudio.countdown();
      },
      onStart: () => {
        // Not before: StrictMode mounts twice in development, and that must not create a run.
        started = true;
        setStage("playing");
        void logger.start().then(() => {
          const runId = logger.gameRunId;
          if (provider instanceof RemoteProvider && runId !== null) {
            void provider.start(runId, definition.id);
          }
        });
      },
      onPause: (reason) => {
        setStage("paused");
        setPauseReason(reason);
      },
      onResume: () => {
        setStage("playing");
        setPauseReason(null);
      },
      onFinish: (completed) => {
        finished = true;
        const summary = game.getSummary();
        setResult(summary);
        setStage("finished");
        if (completed) gameAudio.finish();
        void logger.end({
          status: completed ? "completed" : "aborted",
          score: summary.score,
          summary: summary.summary,
        });
      },
    });
    runtimeRef.current = runtime;

    // The engine's level and the safety layer's cues. Patients never see how they are chosen.
    const levelMessages = new LevelMessages();
    const unsubscribeEngine =
      provider instanceof RemoteProvider
        ? provider.subscribe((event) => {
            if (event.type === "level") {
              setLevel(event.level);
              setStartLevel((current) => current ?? event.level);
              const key = levelMessages.message(event.previous, event.level, performance.now());
              if (key) {
                setFeedback({
                  key,
                  tone: event.level > (event.previous ?? 0) ? "positive" : "gentle",
                  id: ++feedbackId,
                });
              }
              return;
            }
            const action = cueAction(event.cue);
            if (action.kind === "message") {
              setFeedback({ key: action.key, tone: action.tone, id: ++feedbackId });
            } else if (action.kind === "banner") {
              setBanner(action.key);
            } else if (action.kind === "rest") {
              runtime.pause("rest", performance.now());
            } else {
              runtime.complete();
            }
          })
        : () => {};

    // requestAnimationFrame stops in a hidden tab, so the loop alone would never see it.
    const onVisibility = () => {
      if (document.hidden) runtime.pause("hidden", performance.now());
    };
    document.addEventListener("visibilitychange", onVisibility);

    let frameId = 0;
    let stopped = false;
    let lastHud = -Infinity;
    // Filled in again every frame rather than created, to keep garbage collection out of the loop.
    const frameInput = { handPresent: false, hidden: false };
    const skeletonInput: SkeletonLayerInput = {
      pose: null,
      frame: null,
      frameWidth: 0,
      frameHeight: 0,
      affectedSide,
      toScreen: (point) => area().toScreen(point),
      pixelsPerSw: 0,
    };
    const loop = (wallMs: number) => {
      if (stopped) return;
      const tracking = trackingRef.current;
      frameInput.handPresent = tracking?.handPresent ?? false;
      frameInput.hidden = document.hidden;
      runtime.frame(wallMs, frameInput);

      const playArea = area();
      if (game.renderBackground) {
        game.renderBackground(context2d);
      } else {
        context2d.fillStyle = BACKGROUND;
        context2d.fillRect(0, 0, playArea.width, playArea.height);
      }
      const vision = visionRef.current;
      if (vision) {
        skeletonInput.pose = vision.pose;
        skeletonInput.frame = tracking?.frame ?? null;
        skeletonInput.frameWidth = vision.frameWidth;
        skeletonInput.frameHeight = vision.frameHeight;
        skeletonInput.pixelsPerSw = playArea.pixelsPerSw;
        drawSkeletonLayer(context2d, skeletonInput);
      }
      if (runtime.stage !== "countdown") game.render(context2d);
      const cursor = definition.showCursor === false ? null : tracking?.fingertipSmoothSw;
      if (cursor && runtime.stage !== "finished") {
        const at = playArea.toScreen(cursor);
        context2d.beginPath();
        context2d.arc(
          at.x,
          at.y,
          Math.max(CURSOR_MIN_PX, CURSOR_SW * playArea.pixelsPerSw),
          0,
          Math.PI * 2,
        );
        context2d.fillStyle = CURSOR_COLOR;
        context2d.fill();
        context2d.lineWidth = 3;
        context2d.strokeStyle = CURSOR_RING;
        context2d.stroke();
      }

      if (wallMs - lastHud >= HUD_INTERVAL_MS) {
        lastHud = wallMs;
        const summary = game.getSummary();
        const next = {
          trial: Math.min(summary.trialsDone + 1, summary.trialsPlanned),
          trialsPlanned: summary.trialsPlanned,
          score: summary.score,
          elapsedMs: runtime.elapsedMs(wallMs),
          items: game.getHudItems?.() ?? [],
        };
        setHud((current) =>
          current.trial === next.trial &&
          current.score === next.score &&
          JSON.stringify(current.items) === JSON.stringify(next.items) &&
          Math.floor(current.elapsedMs / 1000) === Math.floor(next.elapsedMs / 1000)
            ? current
            : next,
        );
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    // Any way out of the session stops the loop at once, even before this component unmounts.
    const stopLoop = () => {
      stopped = true;
      cancelAnimationFrame(frameId);
    };
    const unregisterStop = sessionStops.register(stopLoop);

    return () => {
      unregisterStop();
      stopLoop();
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      // Leaving mid-game: save what was played as an aborted run.
      if (started && !finished) {
        const summary = game.getSummary();
        void logger.end({ status: "aborted", score: summary.score, summary: summary.summary });
      }
      unsubscribeLogger();
      unsubscribeEngine();
      game.destroy();
      runtimeRef.current = null;
    };
  }, [
    definition,
    create,
    sessionId,
    affectedSide,
    calibration,
    provider,
    seed,
    monitor,
    emgRecorder,
  ]);

  const saveKey = SAVE_KEYS[saveStatus];

  return (
    <div ref={containerRef} className="bg-session-bg fixed inset-0 z-40 overflow-hidden text-white">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("game.canvasLabel", { name: t(definition.nameKey) })}
        className="block"
      />

      <header className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-x-6 gap-y-2 bg-black/40 px-4 py-3">
        <h1 className="text-xl font-bold">{t(definition.nameKey)}</h1>
        <p className="tabular-nums">
          {t("game.hud.trial", { n: hud.trial, total: hud.trialsPlanned })}
        </p>
        <p className="tabular-nums">{t("game.hud.score", { value: hud.score })}</p>
        {level !== null && <p className="tabular-nums">{t("game.hud.level", { n: level })}</p>}
        {hud.items.map((item) => (
          <p key={item.key} className="tabular-nums">
            {t(item.key, item.params)}
          </p>
        ))}
        <p className="tabular-nums">{t("game.hud.time", { value: formatClock(hud.elapsedMs) })}</p>
        <div className="ml-auto flex items-center gap-3">
          {saveKey && (
            <span role="status" className="text-base text-white/80">
              {t(saveKey)}
            </span>
          )}
          <Badge variant={signalSource === "keyboard" ? "warning" : "neutral"}>
            {t(SOURCE_BADGE_KEYS[signalSource])}
          </Badge>
          {stage === "playing" && (
            <Button
              variant="secondary"
              onClick={() => runtimeRef.current?.pause("manual", performance.now())}
            >
              <Pause size={20} aria-hidden />
              {t("game.pause")}
            </Button>
          )}
        </div>
      </header>

      {hand.emgPaused && stage === "playing" && (
        <p
          role="status"
          className="absolute inset-x-0 top-20 mx-auto w-fit max-w-[80%] rounded-xl bg-amber-500/90 px-5 py-2 text-center text-lg font-semibold text-black"
        >
          {t("game.emgPaused")}
        </p>
      )}

      {definition.showGripMeter !== false && (
        <div className="absolute right-4 bottom-4 flex flex-col items-center gap-2">
          <LiveMeter manager={hand.managers?.grip ?? null} />
          <span className="text-base">{t("game.hud.squeeze")}</span>
        </div>
      )}

      {feedback && stage === "playing" && (
        <p
          key={feedback.id}
          role="status"
          className="absolute inset-x-0 bottom-8 mx-auto w-fit max-w-[80%] rounded-xl bg-black/60 px-6 py-3 text-center text-2xl font-semibold"
        >
          {t(feedback.key, feedback.params)}
        </p>
      )}

      {stage === "countdown" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/40">
          <p className="text-2xl">{t("game.countdown.ready")}</p>
          <p className="text-[8rem] leading-none font-bold tabular-nums" aria-live="assertive">
            {formatNumber(count ?? COUNTDOWN_FROM, 0)}
          </p>
        </div>
      )}

      {banner && stage !== "finished" && (
        <p
          role="status"
          className="bg-primary absolute top-20 left-1/2 -translate-x-1/2 rounded-full px-5 py-2 font-semibold"
        >
          {t(banner)}
        </p>
      )}

      {stage === "paused" && pauseReason === "rest" && (
        <RestOverlay onContinue={() => runtimeRef.current?.resume(performance.now())} />
      )}

      {stage === "paused" && pauseReason && pauseReason !== "rest" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
          <Card className="flex w-full max-w-lg flex-col gap-4" role="dialog" aria-modal="true">
            <h2 className="text-2xl font-bold">{t("game.paused.title")}</h2>
            <p>{t(PAUSE_KEYS[pauseReason])}</p>
            {pauseReason !== "manual" && (
              <p className="text-muted">{t("game.paused.autoResume")}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {/* The session's own header is under the game, so leaving is offered here too. */}
              <SessionExitButton variant="ghost" />
              <Button variant="secondary" onClick={() => runtimeRef.current?.end()}>
                {t("game.end")}
              </Button>
              {pauseReason === "manual" && (
                <Button size="lg" onClick={() => runtimeRef.current?.resume(performance.now())}>
                  <Play size={20} aria-hidden />
                  {t("game.resume")}
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}

      {stage === "finished" && result && (
        <Results
          definition={definition}
          result={result}
          saveStatus={saveStatus}
          onRetrySave={() =>
            void loggerRef.current?.end({
              status: result.trialsDone >= result.trialsPlanned ? "completed" : "aborted",
              score: result.score,
              summary: result.summary,
            })
          }
          onContinue={onContinue}
          continueKey={continueKey}
          levels={startLevel !== null && level !== null ? { start: startLevel, end: level } : null}
        />
      )}
    </div>
  );
});

/** Starts the camera, then runs one game full screen, from countdown to results. */
interface GameShellProps {
  definition: GameDefinition;
  /** Called by the results screen's button: the next game, or the cool-down. */
  onContinue: () => void;
  continueKey: TranslationKey;
}

export function GameShell({ definition, onContinue, continueKey }: GameShellProps) {
  const { sessionId, affectedSide, calibration, latestCalibration } = useSession();
  // The game reads frames through subscribeTracking, so nothing here re-renders per frame.
  const { status, retry, subscribeTracking } = useTracking({ keepResult: false });
  const factory = useGameFactory(definition);

  if (status.phase !== "running") return <VisionStatusCard status={status} retry={retry} />;
  if (factory.state === "loading") {
    return (
      <div className="m-auto" role="status" aria-live="polite">
        <Spinner size={48} />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }
  if (factory.state === "failed") {
    return <QueryError onRetry={factory.retry} />;
  }
  if (sessionId === null || affectedSide === null) {
    return (
      <Card className="m-auto max-w-xl">
        <p>{t("game.noSession")}</p>
      </Card>
    );
  }
  return (
    <GamePlay
      definition={definition}
      create={factory.create}
      sessionId={sessionId}
      affectedSide={affectedSide}
      calibration={calibration ?? latestCalibration}
      subscribeTracking={subscribeTracking}
      onContinue={onContinue}
      continueKey={continueKey}
    />
  );
}
