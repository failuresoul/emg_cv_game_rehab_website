import { Dumbbell, Move, MoveUpRight, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/features/auth/AuthContext";
import { useSession } from "@/features/session/SessionContext";
import { t, tEnglish, type TranslationKey } from "@/i18n";
import { playBeep, playChime, playTick, prepareAudio, setMuted } from "@/lib/beep";
import { isSpeechAvailable, speak, stopSpeaking } from "@/lib/speech";
import type { Side } from "@/types/api";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { type JointAngleState, useJointAngles } from "@/vision/useJointAngles";
import { useVision } from "@/vision/useVision";
import type { VisionResult } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";
import { AngleGauge } from "@/warmup/AngleGauge";
import { DemoFigure } from "@/warmup/DemoFigure";
import {
  type ExerciseFeedback,
  type ExerciseResult,
  ExerciseRunner,
} from "@/warmup/exerciseRunner";
import {
  EXERCISE_ORDER,
  type ExerciseDefinition,
  type ExerciseId,
  type ExercisePreset,
  EXERCISES,
} from "@/warmup/exercises";
import { ExerciseSummary } from "@/warmup/ExerciseSummary";
import { awaitingRestKey, feedbackKey } from "@/warmup/feedback";
import { RepCounterRing } from "@/warmup/RepCounterRing";

const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;
const FEEDBACK_SHOW_MS = 3000;

const EXERCISE_ICONS = {
  shoulder_flexion: MoveUpRight,
  shoulder_abduction: Move,
  elbow_flexion: Dumbbell,
} as const;

interface ExerciseStepProps {
  exercise: ExerciseDefinition;
  preset: ExercisePreset;
  /** After switching to the easier preset, there is no need to read the instructions again. */
  startAtCountdown: boolean;
  affectedSide: Side;
  visionResult: VisionResult | null;
  voiceOn: boolean;
  onEasier: (startAtCountdown: boolean) => void;
  onResult: (result: ExerciseResult) => void;
  onNext: () => void;
}

function ExerciseStep({
  exercise,
  preset,
  startAtCountdown,
  affectedSide,
  visionResult,
  voiceOn,
  onEasier,
  onResult,
  onNext,
}: ExerciseStepProps) {
  const [runner] = useState(() => new ExerciseRunner(exercise, preset));
  const [stage, setStage] = useState(runner.state);
  const [fullReps, setFullReps] = useState(0);
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [best, setBest] = useState<number | null>(null);
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [feedback, setFeedback] = useState<{ key: TranslationKey; id: number } | null>(null);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const pausedForDialog = useRef(false);
  const feedbackId = useRef(0);
  const lastPlaneFeedbackAt = useRef(-Infinity);
  const { measure, direction, targetReps } = exercise;
  const thresholds = exercise.presets[preset];
  const bestOf = direction === "up" ? Math.max : Math.min;

  const onFrame = useCallback(
    (state: JointAngleState) => {
      const value = state.filtered[measure];
      runner.update({
        timestamp: state.timestamp,
        value,
        rawValue: state.raw[measure]?.value,
        planeDeg: state.filtered.elevationPlaneDeg,
        source: state.raw[measure]?.source,
        trunkReference: state.raw[measure]?.trunkReference,
      });
      if (value !== null && runner.state === "ACTIVE" && !runner.awaitingRest) {
        setBest((current) => (current === null ? value : bestOf(current, value)));
      }
    },
    [runner, measure, bestOf],
  );
  const angles = useJointAngles(onFrame);

  useEffect(() => {
    const showFeedback = (item: ExerciseFeedback) => {
      const now = performance.now();
      if (item === "forward" || item === "sideways") lastPlaneFeedbackAt.current = now;
      // A rep sends its plane advice just before "good"; the advice is the more useful.
      else if (item === "good" && now - lastPlaneFeedbackAt.current < 100) return;
      feedbackId.current += 1;
      setFeedback({ key: feedbackKey(item, direction), id: feedbackId.current });
    };

    return runner.subscribe((event) => {
      if (event.type === "stateChanged") {
        setStage(event.state);
        if (event.state === "DONE" || event.state === "SKIPPED") {
          const finished = runner.getResult();
          if (finished) {
            setResult(finished);
            onResult(finished);
          }
          if (event.state === "DONE") playChime();
          else onNext();
        }
      } else if (event.type === "repCompleted") {
        setFullReps(runner.fullReps);
        playTick();
        if (voiceOn) speak(String(runner.fullReps));
      } else if (event.type === "feedback") {
        showFeedback(event.feedback);
      }
    });
  }, [runner, direction, voiceOn, onResult, onNext]);

  useEffect(() => {
    if (startAtCountdown && runner.state === "INTRO") runner.startCountdown(performance.now());
  }, [runner, startAtCountdown]);

  useEffect(() => {
    if (stage !== "COUNTDOWN") return;
    playBeep();
    const timer = setTimeout(() => {
      if (count > 1) setCount(count - 1);
    }, COUNTDOWN_STEP_MS);
    return () => clearTimeout(timer);
  }, [stage, count]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), FEEDBACK_SHOW_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!voiceOn || stage !== "INTRO" || startAtCountdown) return;
    speak(exercise.instructionKeys.map((key) => tEnglish(key)).join(" "));
  }, [voiceOn, stage, startAtCountdown, exercise]);

  function openSkipDialog() {
    if (runner.state === "ACTIVE") {
      runner.pause(performance.now());
      pausedForDialog.current = true;
    }
    setConfirmingSkip(true);
  }

  function closeSkipDialog() {
    setConfirmingSkip(false);
    if (pausedForDialog.current) runner.resume(performance.now());
    pausedForDialog.current = false;
  }

  const easierLink = preset === "standard" && (
    <button
      type="button"
      className="text-primary min-h-11 cursor-pointer font-medium underline"
      onClick={() => onEasier(runner.state === "ACTIVE" || runner.state === "PAUSED")}
    >
      {t("warmup.easier")}
    </button>
  );

  if (stage === "INTRO") {
    return (
      <Card className="m-auto flex w-full max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-bold">{t(exercise.nameKey)}</h1>
        <ol className="list-decimal space-y-2 pl-6">
          {exercise.instructionKeys.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
        {exercise.tipKey && <p className="font-medium">{t(exercise.tipKey)}</p>}
        <p className="bg-primary-light text-primary rounded-lg p-3 font-medium">
          {t("warmup.reminder")}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {easierLink}
          <Button size="lg" className="ml-auto" onClick={() => runner.startDemo()}>
            {t("warmup.showMe")}
          </Button>
        </div>
      </Card>
    );
  }

  if (stage === "DEMO") {
    return (
      <Card className="m-auto flex w-full max-w-xl flex-col items-center gap-3">
        <h1 className="text-2xl font-bold">{t(exercise.nameKey)}</h1>
        <DemoFigure frames={exercise.demoKeyframes} affectedSide={affectedSide} />
        <Button size="lg" onClick={() => runner.startCountdown(performance.now())}>
          {t("warmup.gotIt")}
        </Button>
      </Card>
    );
  }

  if (stage === "DONE" && result) {
    return (
      <Card className="m-auto flex w-full max-w-xl flex-col gap-4">
        <ExerciseSummary result={result} />
        <Button size="lg" onClick={onNext}>
          {t("warmup.next")}
        </Button>
      </Card>
    );
  }

  const value = angles?.filtered[measure] ?? null;
  const trackingLost = stage === "PAUSED" && !runner.pausedByUser;
  const userPaused = stage === "PAUSED" && runner.pausedByUser;
  let feedbackLine: string | null = feedback && t(feedback.key);
  if (!feedbackLine && stage === "ACTIVE" && runner.awaitingRest) {
    feedbackLine = t(awaitingRestKey(direction));
  }
  if (userPaused) feedbackLine = t("warmup.paused");

  return (
    <div className="mx-auto grid w-full max-w-[1700px] flex-1 items-start gap-4 lg:grid-cols-12">
      <div className="relative lg:col-span-7">
        <SkeletonCanvas result={visionResult} highlightSide={affectedSide} />
        {trackingLost && (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/70 p-6 text-center text-2xl font-bold text-white"
          >
            {t("warmup.trackingLost")}
          </div>
        )}
      </div>
      <Card className="flex flex-col gap-2 p-4 lg:col-span-5">
        <h1 className="text-xl font-bold">{t(exercise.nameKey)}</h1>
        {stage === "COUNTDOWN" ? (
          <div className="flex min-h-64 flex-col items-center justify-center" aria-live="polite">
            <p className="text-primary text-8xl font-bold">{t("calibrate.count", { count })}</p>
            <p className="text-muted">{t("calibrate.getReady")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 items-center gap-2">
              <RepCounterRing current={fullReps} total={targetReps} />
              <AngleGauge value={value} best={best} thresholds={thresholds} />
            </div>
            <p aria-live="polite" className="text-accent min-h-9 text-center text-xl font-bold">
              {feedbackLine}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                disabled={trackingLost}
                onClick={() =>
                  userPaused ? runner.resume(performance.now()) : runner.pause(performance.now())
                }
              >
                {userPaused ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}
                {t(userPaused ? "warmup.resume" : "warmup.pause")}
              </Button>
              <Button variant="ghost" onClick={openSkipDialog}>
                {t("warmup.skip")}
              </Button>
            </div>
            <div className="text-center">{easierLink}</div>
          </>
        )}
      </Card>
      <Modal open={confirmingSkip} title={t("warmup.skipConfirm.title")} onClose={closeSkipDialog}>
        <p>{t("warmup.skipConfirm.body")}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={closeSkipDialog}>
            {t("warmup.skipConfirm.keep")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmingSkip(false);
              pausedForDialog.current = false;
              runner.skip(performance.now());
            }}
          >
            {t("warmup.skip")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function WarmupRun({ affectedSide, onFinished }: { affectedSide: Side; onFinished: () => void }) {
  const { status, result, retry } = useVision();
  const { addWarmupResult } = useSession();
  const [position, setPosition] = useState(0);
  const [presets, setPresets] = useState<Partial<Record<ExerciseId, ExercisePreset>>>({});
  const [startAtCountdown, setStartAtCountdown] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMutedState] = useState(false);

  const id = EXERCISE_ORDER[position];
  const preset = presets[id] ?? "standard";

  useEffect(() => stopSpeaking, []);
  useEffect(() => () => setMuted(false), []);

  const handleNext = useCallback(() => {
    setStartAtCountdown(false);
    if (position + 1 < EXERCISE_ORDER.length) setPosition(position + 1);
    else onFinished();
  }, [position, onFinished]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (next) stopSpeaking();
  }

  if (status.phase !== "running") return <VisionStatusCard status={status} retry={retry} />;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto font-medium">
          {t("warmup.progress", { current: position + 1, total: EXERCISE_ORDER.length })}
        </p>
        {isSpeechAvailable() && (
          <Button
            variant="secondary"
            aria-pressed={voiceOn}
            onClick={() => {
              if (voiceOn) stopSpeaking();
              setVoiceOn(!voiceOn);
            }}
          >
            {t(voiceOn ? "warmup.voiceOn" : "warmup.voiceOff")}
          </Button>
        )}
        <Button variant="secondary" aria-pressed={muted} onClick={toggleMute}>
          {muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
          {t(muted ? "warmup.unmute" : "warmup.mute")}
        </Button>
      </div>
      <ExerciseStep
        key={`${id}-${preset}`}
        exercise={EXERCISES[id]}
        preset={preset}
        startAtCountdown={startAtCountdown}
        affectedSide={affectedSide}
        visionResult={result}
        voiceOn={voiceOn}
        onEasier={(fromActive) => {
          setStartAtCountdown(fromActive);
          setPresets((current) => ({ ...current, [id]: "gentle" }));
        }}
        onResult={addWarmupResult}
        onNext={handleNext}
      />
    </div>
  );
}

export function SessionWarmupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { warmupResults } = useSession();
  const affectedSide = user?.patient_profile?.affected_side;
  const finished = EXERCISE_ORDER.every((id) =>
    warmupResults.some((result) => result.exerciseId === id),
  );
  const [phase, setPhase] = useState<"overview" | "running" | "complete">(
    finished ? "complete" : "overview",
  );
  const handleFinished = useCallback(() => setPhase("complete"), []);

  if (!affectedSide) {
    return (
      <Card className="m-auto max-w-xl">
        <p>{t("calibrate.noProfile")}</p>
      </Card>
    );
  }

  if (phase === "overview") {
    return (
      <Card className="m-auto flex w-full max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-bold">{t("warmup.overview.title")}</h1>
        <p className="text-muted">{t("warmup.overview.time")}</p>
        <ul className="flex flex-col gap-3">
          {EXERCISE_ORDER.map((id) => {
            const Icon = EXERCISE_ICONS[id];
            return (
              <li key={id} className="flex items-center gap-3 font-medium">
                <Icon size={28} aria-hidden className="text-primary shrink-0" />
                {t(EXERCISES[id].nameKey)}
              </li>
            );
          })}
        </ul>
        <Button
          size="lg"
          onClick={() => {
            prepareAudio();
            setPhase("running");
          }}
        >
          {t("calibrate.intro.start")}
        </Button>
      </Card>
    );
  }

  if (phase === "running") {
    return <WarmupRun affectedSide={affectedSide} onFinished={handleFinished} />;
  }

  return (
    <Card className="m-auto flex w-full max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("warmup.complete.title")}</h1>
      <div className="grid gap-6 md:grid-cols-3">
        {EXERCISE_ORDER.flatMap((id) => {
          const result = warmupResults.find((item) => item.exerciseId === id);
          return result ? [<ExerciseSummary key={id} result={result} />] : [];
        })}
      </div>
      <Button size="lg" onClick={() => void navigate("/session/plan")}>
        {t("warmup.complete.continue")}
      </Button>
    </Card>
  );
}
