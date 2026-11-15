// A developer tool that never reaches the production build (the route exists only when
// import.meta.env.DEV is true). Plain English rather than t(), like the other lab pages. It never
// calls the server's API: the recording goes to the development server's save endpoint, or is
// downloaded.
import clsx from "clsx";
import {
  Armchair,
  ArrowRight,
  CircleCheck,
  CircleX,
  Hand,
  HandGrab,
  MoveHorizontal,
  MoveUp,
  PersonStanding,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { playBeep, prepareAudio } from "@/lib/beep";
import { speak, stopSpeaking } from "@/lib/speech";
import {
  averageFps,
  fitRecording,
  LandmarkRecorder,
  type LandmarkRecording,
  recordingBytes,
  serialiseRecording,
} from "@/testing/landmarkFormat";
import { isTestMode } from "@/testing/testMode";
import type { Side } from "@/types/api";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { useVision } from "@/vision/useVision";
import { visionEngine } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";

import {
  allChecksPass,
  armAndHandVisible,
  evaluateGuideChecks,
  type GuideChecks,
} from "./guideChecks";
import { GUIDE_STEPS, type GuideIcon } from "./guideSteps";
import { type GuideEvent, GuideSequencer, type GuideView } from "./sequencer";

const SAVE_URL = "/__dev/save-landmarks";
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
/** Frames older than this mean the camera stalled: the arm counts as out of view. */
const STALE_MS = 500;
const TICK_MS = 50;

const ICONS: Record<GuideIcon, LucideIcon> = {
  still: Armchair,
  arrow: ArrowRight,
  raiseForward: MoveUp,
  raiseSideways: MoveHorizontal,
  elbow: RotateCcw,
  hand: Hand,
  thumb: Hand,
  pinch: HandGrab,
  lean: PersonStanding,
};

const FINGER_NAMES = ["index", "middle", "ring", "little"] as const;

interface Summary {
  recording: LandmarkRecording;
  durationS: number;
  frames: number;
  fps: number;
  stepsDone: number;
  bytes: number;
  thinned: boolean;
}

type Stage = "setup" | "running" | "summary";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; file: string }
  | { kind: "exists" }
  | { kind: "error"; message: string };

function CheckRow({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <li className="flex items-start gap-2">
      <Icon
        aria-hidden
        className={clsx("mt-0.5 size-5 shrink-0", ok ? "text-success" : "text-danger")}
      />
      <span>
        {label}: <strong>{ok ? "OK" : "Not yet"}</strong>
        {!ok && hint ? <span className="block text-sm text-muted">{hint}</span> : null}
      </span>
    </li>
  );
}

function Checklist({ checks }: { checks: GuideChecks }) {
  const distanceHint =
    checks.distance === "tooFar"
      ? "Move closer to the camera."
      : checks.distance === "tooClose"
        ? "Move back from the camera."
        : "Show both shoulders.";
  return (
    <ul className="flex flex-col gap-2" aria-live="polite">
      <CheckRow ok={checks.cameraOn} label="Camera on" />
      <CheckRow ok={checks.shouldersVisible} label="Both shoulders visible" />
      <CheckRow
        ok={checks.handVisible}
        label="Affected arm and hand visible"
        hint="Hold your affected hand up where the camera sees it."
      />
      <CheckRow ok={checks.distance === "ok"} label="Good distance" hint={distanceHint} />
      <CheckRow
        ok={checks.enoughLight}
        label="Enough light"
        hint="Turn on a light in front of you."
      />
    </ul>
  );
}

function InstructionPanel({ view }: { view: GuideView }) {
  const step = view.step;
  if (!step) return null;
  const Icon = ICONS[step.icon];
  const beat = view.beat;
  const rotation = beat?.directionDeg !== undefined ? -beat.directionDeg : 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg text-muted">
        Step {view.stepIndex + 1} of {view.stepCount}
      </p>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-muted/20"
        role="progressbar"
        aria-label={`Step ${view.stepIndex + 1} of ${view.stepCount}`}
        aria-valuemin={1}
        aria-valuemax={view.stepCount}
        aria-valuenow={view.stepIndex + 1}
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{
            width: `${((view.stepIndex + (view.phase === "step" ? 0.5 : 0)) / view.stepCount) * 100}%`,
          }}
        />
      </div>
      <h2 className="text-3xl font-bold">{step.name}</h2>
      <div className="flex items-center gap-6">
        <Icon
          aria-hidden
          className="size-28 shrink-0 text-primary"
          style={{ transform: `rotate(${rotation}deg)` }}
        />
        <div className="flex flex-col gap-2">
          {beat ? <p className="text-4xl font-bold">{beat.label}</p> : null}
          {beat?.finger ? (
            <div className="flex gap-2" aria-label="Finger to touch">
              {FINGER_NAMES.map((finger) => (
                <span
                  key={finger}
                  className={clsx(
                    "rounded-lg px-3 py-1 text-lg capitalize",
                    finger === beat.finger ? "bg-accent font-bold text-white" : "bg-muted/15",
                  )}
                >
                  {finger}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <p className="text-xl">{step.instruction}</p>
      <p className="text-7xl font-bold tabular-nums" aria-live="off">
        {view.countdown !== null ? view.countdown : `${view.secondsLeft} s`}
      </p>
      <p className="text-muted">{view.countdown !== null ? "Get ready…" : "Recording"}</p>
      {view.autoPaused ? (
        <p role="alert" className="rounded-lg bg-warning/20 p-3 text-xl font-bold">
          Move back into view
        </p>
      ) : null}
      {view.paused ? <p className="text-xl font-bold">Paused</p> : null}
    </div>
  );
}

/** The finished recording, at most 15 MB (every second frame left out as often as needed). */
function buildSummary(sequencer: GuideSequencer, recorder: LandmarkRecorder): Summary {
  const full = recorder.toRecording(new Date(), sequencer.markers);
  const { recording, halvings } = fitRecording(full, MAX_FILE_BYTES);
  return {
    recording,
    durationS: recorder.durationMs / 1000,
    frames: recording.frames.length,
    fps: averageFps(recorder.frameTimes) / 2 ** halvings,
    stepsDone: sequencer.markers.length,
    bytes: recordingBytes(recording),
    thinned: halvings > 0,
  };
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveToFixtures(
  name: string,
  text: string,
  overwrite: boolean,
): Promise<{ ok: true; file: string } | { ok: false; status: number; message: string }> {
  const query = new URLSearchParams({ name, ...(overwrite ? { overwrite: "1" } : {}) });
  const response = await fetch(`${SAVE_URL}?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Muvi-Dev": "1" },
    body: text,
  });
  const body = (await response.json().catch(() => ({}))) as { file?: string; error?: string };
  if (response.ok && body.file) return { ok: true, file: body.file };
  return { ok: false, status: response.status, message: body.error ?? `Error ${response.status}` };
}

export function RecordGuidePage() {
  const { status, result, retry } = useVision();
  const [side, setSide] = useState<Side>("left");
  const [name, setName] = useState("shadik_full");
  const [stage, setStage] = useState<Stage>("setup");
  const [view, setView] = useState<GuideView | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const sequencerRef = useRef<GuideSequencer | null>(null);
  const recorderRef = useRef<LandmarkRecorder | null>(null);
  const lastVisibleAtRef = useRef(-Infinity);
  const visibleRef = useRef(false);

  const checks = evaluateGuideChecks(result, side);
  const ready = allChecksPass(checks);
  const nameOk = NAME_PATTERN.test(name);

  // Every frame: whether the arm and hand are in view, and the frame itself while recording.
  useEffect(() => {
    if (stage !== "running") return undefined;
    return visionEngine.subscribe((frame) => {
      visibleRef.current = armAndHandVisible(frame, side);
      lastVisibleAtRef.current = performance.now();
      if (sequencerRef.current?.isRecording) recorderRef.current?.add(frame);
    });
  }, [stage, side]);

  // The step clock.
  useEffect(() => {
    if (stage !== "running") return undefined;
    const handle = (events: GuideEvent[]) => {
      for (const event of events) {
        if (event.type === "countdown") speak(GUIDE_STEPS[event.stepIndex].voice, "en");
        if (event.type === "stepStart" || event.type === "stepEnd") playBeep();
        if (event.type === "discard") recorderRef.current?.discardFrom(event.fromMs);
        if (event.type === "done") {
          const sequencer = sequencerRef.current;
          const recorder = recorderRef.current;
          if (sequencer && recorder) {
            setSummary(buildSummary(sequencer, recorder));
            setStage("summary");
          }
        }
      }
    };
    const timer = setInterval(() => {
      const sequencer = sequencerRef.current;
      if (!sequencer) return;
      const now = performance.now();
      const fresh = now - lastVisibleAtRef.current < STALE_MS;
      handle(sequencer.tick(now, fresh && visibleRef.current));
      setView(sequencer.view());
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [stage]);

  useEffect(() => () => stopSpeaking(), []);

  const start = () => {
    prepareAudio();
    const sequencer = new GuideSequencer(GUIDE_STEPS);
    const now = performance.now();
    recorderRef.current = new LandmarkRecorder(now);
    sequencerRef.current = sequencer;
    const events = sequencer.start(now);
    if (events.some((event) => event.type === "countdown")) speak(GUIDE_STEPS[0].voice, "en");
    setView(sequencer.view());
    setSummary(null);
    setSave({ kind: "idle" });
    setStage("running");
  };

  const cancel = () => {
    stopSpeaking();
    sequencerRef.current?.cancel();
    sequencerRef.current = null;
    recorderRef.current = null;
    setView(null);
    setStage("setup");
  };

  const runSave = async (overwrite: boolean) => {
    if (!summary) return;
    setSave({ kind: "saving" });
    try {
      const saved = await saveToFixtures(name, serialiseRecording(summary.recording), overwrite);
      if (saved.ok) setSave({ kind: "saved", file: saved.file });
      else if (saved.status === 409) setSave({ kind: "exists" });
      else setSave({ kind: "error", message: saved.message });
    } catch {
      setSave({ kind: "error", message: "The development server did not answer." });
    }
  };

  const replayUrl = `/dev/exercise-lab?replay=${encodeURIComponent(name)}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1800px] flex-col gap-4 p-4">
      <header>
        <h1 className="text-2xl font-bold">Guided landmark recording</h1>
        <p className="text-muted">
          Development only. Records landmarks (never the image) for the automated tests. Nothing is
          sent to the server.
        </p>
      </header>
      <div className="grid flex-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          {status.phase === "running" ? (
            // Mirrored, so moving right moves right on screen.
            <div className="-scale-x-100">
              <SkeletonCanvas result={result} highlightSide={side} />
            </div>
          ) : (
            <VisionStatusCard status={status} retry={retry} />
          )}
          <p className="text-sm text-muted">{Math.round(result?.fps ?? 0)} frames a second</p>
        </div>

        <Card className="flex flex-col gap-4 p-6">
          {stage === "setup" ? (
            <>
              <h2 className="text-2xl font-bold">Before you start</h2>
              <Checklist checks={checks} />
              <label className="flex flex-col gap-1">
                File name
                <input
                  className="rounded border border-muted px-2 py-1 text-lg"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={!nameOk}
                />
                {!nameOk ? (
                  <span className="text-sm text-danger">Letters, digits, - or _ only.</span>
                ) : null}
              </label>
              <fieldset className="flex gap-4">
                <legend className="mb-1">Affected side</legend>
                {(["left", "right"] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 capitalize">
                    <input
                      type="radio"
                      name="side"
                      value={value}
                      checked={side === value}
                      onChange={() => setSide(value)}
                    />
                    {value}
                  </label>
                ))}
              </fieldset>
              <Button size="lg" disabled={!ready || !nameOk} onClick={start}>
                Start recording
              </Button>
              {!ready ? (
                <p className="text-sm text-muted">Every check must be green to start.</p>
              ) : null}
              <p className="text-sm text-muted">
                10 steps, about 3 minutes. Each step starts with 3-2-1 and a beep, and ends with a
                beep.
              </p>
            </>
          ) : null}

          {stage === "running" && view ? (
            <>
              <InstructionPanel view={view} />
              <div className="flex flex-wrap gap-2">
                {view.paused ? (
                  <Button
                    onClick={() => {
                      sequencerRef.current?.resume(performance.now());
                      setView(sequencerRef.current?.view() ?? null);
                    }}
                  >
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      sequencerRef.current?.pause();
                      stopSpeaking();
                      setView(sequencerRef.current?.view() ?? null);
                    }}
                  >
                    Pause
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    const sequencer = sequencerRef.current;
                    if (!sequencer) return;
                    for (const event of sequencer.repeatStep(performance.now())) {
                      if (event.type === "discard") recorderRef.current?.discardFrom(event.fromMs);
                      if (event.type === "countdown") {
                        speak(GUIDE_STEPS[event.stepIndex].voice, "en");
                      }
                    }
                    setView(sequencer.view());
                  }}
                >
                  Repeat this step
                </Button>
                <Button variant="danger" onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </>
          ) : null}

          {stage === "summary" && summary ? (
            <>
              <h2 className="text-2xl font-bold">Recording finished</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-lg">
                <dt>Duration</dt>
                <dd>{summary.durationS.toFixed(1)} s</dd>
                <dt>Frames</dt>
                <dd>{summary.frames}</dd>
                <dt>Average frame rate</dt>
                <dd>{summary.fps.toFixed(1)} fps</dd>
                <dt>Steps completed</dt>
                <dd>
                  {summary.stepsDone} of {GUIDE_STEPS.length}
                </dd>
                <dt>File size</dt>
                <dd>{(summary.bytes / 1024 / 1024).toFixed(1)} MB</dd>
              </dl>
              {summary.thinned ? (
                <p className="rounded-lg bg-warning/20 p-3">
                  The file would have been over 15 MB, so every second frame was left out.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={save.kind === "saving" || save.kind === "saved"}
                  onClick={() => void runSave(false)}
                >
                  Save
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => download(name, serialiseRecording(summary.recording))}
                >
                  Download instead
                </Button>
                <Button variant="ghost" onClick={() => setStage("setup")}>
                  Record again
                </Button>
              </div>
              {save.kind === "exists" ? (
                <div className="flex flex-wrap items-center gap-2" role="alert">
                  <p>{name}.json already exists.</p>
                  <Button variant="danger" onClick={() => void runSave(true)}>
                    Overwrite
                  </Button>
                </div>
              ) : null}
              {save.kind === "error" ? (
                <p role="alert" className="text-danger">
                  Could not save: {save.message} Use "Download instead".
                </p>
              ) : null}
              {save.kind === "saved" ? (
                <div className="flex flex-col gap-2" role="status">
                  <p>
                    Saved to <code>web/{save.file}</code>.
                  </p>
                  <div>
                    <Button onClick={() => window.open(replayUrl, "_blank", "noopener")}>
                      Test replay
                    </Button>
                  </div>
                  {isTestMode() ? null : (
                    <div className="text-sm">
                      <p>
                        Replay works only in test mode, which is not on now. Stop this dev server,
                        then in PowerShell:
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted/15 p-2">
                        cd web; $env:VITE_TEST_MODE="true"; npm run dev
                      </pre>
                      <p>
                        and open <code>http://localhost:5173{replayUrl}</code>, then click Start
                        camera.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
