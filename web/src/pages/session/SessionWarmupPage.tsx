import {
  Check,
  Dumbbell,
  Hand,
  Move,
  MoveRight,
  MoveUpRight,
  Pause,
  Play,
  Pointer,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/features/auth/AuthContext";
import {
  forcedWarmupPreset,
  usePatientProgramme,
  warmupOrder,
} from "@/features/programme/patientProgramme";
import { useSession, useSessionStep } from "@/features/session/SessionContext";
import { firstUnfinished } from "@/features/session/sessionSteps";
import { getLanguage, t, type TranslationKey } from "@/i18n";
import { playBeep, playChime, playTick, prepareAudio, setMuted } from "@/lib/beep";
import { canSpeak, onVoicesChanged, speak, stopSpeaking } from "@/lib/speech";
import type { PatientProgramme, Side, WarmupResult } from "@/types/api";
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
  EXERCISES,
  type ThresholdPreset,
} from "@/warmup/exercises";
import { ExerciseSummary } from "@/warmup/ExerciseSummary";
import { exerciseFeedbackKey, exerciseWaitingKey, trackingLostKey } from "@/warmup/feedback";
import { displayValue, frameForExercise } from "@/warmup/frames";
import { reasonTexts, targetOf, type WarmupHistoryEntry } from "@/warmup/personalise";
import { PostureIndicator, type PostureStatus } from "@/warmup/PostureIndicator";
import { RepCounterRing } from "@/warmup/RepCounterRing";
import { SequenceProgress } from "@/warmup/SequenceProgress";
import { encouragement, goalText, rowsFromResults, rowsFromSaved } from "@/warmup/goals";
import { RestScreen } from "@/warmup/RestScreen";
import {
  historiesBefore,
  useSaveWarmupResults,
  useSessionWarmup,
  useWarmupHistories,
} from "@/warmup/warmupApi";
import { WarmupResultsTable } from "@/warmup/WarmupResultsTable";

const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;
const FEEDBACK_SHOW_MS = 3000;
// Three more attempts after a failure, 1, 2 and 4 seconds apart.
const SAVE_RETRIES = 3;

const EXERCISE_ICONS = {
  shoulder_flexion: MoveUpRight,
  shoulder_abduction: Move,
  elbow_flexion: Dumbbell,
  forward_reach: MoveRight,
  hand_open_close: Hand,
  thumb_opposition: Pointer,
} as const satisfies Record<ExerciseId, unknown>;

interface ExerciseStepProps {
  exercise: ExerciseDefinition;
  preset: ThresholdPreset;
  /** This exercise's earlier results, newest first, for a personal target. */
  history: readonly WarmupHistoryEntry[];
  /** After switching to the easier preset, there is no need to read the instructions again. */
  startAtCountdown: boolean;
  affectedSide: Side;
  visionResult: VisionResult | null;
  voiceOn: boolean;
  onEasier: (startAtCountdown: boolean) => void;
  onResult: (result: ExerciseResult) => void;
  /** `rest` is true after a finished exercise, and false after skipping one. */
  onNext: (rest: boolean) => void;
}

function ExerciseStep({
  exercise,
  preset,
  history,
  startAtCountdown,
  affectedSide,
  visionResult,
  voiceOn,
  onEasier,
  onResult,
  onNext,
}: ExerciseStepProps) {
  const [runner] = useState(() => new ExerciseRunner(exercise, preset, { history }));
  const [stage, setStage] = useState(runner.state);
  const [fullReps, setFullReps] = useState(0);
  const [sequenceStep, setSequenceStep] = useState(0);
  const [posture, setPosture] = useState<PostureStatus>("waiting");
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [best, setBest] = useState<number | null>(null);
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [feedback, setFeedback] = useState<{ key: TranslationKey; id: number } | null>(null);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const pausedForDialog = useRef(false);
  const feedbackId = useRef(0);
  const lastPlaneFeedbackAt = useRef(-Infinity);
  const { direction, targetReps } = exercise;
  const isSequence = exercise.counter === "sequence";
  const thresholds = runner.currentThresholds;
  const personalisation = runner.currentPersonalisation;
  const bestOf = direction === "up" ? Math.max : Math.min;
  // The goal sentence already gives the numbers; only a limit needs saying as well.
  const limitText = personalisation?.limit
    ? reasonTexts(personalisation)
        .slice(1)
        .map(({ key, params }) => t(key, params))
        .join(" ")
    : null;

  const onFrame = useCallback(
    (state: JointAngleState) => {
      const frame = frameForExercise(exercise, state);
      runner.update(frame);
      const { value } = frame;
      if (value !== null && runner.state === "ACTIVE" && !runner.awaitingRest) {
        setBest((current) => (current === null ? value : bestOf(current, value)));
      }
      setSequenceStep(runner.sequenceStep ?? 0);
      const { baseline } = runner.compensation;
      setPosture(baseline === null ? "waiting" : runner.isCompensating ? "check" : "good");
    },
    [runner, exercise, bestOf],
  );
  const angles = useJointAngles(onFrame);

  useEffect(() => {
    const showFeedback = (item: ExerciseFeedback) => {
      const now = performance.now();
      if (item === "forward" || item === "sideways") lastPlaneFeedbackAt.current = now;
      // A rep sends its plane advice just before "good"; the advice is the more useful.
      else if (item === "good" && now - lastPlaneFeedbackAt.current < 100) return;
      feedbackId.current += 1;
      setFeedback({ key: exerciseFeedbackKey(item, exercise), id: feedbackId.current });
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
          else onNext(false);
        }
      } else if (event.type === "repCompleted") {
        setFullReps(runner.fullReps);
        playTick();
        if (voiceOn) speak(t("warmup.counterCurrent", { current: runner.fullReps }), getLanguage());
      } else if (event.type === "feedback") {
        showFeedback(event.feedback);
      }
    });
  }, [runner, exercise, voiceOn, onResult, onNext]);

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
    speak(exercise.instructionKeys.map((key) => t(key)).join(" "), getLanguage());
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

  const easierLink = preset !== "gentle" && (
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
        <p className="text-primary text-xl font-bold">
          {goalText(exercise, targetOf(exercise, thresholds), personalisation)}
        </p>
        {limitText && <p className="text-muted">{limitText}</p>}
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
        <DemoFigure demo={exercise.demo} affectedSide={affectedSide} />
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
        <Button size="lg" onClick={() => onNext(true)}>
          {t("warmup.next")}
        </Button>
      </Card>
    );
  }

  const value = angles ? displayValue(exercise, angles) : null;
  const trackingLost = stage === "PAUSED" && !runner.pausedByUser;
  const userPaused = stage === "PAUSED" && runner.pausedByUser;
  let feedbackLine: string | null = feedback && t(feedback.key);
  if (!feedbackLine && stage === "ACTIVE" && runner.awaitingRest) {
    feedbackLine = t(exerciseWaitingKey(exercise));
  }
  if (userPaused) feedbackLine = t("warmup.paused");

  return (
    <div className="mx-auto grid w-full max-w-[1700px] flex-1 items-start gap-4 lg:grid-cols-12">
      <div className="relative lg:col-span-7">
        <SkeletonCanvas
          result={visionResult}
          highlightSide={affectedSide}
          trunkWarning={stage === "ACTIVE" && posture === "check"}
        />
        {trackingLost && (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/70 p-6 text-center text-2xl font-bold text-white"
          >
            {t(trackingLostKey(exercise))}
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
              {isSequence ? (
                <SequenceProgress step={sequenceStep} />
              ) : (
                <AngleGauge
                  value={value}
                  best={best}
                  thresholds={thresholds}
                  range={exercise.gauge}
                  unit={exercise.unit}
                />
              )}
            </div>
            {stage === "ACTIVE" && <PostureIndicator status={posture} />}
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

interface WarmupRunProps {
  affectedSide: Side;
  /** The programme's exercises, in the warm-up's order. */
  order: readonly ExerciseId[];
  /** The preset the programme forces ("gentle"), or null for the patient's usual targets. */
  forcedPreset: ThresholdPreset | null;
  /** Where to begin: the first exercise not yet done, after a refresh or a return. */
  startPosition: number;
  histories: Record<ExerciseId, WarmupHistoryEntry[]>;
  onResult: (result: ExerciseResult) => void;
  onFinished: () => void;
}

function WarmupRun({
  affectedSide,
  order,
  forcedPreset,
  startPosition,
  histories,
  onResult,
  onFinished,
}: WarmupRunProps) {
  const { status, result, retry } = useVision();
  const [position, setPosition] = useState(startPosition);
  const [presets, setPresets] = useState<Partial<Record<ExerciseId, ThresholdPreset>>>({});
  const [startAtCountdown, setStartAtCountdown] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(() => canSpeak(getLanguage()));
  const [resting, setResting] = useState(false);

  const id = order[position];
  // Personal by default: with no history it falls back to the standard preset by itself. The
  // programme may force the gentle one.
  const preset = forcedPreset ?? presets[id] ?? "personal";

  useEffect(() => stopSpeaking, []);
  useEffect(() => onVoicesChanged(() => setVoiceAvailable(canSpeak(getLanguage()))), []);
  useEffect(() => () => setMuted(false), []);

  const handleNext = useCallback(
    (rest: boolean) => {
      setStartAtCountdown(false);
      if (position + 1 >= order.length) onFinished();
      else if (rest) setResting(true);
      else setPosition(position + 1);
    },
    [position, onFinished, order.length],
  );
  const endRest = useCallback(() => {
    setResting(false);
    setPosition((current) => current + 1);
  }, []);

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
          {t("warmup.progress", { current: position + 1, total: order.length })}
        </p>
        {voiceAvailable && (
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
      {resting ? (
        <RestScreen nextName={t(EXERCISES[order[position + 1]].nameKey)} onDone={endRest} />
      ) : (
        <ExerciseStep
          key={`${id}-${preset}`}
          exercise={EXERCISES[id]}
          preset={preset}
          history={histories[id]}
          startAtCountdown={startAtCountdown}
          affectedSide={affectedSide}
          visionResult={result}
          voiceOn={voiceOn}
          onEasier={(fromActive) => {
            setStartAtCountdown(fromActive);
            setPresets((current) => ({ ...current, [id]: "gentle" }));
          }}
          onResult={onResult}
          onNext={handleNext}
        />
      )}
    </div>
  );
}

/** Exercises done in this tab or saved before a refresh, in the warm-up's order. */
function doneExercises(inMemory: readonly ExerciseResult[], saved: readonly WarmupResult[]) {
  return new Set<ExerciseId>([
    ...inMemory.map((result) => result.exerciseId),
    ...saved.map((result) => result.exercise_id),
  ]);
}

export function SessionWarmupPage() {
  useSessionStep("warmup");
  const { sessionId } = useSession();
  const saved = useSessionWarmup(sessionId);
  const programme = usePatientProgramme();

  if ((saved.isPending && sessionId !== null) || programme.isPending) {
    return (
      <div className="m-auto">
        <Spinner size={48} />
      </div>
    );
  }
  // Without the saved results the warm-up simply starts from the first exercise; without the
  // programme, it has every exercise and the usual targets.
  return <Warmup saved={saved.data ?? []} programme={programme.data ?? null} />;
}

function Warmup({
  saved,
  programme,
}: {
  saved: readonly WarmupResult[];
  programme: PatientProgramme | null;
}) {
  // Fixed on arrival, so a programme changed during the warm-up does not move it.
  const [order] = useState(() => warmupOrder(EXERCISE_ORDER, programme));
  const [forcedPreset] = useState(() => forcedWarmupPreset(programme));
  const navigate = useNavigate();
  const { user } = useAuth();
  const { sessionId, warmupResults, addWarmupResult } = useSession();
  const historyQueries = useWarmupHistories();
  // Fixed at the start, so a result saved during the warm-up does not move later targets.
  const [histories, setHistories] = useState<Record<ExerciseId, WarmupHistoryEntry[]> | null>(null);
  // A quiet save after each exercise, so little is lost if the page closes part way.
  const { mutate: saveResults } = useSaveWarmupResults();
  // The save the summary reports on, with retries.
  const finalSave = useSaveWarmupResults({ retries: SAVE_RETRIES });
  const { mutate: saveFinal } = finalSave;
  const savedOnOpen = useRef(false);
  const handleResult = useCallback(
    (result: ExerciseResult) => {
      addWarmupResult(result);
      if (sessionId === null) return;
      // Everything so far: saving replaces earlier rows, so an earlier failure is retried too.
      const all = [
        ...warmupResults.filter((item) => item.exerciseId !== result.exerciseId),
        result,
      ];
      saveResults({ sessionId, results: all });
    },
    [addWarmupResult, sessionId, warmupResults, saveResults],
  );
  const affectedSide = user?.patient_profile?.affected_side;
  // Fixed on arrival, like the histories, so finishing an exercise does not move the start.
  const [startId] = useState(() => firstUnfinished(order, doneExercises(warmupResults, saved)));
  const startPosition = startId === null ? 0 : order.indexOf(startId);
  const [phase, setPhase] = useState<"overview" | "running" | "complete">(
    startId === null ? "complete" : "overview",
  );
  const handleFinished = useCallback(() => setPhase("complete"), []);

  useEffect(() => {
    if (phase !== "complete" || savedOnOpen.current) return;
    if (sessionId === null || warmupResults.length === 0) return;
    savedOnOpen.current = true;
    saveFinal({ sessionId, results: warmupResults });
  }, [phase, sessionId, warmupResults, saveFinal]);

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
          {order.map((id) => {
            const Icon = EXERCISE_ICONS[id];
            return (
              <li key={id} className="flex items-center gap-3 font-medium">
                <Icon size={28} aria-hidden className="text-primary shrink-0" />
                {t(EXERCISES[id].nameKey)}
              </li>
            );
          })}
        </ul>
        {startPosition > 0 && startId && (
          <p className="text-primary font-semibold">
            {t("warmup.resumeFrom", { name: t(EXERCISES[startId].nameKey) })}
          </p>
        )}
        <Button
          size="lg"
          loading={historyQueries.isPending}
          onClick={() => {
            prepareAudio();
            setHistories(historiesBefore(historyQueries.histories, sessionId));
            setPhase("running");
          }}
        >
          {t(startPosition > 0 ? "warmup.resumeButton" : "calibrate.intro.start")}
        </Button>
      </Card>
    );
  }

  if (phase === "running") {
    return (
      <WarmupRun
        affectedSide={affectedSide}
        order={order}
        forcedPreset={forcedPreset}
        startPosition={startPosition}
        histories={histories ?? historyQueries.histories}
        onResult={handleResult}
        onFinished={handleFinished}
      />
    );
  }

  const earlier = histories ?? historiesBefore(historyQueries.histories, sessionId);
  const previous = Object.fromEntries(EXERCISE_ORDER.map((id) => [id, earlier[id][0]]));
  // Done in this tab where possible, for the change since last time; saved before a refresh
  // otherwise.
  const rows = EXERCISE_ORDER.flatMap((id) => {
    const inMemory = warmupResults.filter((result) => result.exerciseId === id);
    if (inMemory.length > 0) return rowsFromResults(inMemory, previous);
    return rowsFromSaved(saved.filter((result) => result.exercise_id === id));
  });
  const cheer = encouragement(rows);

  return (
    <Card className="m-auto flex w-full max-w-6xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("warmup.complete.title")}</h1>
      <p className="text-primary text-xl font-semibold">{t(cheer.key, cheer.params)}</p>
      <WarmupResultsTable rows={rows} showChange />
      <div aria-live="polite" className="flex min-h-11 flex-wrap items-center gap-3">
        {finalSave.isPending && (
          <p className="text-muted">
            {t(finalSave.failureCount > 0 ? "warmup.saveRetrying" : "warmup.saving")}
          </p>
        )}
        {finalSave.isSuccess && (
          <p className="text-success inline-flex items-center gap-1 font-semibold">
            <Check size={20} aria-hidden />
            {t("warmup.saved")}
          </p>
        )}
        {finalSave.isError && sessionId !== null && (
          <>
            <p>{t("warmup.saveFailed")}</p>
            <Button
              variant="secondary"
              onClick={() => saveFinal({ sessionId, results: warmupResults })}
            >
              {t("warmup.saveTryAgain")}
            </Button>
          </>
        )}
      </div>
      <Button size="lg" onClick={() => void navigate("/session/plan")}>
        {t("warmup.complete.continue")}
      </Button>
    </Card>
  );
}
