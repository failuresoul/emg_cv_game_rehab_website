import { Pause, Play } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { FixedProvider } from "@/ai/paramsProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useSession } from "@/features/session/SessionContext";
import { t, type TranslationKey } from "@/i18n";
import { ActivationMeter, type InputManager, useSessionActivation } from "@/input";
import type { ActivationSourceId } from "@/input";
import { api } from "@/lib/api";
import type { Calibration, Side } from "@/types/api";
import type { Point } from "@/vision/geometry";
import { computePosture } from "@/vision/posture";
import type { TrackingState } from "@/vision/tracking";
import { useTracking } from "@/vision/useTracking";
import { visionEngine, type VisionResult } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";
import { CompensationMonitor } from "@/warmup/compensation";
import { COMPENSATION_CONFIG } from "@/warmup/compensationConfig";

import { gameAudio } from "./audio";
import { GameRuntime, type PauseReason, type RuntimeStage } from "./gameRuntime";
import { createPlayArea, type PlayArea } from "./playArea";
import { GAMES } from "./registry";
import { createRng, newSeed } from "./rng";
import { drawSkeletonLayer } from "./skeletonLayer";
import { type SaveStatus, TrialLogger } from "./trialLogger";
import type {
  GameContext,
  GameDefinition,
  GameFeedback,
  GameInstance,
  GameResult,
  GameTracking,
} from "./types";

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

const SOURCE_KEYS: Record<ActivationSourceId, TranslationKey> = {
  cv_grip: "game.source.webcam",
  keyboard: "game.source.keyboard",
  emg: "game.source.emg",
};

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
};

interface Hud {
  trial: number;
  trialsPlanned: number;
  score: number;
  elapsedMs: number;
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
}

function Results({ definition, result, saveStatus, onRetrySave, onContinue }: ResultsProps) {
  const meanMs = result.summary.mean_movement_ms;
  const saveKey = SAVE_KEYS[saveStatus];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
      <Card className="flex w-full max-w-lg flex-col gap-5" role="dialog" aria-modal="true">
        <h2 className="text-2xl font-bold">{t("game.results.title")}</h2>
        <p className="text-muted">{t(definition.nameKey)}</p>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          <div>
            <dt className="text-muted">{t("game.results.meanReach")}</dt>
            <dd className="text-3xl font-bold tabular-nums">
              {meanMs === null
                ? t("game.results.noValue")
                : t("game.results.seconds", { value: Math.round(meanMs / 100) / 10 })}
            </dd>
          </div>
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
            {t("game.continue")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

interface GamePlayProps {
  definition: GameDefinition;
  sessionId: number;
  affectedSide: Side;
  calibration: Calibration | null;
  subscribeTracking: (listener: (state: TrackingState) => void) => () => void;
}

const GamePlay = memo(function GamePlay({
  definition,
  sessionId,
  affectedSide,
  calibration: calibrationAtStart,
  subscribeTracking,
}: GamePlayProps) {
  // A refreshed copy of the same calibration must not restart the game.
  const [calibration] = useState(calibrationAtStart);
  const navigate = useNavigate();
  const activation = useSessionActivation(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackingRef = useRef<TrackingState | null>(null);
  const visionRef = useRef<VisionResult | null>(null);
  const playAreaRef = useRef<PlayArea | null>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const loggerRef = useRef<TrialLogger | null>(null);
  const activationRef = useRef(activation);
  const [monitor] = useState(
    () => new CompensationMonitor(COMPENSATION_EXERCISE, GAME_COMPENSATION_CONFIG),
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
  });
  const [feedback, setFeedback] = useState<(GameFeedback & { id: number }) | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    activationRef.current = activation;
  }, [activation]);

  useEffect(() => subscribeTracking((state) => (trackingRef.current = state)), [subscribeTracking]);

  useEffect(
    () =>
      visionEngine.subscribe((frame) => {
        visionRef.current = frame;
        monitor.addSample(computePosture(frame, affectedSide), frame.timestamp);
      }),
    [monitor, affectedSide],
  );

  // Each new message restarts the timer, so the latest one always gets its full time.
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), FEEDBACK_SHOW_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const provider = useMemo(
    () => new FixedProvider({ specsFor: (id) => GAMES[id].params, seed }),
    [seed],
  );

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
    const firstParams = provider.nextParams(definition.id, []);
    const logger = new TrialLogger({
      http: api,
      sessionId,
      // Read when the game starts, so a source switched during the countdown is the one saved.
      run: () => ({
        game_id: definition.id,
        engine: provider.engine,
        input_source: activationRef.current.sourceId,
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
          timestamp: runtimeRef.current?.toGameTime(timestamp) ?? timestamp,
        };
      },
      activation: {
        get sourceId() {
          return activationRef.current.sourceId;
        },
        getLevel: () => activationRef.current.getLevel(),
        isReady: () => activationRef.current.manager?.isReady() ?? false,
      },
      calibration,
      affectedSide,
      rng,
      audio: gameAudio,
      params: {
        engine: provider.engine,
        next: () => provider.nextParams(definition.id, logger.history),
      },
      logger,
      compensation: monitor,
      emit: (item) => setFeedback({ ...item, id: ++feedbackId }),
    };

    const game: GameInstance = definition.create(gameContext);
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
        void logger.start();
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

    // requestAnimationFrame stops in a hidden tab, so the loop alone would never see it.
    const onVisibility = () => {
      if (document.hidden) runtime.pause("hidden", performance.now());
    };
    document.addEventListener("visibilitychange", onVisibility);

    let frameId = 0;
    let lastHud = -Infinity;
    const loop = (wallMs: number) => {
      const tracking = trackingRef.current;
      runtime.frame(wallMs, {
        handPresent: tracking?.handPresent ?? false,
        hidden: document.hidden,
      });

      const playArea = area();
      context2d.fillStyle = BACKGROUND;
      context2d.fillRect(0, 0, playArea.width, playArea.height);
      const vision = visionRef.current;
      if (vision) {
        drawSkeletonLayer(context2d, {
          pose: vision.pose,
          frame: tracking?.frame ?? null,
          frameWidth: vision.frameWidth,
          frameHeight: vision.frameHeight,
          affectedSide,
          toScreen: playArea.toScreen,
          pixelsPerSw: playArea.pixelsPerSw,
        });
      }
      if (runtime.stage !== "countdown") game.render(context2d);
      const cursor = tracking?.fingertipSmoothSw;
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
        };
        setHud((current) =>
          current.trial === next.trial &&
          current.score === next.score &&
          Math.floor(current.elapsedMs / 1000) === Math.floor(next.elapsedMs / 1000)
            ? current
            : next,
        );
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      // Leaving mid-game: save what was played as an aborted run.
      if (started && !finished) {
        const summary = game.getSummary();
        void logger.end({ status: "aborted", score: summary.score, summary: summary.summary });
      }
      unsubscribeLogger();
      game.destroy();
      runtimeRef.current = null;
    };
  }, [definition, sessionId, affectedSide, calibration, provider, seed, monitor]);

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
        <p className="tabular-nums">{t("game.hud.time", { value: formatTime(hud.elapsedMs) })}</p>
        <div className="ml-auto flex items-center gap-3">
          {saveKey && (
            <span role="status" className="text-base text-white/80">
              {t(saveKey)}
            </span>
          )}
          <Badge variant={activation.sourceId === "keyboard" ? "warning" : "neutral"}>
            {t(SOURCE_KEYS[activation.sourceId])}
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

      <div className="absolute right-4 bottom-4 flex flex-col items-center gap-2">
        <LiveMeter manager={activation.manager} />
        <span className="text-base">{t("game.hud.squeeze")}</span>
      </div>

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
            {count ?? 3}
          </p>
        </div>
      )}

      {stage === "paused" && pauseReason && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
          <Card className="flex w-full max-w-lg flex-col gap-4" role="dialog" aria-modal="true">
            <h2 className="text-2xl font-bold">{t("game.paused.title")}</h2>
            <p>{t(PAUSE_KEYS[pauseReason])}</p>
            {pauseReason !== "manual" && (
              <p className="text-muted">{t("game.paused.autoResume")}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
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
          onContinue={() => void navigate("/session/plan")}
        />
      )}
    </div>
  );
});

/** Starts the camera, then runs one game full screen, from countdown to results. */
export function GameShell({ definition }: { definition: GameDefinition }) {
  const { sessionId, affectedSide, calibration, latestCalibration } = useSession();
  const { status, retry, subscribeTracking } = useTracking();

  if (status.phase !== "running") return <VisionStatusCard status={status} retry={retry} />;
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
      sessionId={sessionId}
      affectedSide={affectedSide}
      calibration={calibration ?? latestCalibration}
      subscribeTracking={subscribeTracking}
    />
  );
}
