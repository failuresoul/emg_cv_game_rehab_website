import { RotateCcw, Sparkles, Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { ReachMap } from "@/components/ReachMap";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  browserName,
  buildCalibration,
  compareArea,
  type DirectionResult,
  DIRECTION_KEYS,
  DIRECTIONS_DEG,
} from "@/features/session/calibration";
import { useAuth } from "@/features/auth/AuthContext";
import { ReachSweep, STAR_DISTANCE_SW, SWEEP_MS } from "@/features/session/reachSweep";
import { useSaveCalibration, useSession, useSessionStep } from "@/features/session/SessionContext";
import { getLanguage, t } from "@/i18n";
import { playBeep, playChime, playStar, prepareAudio } from "@/lib/beep";
import { formatNumber } from "@/lib/format";
import { canSpeak, onVoicesChanged, speak, stopSpeaking } from "@/lib/speech";
import type { DeviceInfo, Side } from "@/types/api";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { useTracking } from "@/vision/useTracking";
import { visionEngine } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";

const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;
const STAR_POINTS = DIRECTIONS_DEG.map((deg) => ({
  x: STAR_DISTANCE_SW * Math.cos((deg * Math.PI) / 180),
  y: STAR_DISTANCE_SW * Math.sin((deg * Math.PI) / 180),
}));

function StarRow({ lit }: { lit: readonly boolean[] }) {
  return (
    <div aria-hidden className="flex flex-wrap justify-center gap-1">
      {lit.map((isLit, index) => (
        <Star
          key={DIRECTIONS_DEG[index]}
          size={32}
          className={isLit ? "fill-accent text-accent" : "text-muted/40"}
        />
      ))}
    </div>
  );
}

function StarGame({
  affectedSide,
  voiceOn,
  deviceRef,
  onFinished,
}: {
  affectedSide: Side;
  voiceOn: boolean;
  deviceRef: { current: DeviceInfo };
  onFinished: (results: DirectionResult[], litCount: number) => void;
}) {
  const { status, result, retry, tracking, subscribeTracking, markTaskStart } = useTracking();
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [playing, setPlaying] = useState(false);
  const [sweep] = useState(() => new ReachSweep());
  const [lit, setLit] = useState<readonly boolean[]>(() => DIRECTIONS_DEG.map(() => false));
  const [secondsLeft, setSecondsLeft] = useState(SWEEP_MS / 1000);
  const [armLost, setArmLost] = useState(false);
  const isRunning = status.phase === "running";
  const instruction = t(
    affectedSide === "left"
      ? "calibrate.game.instruction.left"
      : "calibrate.game.instruction.right",
  );

  useEffect(
    () =>
      visionEngine.subscribe((frame) => {
        deviceRef.current = {
          ...deviceRef.current,
          fps: Math.round(frame.fps * 10) / 10,
          delegate: frame.delegate,
        };
      }),
    [deviceRef],
  );

  useEffect(() => {
    if (!isRunning || playing) return;
    playBeep();
    const timer = setTimeout(() => {
      if (count > 1) setCount(count - 1);
      else setPlaying(true);
    }, COUNTDOWN_STEP_MS);
    return () => clearTimeout(timer);
  }, [isRunning, playing, count]);

  useEffect(() => {
    if (!isRunning || !voiceOn) return;
    speak(instruction, getLanguage());
  }, [isRunning, voiceOn, instruction]);

  useEffect(() => {
    if (!playing) return;
    markTaskStart();
    let finished = false;
    return subscribeTracking((frame) => {
      if (finished) return;
      const update = sweep.add({
        timestamp: frame.timestamp,
        wristSw: frame.wristRawSw,
        trunkSw: frame.trunkMidpointSw,
        shoulderWidthPx: frame.shoulderWidthPx,
      });
      if (update.newlyLit.length > 0) {
        setLit([...sweep.litFlags]);
        playStar(sweep.litCount);
      }
      setSecondsLeft(update.secondsLeft);
      setArmLost(update.isArmLost);
      if (update.isFinished) {
        finished = true;
        playChime();
        onFinished(sweep.results(), sweep.litCount);
      }
    });
  }, [playing, sweep, subscribeTracking, markTaskStart, onFinished]);

  if (!isRunning) return <VisionStatusCard status={status} retry={retry} />;

  const litCount = lit.filter(Boolean).length;

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-4 lg:grid-cols-3">
      <div className="relative lg:col-span-2">
        <SkeletonCanvas
          result={result}
          stars={tracking?.frame ? { frame: tracking.frame, points: STAR_POINTS, lit } : null}
          wristSw={tracking?.wristRawSw ?? null}
        />
        {armLost && (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/70 p-6 text-center text-2xl font-bold text-white"
          >
            {t("warmup.trackingLost")}
          </div>
        )}
      </div>
      <Card className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-bold">{instruction}</h1>
        <div aria-live="polite" className="flex min-h-28 flex-col items-center justify-center">
          {playing ? (
            <>
              <p className="text-primary text-5xl font-bold">
                {t("calibrate.game.stars", { count: litCount, total: lit.length })}
              </p>
              <p className="text-muted text-lg">
                {t("calibrate.game.secondsLeft", { seconds: secondsLeft })}
              </p>
            </>
          ) : (
            <>
              <p className="text-primary text-7xl font-bold">{t("calibrate.count", { count })}</p>
              <p className="text-muted">{t("calibrate.getReady")}</p>
            </>
          )}
        </div>
        <StarRow lit={lit} />
      </Card>
    </div>
  );
}

const COMPARISON_KEYS = {
  similar: "calibrate.result.similar",
  larger: "calibrate.result.larger",
  smaller: "calibrate.result.smaller",
} as const;

function ResultView({
  results,
  litCount,
  affectedSide,
  sessionId,
  device,
  previousHull,
  previousArea,
  onTryAgain,
}: {
  results: readonly DirectionResult[];
  litCount: number;
  affectedSide: Side;
  sessionId: number;
  device: DeviceInfo;
  previousHull: [number, number][] | null;
  previousArea: number | null;
  onTryAgain: () => void;
}) {
  const save = useSaveCalibration();
  const calibration = buildCalibration(results, affectedSide);

  return (
    <Card className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <Sparkles size={32} aria-hidden className="text-accent shrink-0" />
        <h1 className="text-2xl font-bold">
          {t("calibrate.result.stars", { count: litCount, total: results.length })}
        </h1>
      </div>
      {calibration ? (
        <>
          <ReachMap
            points={calibration.reach_points_sw}
            hull={calibration.hull_sw}
            directionsDeg={calibration.directions_deg}
            directionLabels={DIRECTION_KEYS.map((key) => t(key))}
            affectedSide={affectedSide}
            previousHull={previousHull}
            valid={calibration.quality.valid}
          />
          <p className="text-lg font-semibold">
            {t("calibrate.result.area", { area: formatNumber(calibration.hull_area_sw2) })}
          </p>
          {previousArea !== null && (
            <p>
              {t(COMPARISON_KEYS[compareArea(calibration.hull_area_sw2, previousArea)])}{" "}
              <span className="text-muted">{t("calibrate.result.dashed")}</span>
            </p>
          )}
          {calibration.quality.valid.includes(false) && (
            <p className="text-muted">{t("calibrate.result.hollow")}</p>
          )}
        </>
      ) : (
        <p role="alert" className="text-danger font-medium">
          {t("calibrate.result.noBody")}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-danger font-medium">
          {t("calibrate.result.saveError")}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={onTryAgain}>
          <RotateCcw size={20} aria-hidden />
          {t("calibrate.result.tryAgain")}
        </Button>
        <Button
          size="lg"
          disabled={!calibration}
          loading={save.isPending}
          onClick={() => calibration && save.mutate({ sessionId, calibration, device })}
        >
          {t("calibrate.result.save")}
        </Button>
      </div>
    </Card>
  );
}

type Phase =
  | { name: "intro" }
  | { name: "playing"; attempt: number }
  | { name: "result"; results: DirectionResult[]; litCount: number; attempt: number };

export function SessionCalibratePage() {
  useSessionStep("calibrate");
  const navigate = useNavigate();
  const { sessionId, affectedSide, calibration, latestCalibration } = useSession();
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const [device, setDevice] = useState<DeviceInfo>({});
  // Spoken instructions: the patient's setting, when this device has a voice.
  const { user: voiceUser } = useAuth();
  const [voiceOn, setVoiceOn] = useState(
    () => voiceUser?.patient_profile?.voice_on === true && canSpeak(getLanguage()),
  );
  const [voiceAvailable, setVoiceAvailable] = useState(() => canSpeak(getLanguage()));
  const deviceRef = useRef<DeviceInfo>({ browser: browserName(navigator.userAgent) });
  const attempt = phase.name === "intro" ? 0 : phase.attempt;

  useEffect(() => onVoicesChanged(() => setVoiceAvailable(canSpeak(getLanguage()))), []);
  useEffect(() => stopSpeaking, []);

  const handleFinished = useCallback((results: DirectionResult[], litCount: number) => {
    setDevice(deviceRef.current);
    setPhase((current) =>
      current.name === "playing"
        ? { name: "result", results, litCount, attempt: current.attempt }
        : current,
    );
  }, []);

  // Saved, or already saved for this session before a refresh.
  if (calibration) return <Navigate to="/session/warmup" replace />;

  if (sessionId === null || affectedSide === null) {
    return (
      <Card className="m-auto max-w-xl">
        <p>{t("calibrate.noProfile")}</p>
        <Button className="mt-4" onClick={() => void navigate("/patient")}>
          {t("page.public.notFound.action")}
        </Button>
      </Card>
    );
  }

  if (phase.name === "intro") {
    return (
      <Card className="m-auto flex max-w-xl flex-col items-center gap-4 text-center">
        <Star size={56} aria-hidden className="fill-accent text-accent" />
        <h1 className="text-2xl font-bold">{t("calibrate.intro.title")}</h1>
        <p>
          {t(affectedSide === "left" ? "calibrate.intro.body.left" : "calibrate.intro.body.right")}
        </p>
        {voiceAvailable && (
          <Button variant="secondary" aria-pressed={voiceOn} onClick={() => setVoiceOn(!voiceOn)}>
            {t(voiceOn ? "warmup.voiceOn" : "warmup.voiceOff")}
          </Button>
        )}
        <Button
          size="lg"
          onClick={() => {
            prepareAudio();
            setPhase({ name: "playing", attempt: 1 });
          }}
        >
          {t("calibrate.intro.start")}
        </Button>
      </Card>
    );
  }

  if (phase.name === "playing") {
    return (
      <StarGame
        key={attempt}
        affectedSide={affectedSide}
        voiceOn={voiceOn}
        deviceRef={deviceRef}
        onFinished={handleFinished}
      />
    );
  }

  return (
    <ResultView
      results={phase.results}
      litCount={phase.litCount}
      affectedSide={affectedSide}
      sessionId={sessionId}
      device={device}
      previousHull={latestCalibration?.hull_sw ?? null}
      previousArea={latestCalibration?.hull_area_sw2 ?? null}
      onTryAgain={() => setPhase({ name: "playing", attempt: attempt + 1 })}
    />
  );
}
