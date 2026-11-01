import clsx from "clsx";
import { Armchair, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ReachMap } from "@/components/ReachMap";
import {
  browserName,
  buildCalibration,
  compareArea,
  decideAttempt,
  type DirectionResult,
  DIRECTIONS_DEG,
  HOLD_WINDOW_MS,
  type ReachWindow,
  startWindow,
  updateWindow,
} from "@/features/session/calibration";
import { useSaveCalibration, useSession } from "@/features/session/SessionContext";
import { t, type TranslationKey } from "@/i18n";
import { playBeep, prepareAudio } from "@/lib/beep";
import type { DeviceInfo, Side } from "@/types/api";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { useTracking } from "@/vision/useTracking";
import { VisionStatusCard } from "@/vision/VisionStatusCard";
import { visionEngine } from "@/vision/visionEngine";

const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;
const DIRECTION_COUNT = DIRECTIONS_DEG.length;

const DIRECTION_KEYS: TranslationKey[] = [
  "calibrate.direction.0",
  "calibrate.direction.45",
  "calibrate.direction.90",
  "calibrate.direction.135",
  "calibrate.direction.180",
  "calibrate.direction.225",
  "calibrate.direction.270",
  "calibrate.direction.315",
];

type Tracking = ReturnType<typeof useTracking>;

interface DirectionStepProps {
  index: number;
  tracking: Tracking;
  progressIndex: number;
  progressTotal: number;
  onDone: (index: number, result: DirectionResult) => void;
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{t("calibrate.progress", { current: current + 1, total })}</p>
      <div aria-hidden className="flex flex-wrap gap-2">
        {Array.from({ length: total }, (_, dot) => (
          <span
            key={dot}
            className={clsx(
              "size-4 rounded-full",
              dot < current && "bg-success",
              dot === current && "bg-accent",
              dot > current && "bg-muted/30",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function DirectionStep({
  index,
  tracking,
  progressIndex,
  progressTotal,
  onDone,
}: DirectionStepProps) {
  const { result, tracking: state, subscribeTracking, markTaskStart } = tracking;
  const directionDeg = DIRECTIONS_DEG[index];

  const [stage, setStage] = useState<"countdown" | "measuring" | "paused">("countdown");
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [attempt, setAttempt] = useState(0);
  const [askedToSitBack, setAskedToSitBack] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(HOLD_WINDOW_MS / 1000);
  const retries = useRef(0);
  const trunkRepeats = useRef(0);

  const restart = useCallback(() => {
    setCount(COUNTDOWN_FROM);
    setSecondsLeft(HOLD_WINDOW_MS / 1000);
    setAttempt((current) => current + 1);
    setStage("countdown");
  }, []);

  useEffect(() => {
    if (stage !== "countdown") return;
    playBeep();
    const timer = setTimeout(() => {
      if (count > 1) setCount(count - 1);
      else setStage("measuring");
    }, COUNTDOWN_STEP_MS);
    return () => clearTimeout(timer);
  }, [stage, count, attempt]);

  useEffect(() => {
    if (stage !== "measuring") return;
    markTaskStart();
    let window: ReachWindow | null = null;
    // A late frame can arrive before React removes this listener; it must not count twice.
    let settled = false;
    return subscribeTracking((frame) => {
      if (settled) return;
      window ??= startWindow(directionDeg, frame.timestamp);
      const update = updateWindow(window, frame);
      window = update.window;
      setSecondsLeft(
        Math.max(1, Math.ceil((HOLD_WINDOW_MS - (frame.timestamp - window.startedAt)) / 1000)),
      );

      if (update.outcome !== "measuring") settled = true;
      if (update.outcome === "lost") {
        retries.current++;
        setStage("paused");
      } else if (update.outcome === "finished") {
        const decision = decideAttempt(window.maxTrunkSw, trunkRepeats.current);
        if (decision === "repeat") {
          retries.current++;
          trunkRepeats.current++;
          setAskedToSitBack(true);
          restart();
          return;
        }
        onDone(index, {
          bestProjectionSw: window.bestProjectionSw,
          maxTrunkSw: window.maxTrunkSw,
          retries: retries.current,
          flagged: decision === "acceptFlagged",
          shoulderWidthPx: window.shoulderWidthPx,
        });
      }
    });
  }, [stage, attempt, directionDeg, index, markTaskStart, subscribeTracking, restart, onDone]);

  // Resumes without needing a click, because the patient's hand may not reach the mouse.
  useEffect(() => {
    if (stage !== "paused") return;
    let settled = false;
    return subscribeTracking((frame) => {
      if (settled || !frame.handPresent || !frame.poseOk) return;
      settled = true;
      restart();
    });
  }, [stage, subscribeTracking, restart]);

  function skip() {
    onDone(index, {
      bestProjectionSw: null,
      maxTrunkSw: 0,
      retries: retries.current,
      flagged: true,
      shoulderWidthPx: state?.shoulderWidthPx ?? null,
    });
  }

  const direction = t(DIRECTION_KEYS[index]);

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <SkeletonCanvas
          result={result}
          arrow={state?.frame ? { frame: state.frame, directionDeg } : null}
        />
      </div>
      <Card className="flex flex-col gap-4">
        <ProgressDots current={progressIndex} total={progressTotal} />
        <h1 className="text-2xl font-bold">{t("calibrate.instruction", { direction })}</h1>

        <div
          aria-live="polite"
          className="flex min-h-32 flex-col items-center justify-center gap-1 text-center"
        >
          {stage === "countdown" && (
            <>
              <p className="text-primary text-6xl font-bold">{t("calibrate.count", { count })}</p>
              <p className="text-muted">{t("calibrate.getReady")}</p>
            </>
          )}
          {stage === "measuring" && (
            <>
              <p className="text-accent text-3xl font-bold">{t("calibrate.reachAndHold")}</p>
              <p className="text-lg font-medium">
                {t("calibrate.seconds", { seconds: secondsLeft })}
              </p>
            </>
          )}
          {stage === "paused" && (
            <>
              <p className="text-xl font-bold">{t("calibrate.pausedTitle")}</p>
              <p>{t("calibrate.pausedBody")}</p>
            </>
          )}
        </div>

        {askedToSitBack && (
          <p className="bg-primary-light text-primary flex items-center gap-2 rounded-lg p-3 font-medium">
            <Armchair size={24} aria-hidden className="shrink-0" />
            {t("calibrate.keepBack")}
          </p>
        )}
        {stage === "paused" && (
          <Button variant="ghost" onClick={skip}>
            {t("calibrate.skip")}
          </Button>
        )}
      </Card>
    </div>
  );
}

function MeasureRun({
  queue,
  deviceRef,
  onDirectionDone,
  onFinished,
}: {
  queue: readonly number[];
  deviceRef: { current: DeviceInfo };
  onDirectionDone: (index: number, result: DirectionResult) => void;
  onFinished: () => void;
}) {
  const tracking = useTracking();
  const [position, setPosition] = useState(0);

  useEffect(
    () =>
      visionEngine.subscribe((result) => {
        deviceRef.current = {
          ...deviceRef.current,
          fps: Math.round(result.fps * 10) / 10,
          delegate: result.delegate,
        };
      }),
    [deviceRef],
  );

  const handleDone = useCallback(
    (index: number, result: DirectionResult) => {
      onDirectionDone(index, result);
      if (position + 1 < queue.length) setPosition(position + 1);
      else onFinished();
    },
    [onDirectionDone, onFinished, position, queue.length],
  );

  if (tracking.status.phase !== "running") {
    return <VisionStatusCard status={tracking.status} retry={tracking.retry} />;
  }

  return (
    <DirectionStep
      key={queue[position]}
      index={queue[position]}
      tracking={tracking}
      progressIndex={position}
      progressTotal={queue.length}
      onDone={handleDone}
    />
  );
}

const COMPARISON_KEYS = {
  similar: "calibrate.result.similar",
  larger: "calibrate.result.larger",
  smaller: "calibrate.result.smaller",
} as const;

function ResultView({
  results,
  affectedSide,
  sessionId,
  device,
  previousHull,
  previousArea,
  onRedo,
}: {
  results: readonly DirectionResult[];
  affectedSide: Side;
  sessionId: number;
  device: DeviceInfo;
  previousHull: [number, number][] | null;
  previousArea: number | null;
  onRedo: (index: number) => void;
}) {
  const save = useSaveCalibration();
  const [choosing, setChoosing] = useState(false);
  const calibration = buildCalibration(results, affectedSide);
  const labels = DIRECTION_KEYS.map((key) => t(key));

  return (
    <Card className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("calibrate.result.title")}</h1>
      {calibration ? (
        <>
          <ReachMap
            points={calibration.reach_points_sw}
            hull={calibration.hull_sw}
            directionsDeg={calibration.directions_deg}
            directionLabels={labels}
            affectedSide={affectedSide}
            previousHull={previousHull}
            valid={calibration.quality.valid}
          />
          <p className="text-lg font-semibold">
            {t("calibrate.result.area", { area: calibration.hull_area_sw2.toFixed(2) })}
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
        <Button variant="secondary" size="lg" onClick={() => setChoosing(true)}>
          <RotateCcw size={20} aria-hidden />
          {t("calibrate.result.redo")}
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
      <Modal
        open={choosing}
        title={t("calibrate.result.redoTitle")}
        onClose={() => setChoosing(false)}
      >
        <div className="flex flex-col gap-2">
          {labels.map((label, index) => (
            <Button
              key={label}
              variant="secondary"
              className="justify-between"
              onClick={() => {
                prepareAudio();
                setChoosing(false);
                onRedo(index);
              }}
            >
              {label}
              {calibration && !calibration.quality.valid[index] && (
                <Badge variant="warning">{t("calibrate.result.flagged")}</Badge>
              )}
            </Button>
          ))}
        </div>
      </Modal>
    </Card>
  );
}

type Phase = { name: "intro" } | { name: "measuring"; queue: number[] } | { name: "result" };

export function SessionCalibratePage() {
  const navigate = useNavigate();
  const { sessionId, affectedSide, calibration, latestCalibration } = useSession();
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const [results, setResults] = useState<(DirectionResult | null)[]>(() =>
    Array.from({ length: DIRECTION_COUNT }, () => null),
  );
  const [device, setDevice] = useState<DeviceInfo>({});
  const deviceRef = useRef<DeviceInfo>({ browser: browserName(navigator.userAgent) });

  const handleDirectionDone = useCallback((index: number, result: DirectionResult) => {
    setResults((current) => current.map((item, i) => (i === index ? result : item)));
  }, []);
  const handleFinished = useCallback(() => {
    setDevice(deviceRef.current);
    setPhase({ name: "result" });
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
        <Armchair size={48} aria-hidden className="text-primary" />
        <h1 className="text-2xl font-bold">{t("calibrate.intro.title")}</h1>
        <p>{t("calibrate.intro.body")}</p>
        <Button
          size="lg"
          onClick={() => {
            prepareAudio();
            setPhase({ name: "measuring", queue: DIRECTIONS_DEG.map((_, index) => index) });
          }}
        >
          {t("calibrate.intro.start")}
        </Button>
      </Card>
    );
  }

  if (phase.name === "measuring") {
    return (
      <MeasureRun
        queue={phase.queue}
        deviceRef={deviceRef}
        onDirectionDone={handleDirectionDone}
        onFinished={handleFinished}
      />
    );
  }

  return (
    <ResultView
      results={results.flatMap((result) => result ?? [])}
      affectedSide={affectedSide}
      sessionId={sessionId}
      device={device}
      previousHull={latestCalibration?.hull_sw ?? null}
      previousArea={latestCalibration?.hull_area_sw2 ?? null}
      onRedo={(index) => setPhase({ name: "measuring", queue: [index] })}
    />
  );
}
