import clsx from "clsx";
import { CircleCheck, CircleX, Cpu, Hand, Plug, ShieldAlert } from "lucide-react";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { downsample, evaluateAttempt, restResult, thresholdMv } from "@/emg/calibration";
import type { EmgEngine } from "@/emg/engine";
import {
  batteryOk,
  canLeaveSafety,
  type EmgSite,
  flowReducer,
  type FlowState,
  INITIAL_FLOW,
  qualityOf,
  readinessRecord,
  type SafetyAnswers,
  type Stage,
  STAGES,
} from "@/emg/emgFlow";
import { useEmgEngine, useEmgStatus } from "@/emg/EmgProvider";
import { EMG_ERROR_KEYS } from "@/emg/messages";
import { windowStats } from "@/emg/processing";
import {
  type CheckResult,
  evaluateReadiness,
  evaluateSqueeze,
  gatherReadiness,
  GreenLatch,
  isSensorReady,
  steadyChecksGreen,
} from "@/emg/readiness";
import { CALIBRATION, READINESS } from "@/emg/readinessConfig";
import { isWebSerialSupported } from "@/emg/serial";
import { isSimulatedEmgAllowed } from "@/emg/simulated";
import { defaultEmgSite, usePatientProgramme } from "@/features/programme/patientProgramme";
import { EmgError } from "@/emg/stream";
import { ElectrodeDiagram } from "@/features/emg/ElectrodeDiagram";
import { EmgTrace } from "@/features/emg/EmgTrace";
import { useSession, useSessionStep } from "@/features/session/SessionContext";
import { t, type TranslationKey } from "@/i18n";
import { api } from "@/lib/api";
import { playBeep, playTick } from "@/lib/beep";
import { formatNumber } from "@/lib/format";
import type { DeviceInfo, EmgCalibrationCreate, EmgCalibrationRead } from "@/types/api";

const STAGE_KEYS: Record<Stage, TranslationKey> = {
  safety: "emgStep.stage.safety",
  check: "emgStep.stage.check",
  calibrate: "emgStep.stage.calibrate",
  summary: "emgStep.stage.summary",
};

const SAFETY_KEYS: Record<keyof SafetyAnswers, TranslationKey> = {
  chargerUnplugged: "emgStep.safety.charger",
  batteriesFresh: "emgStep.safety.batteries",
  electrodesOn: "emgStep.safety.electrodes",
};

/** Re-renders every `ms` while `active`, for countdowns. */
function useTicker(active: boolean, ms = 200): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return now;
}

function StageProgress({ stage }: { stage: Stage }) {
  const current = STAGES.indexOf(stage);
  return (
    <ol aria-label={t("emgStep.progress")} className="flex flex-wrap gap-2">
      {STAGES.map((item, index) => (
        <li
          key={item}
          aria-current={index === current ? "step" : undefined}
          className={clsx(
            "rounded-full px-3 py-1 text-sm font-semibold",
            index < current && "bg-success/30",
            index === current && "bg-white text-ink",
            index > current && "bg-white/10",
          )}
        >
          {index + 1}. {t(STAGE_KEYS[item])}
        </li>
      ))}
    </ol>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card
      className={clsx("bg-white/5 text-white", className)}
      style={{ borderColor: "rgba(255,255,255,0.15)" }}
    >
      {children}
    </Card>
  );
}

// Stage A

function SafetyStage({
  state,
  dispatch,
  simulatedAllowed,
}: {
  state: FlowState;
  dispatch: (action: Parameters<typeof flowReducer>[1]) => void;
  simulatedAllowed: boolean;
}) {
  const sites: { site: EmgSite; title: TranslationKey; text: TranslationKey }[] = [
    { site: "flexors", title: "emgStep.site.flexors", text: "emgStep.site.flexors.text" },
    { site: "extensors", title: "emgStep.site.extensors", text: "emgStep.site.extensors.text" },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <ShieldAlert size={24} aria-hidden className="text-accent" />
          {t("emgStep.safety.title")}
        </h2>
        <p className="font-semibold">{t("emgStep.safety.rule")}</p>
        {(Object.keys(SAFETY_KEYS) as (keyof SafetyAnswers)[]).map((key) => (
          <label key={key} className="flex min-h-11 items-center gap-3 text-lg">
            <input
              type="checkbox"
              className="size-6"
              checked={state.safety[key]}
              onChange={(event) =>
                dispatch({ type: "answerSafety", key, value: event.target.checked })
              }
            />
            {t(SAFETY_KEYS[key])}
          </label>
        ))}
      </Panel>
      <Panel className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-xl font-bold">{t("emgStep.site.title")}</legend>
          {sites.map(({ site, title, text }) => (
            <label
              key={site}
              className={clsx(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
                state.site === site ? "border-white bg-white/10" : "border-white/20",
              )}
            >
              <input
                type="radio"
                name="emg-site"
                className="mt-1 size-5"
                checked={state.site === site}
                onChange={() => dispatch({ type: "chooseSite", site })}
              />
              <span>
                <span className="block font-semibold">{t(title)}</span>
                <span className="text-sm opacity-80">{t(text)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {state.site && <ElectrodeDiagram site={state.site} />}
      </Panel>
      <div className="flex flex-wrap gap-3 lg:col-span-2">
        <Button
          size="lg"
          disabled={!canLeaveSafety(state)}
          onClick={() => dispatch({ type: "continueToCheck" })}
        >
          {t("emgStep.continue")}
        </Button>
        {simulatedAllowed && (
          <Button
            variant="secondary"
            disabled={state.site === null}
            onClick={() => dispatch({ type: "continueToCheck", simulated: true })}
          >
            {t("emgStep.useSimulated")}
          </Button>
        )}
        {!canLeaveSafety(state) && (
          <p className="self-center opacity-80">{t("emgStep.safety.needed")}</p>
        )}
      </div>
    </div>
  );
}

// Stage B

function Checklist({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((check, index) => (
        <li key={check.id} className="flex flex-col">
          <span className="flex items-center gap-3 font-medium">
            {check.pass ? (
              <CircleCheck
                size={24}
                aria-label={t("setup.check.passed")}
                className="text-success shrink-0"
              />
            ) : (
              <CircleX
                size={24}
                aria-label={t("setup.check.notPassed")}
                className="shrink-0 text-red-400"
              />
            )}
            <span>
              {index + 1}. {t(check.labelKey)}
            </span>
            {check.value && (
              <span className="ml-auto font-mono text-sm opacity-80">{check.value}</span>
            )}
          </span>
          {!check.pass && <span className="ml-9 text-sm text-amber-200">{t(check.hintKey)}</span>}
        </li>
      ))}
    </ul>
  );
}

function CheckStage({
  state,
  dispatch,
  engine,
  simulatedAllowed,
}: {
  state: FlowState;
  dispatch: (action: Parameters<typeof flowReducer>[1]) => void;
  engine: EmgEngine;
  simulatedAllowed: boolean;
}) {
  const status = useEmgStatus();
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [latched, setLatched] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [squeezeUntil, setSqueezeUntil] = useState<number | null>(null);
  const latch = useRef(new GreenLatch());
  const relaxedBefore = useRef<{ mean: number; sd: number } | null>(null);
  const simulated = state.source === "simulated" || engine.sourceKind === "simulated";
  const webSerial = isWebSerialSupported();
  const now = useTicker(squeezeUntil !== null);

  // The checklist, four times a second.
  useEffect(() => {
    const timer = setInterval(() => {
      const time = performance.now();
      const results = evaluateReadiness(
        gatherReadiness(engine, engine.getStatus(), {
          simulated,
          webSerialSupported: webSerial,
          now: time,
          squeeze: state.squeeze,
        }),
      );
      setChecks(results);
      setLatched(latch.current.update(steadyChecksGreen(results), time));
    }, 250);
    return () => clearInterval(timer);
  }, [engine, simulated, webSerial, state.squeeze]);

  // The test squeeze: 2 s, then judged against the relaxed level just before it.
  useEffect(() => {
    if (squeezeUntil === null) return undefined;
    const timer = setTimeout(
      () => {
        const signal = engine.recent(READINESS.squeezeMs / 1000);
        const relaxed = relaxedBefore.current ?? { mean: 0, sd: 0 };
        dispatch({
          type: "squeezeTested",
          result: evaluateSqueeze(signal.t, signal.envelope, relaxed),
        });
        setSqueezeUntil(null);
      },
      Math.max(0, squeezeUntil - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [squeezeUntil, engine, dispatch]);

  async function connect(kind: "serial" | "simulated") {
    setError(null);
    // The safety answers were skipped for the simulated sensor: a real one needs them first.
    if (kind === "serial" && !canLeaveSafety(state)) {
      dispatch({ type: "back" });
      return;
    }
    try {
      if (kind === "serial") await engine.connectSerial();
      else await engine.connectSimulated();
      dispatch({ type: "connected", source: kind });
    } catch (failure) {
      setError(EMG_ERROR_KEYS[failure instanceof EmgError ? failure.code : "open_failed"]);
    }
  }

  function startSqueeze() {
    const before = engine.recent(READINESS.relaxedWindowMs / 1000).envelope;
    const stats = windowStats(before);
    relaxedBefore.current = { mean: stats.mean, sd: stats.sd };
    setSqueezeUntil(performance.now() + READINESS.squeezeMs);
  }

  const ready = isSensorReady(latched, state.squeeze?.pass === true);
  const squeezing = squeezeUntil !== null;
  const site = state.site ?? "flexors";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel className="flex flex-col gap-3 lg:col-span-2">
        <div className="flex flex-wrap gap-3">
          {!status.connected && state.source !== "simulated" && (
            <Button size="lg" disabled={!webSerial} onClick={() => void connect("serial")}>
              <Plug size={20} aria-hidden />
              {t("emgStep.connect")}
            </Button>
          )}
          {!status.connected && simulatedAllowed && (
            <Button variant="secondary" onClick={() => void connect("simulated")}>
              <Cpu size={20} aria-hidden />
              {t("emgStep.useSimulated")}
            </Button>
          )}
          {status.connected && !checks.find((check) => check.id === "responding")?.pass && (
            <Button variant="secondary" onClick={() => void engine.ping()}>
              {t("emgStep.pingAgain")}
            </Button>
          )}
        </div>
        {!webSerial && !simulated && (
          <p className="text-amber-200">{t("emg.error.notSupported")}</p>
        )}
        {error && (
          <p role="alert" className="text-amber-200">
            {t(error)}
          </p>
        )}
        <EmgTrace engine={engine} seconds={5} />
        {simulated && status.connected && (
          <p className="text-sm opacity-80">{t("emgStep.simulatedHint")}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={!status.streaming || squeezing}
            onClick={startSqueeze}
          >
            <Hand size={20} aria-hidden />
            {t("emgStep.testSqueeze")}
          </Button>
          {squeezing && (
            <p role="status" className="text-lg font-semibold">
              {t(site === "flexors" ? "emgStep.squeezeNow" : "emgStep.openNow", {
                seconds: Math.max(1, Math.ceil(((squeezeUntil ?? now) - now) / 1000)),
              })}
            </p>
          )}
        </div>
      </Panel>
      <Panel className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">{t("emgStep.check.title")}</h2>
        <Checklist checks={checks} />
        <p
          role="status"
          className={clsx(
            "rounded-full px-4 py-2 text-center font-bold",
            ready ? "bg-success text-white" : "bg-white/10",
          )}
        >
          {t(ready ? "emgStep.ready" : latched ? "emgStep.readyAfterSqueeze" : "emgStep.notReady")}
        </p>
        <Button
          size="lg"
          disabled={!ready}
          onClick={() => dispatch({ type: "ready", readiness: checks })}
        >
          {t("emgStep.toCalibration")}
        </Button>
      </Panel>
    </div>
  );
}

// Stage C

function CalibrateStage({
  state,
  dispatch,
  engine,
}: {
  state: FlowState;
  dispatch: (action: Parameters<typeof flowReducer>[1]) => void;
  engine: EmgEngine;
}) {
  const { phase } = state;
  const timed =
    phase.kind === "rest" ||
    phase.kind === "countdown" ||
    phase.kind === "effort" ||
    phase.kind === "pause";
  const now = useTicker(timed);
  const pauseMs = import.meta.env.DEV ? CALIBRATION.pauseMsDevelopment : CALIBRATION.pauseMs;
  const lastTick = useRef<number | null>(null);
  const site = state.site ?? "flexors";
  const attemptNumber = state.attempts.length + 1;
  const totalAttempts = CALIBRATION.attempts + (state.extraUsed ? 1 : 0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (phase.kind === "rest") {
      timer = setTimeout(
        () => {
          dispatch({
            type: "restDone",
            result: restResult(engine.recent(CALIBRATION.restMs / 1000).envelope),
          });
        },
        Math.max(0, phase.startedAt + CALIBRATION.restMs - performance.now()),
      );
    } else if (phase.kind === "countdown") {
      timer = setTimeout(
        () => {
          playBeep();
          dispatch({ type: "countdownDone", now: performance.now() });
        },
        Math.max(0, phase.startedAt + CALIBRATION.countdownMs - performance.now()),
      );
    } else if (phase.kind === "effort") {
      timer = setTimeout(
        () => {
          const signal = engine.recent(CALIBRATION.effortMs / 1000);
          dispatch({
            type: "attemptDone",
            result: evaluateAttempt(signal.mv, signal.envelope, engine.sampleRateHz),
            trace: downsample(signal.envelope),
            now: performance.now(),
            pauseMs,
          });
        },
        Math.max(0, phase.startedAt + CALIBRATION.effortMs - performance.now()),
      );
    } else if (phase.kind === "pause") {
      timer = setTimeout(
        () => dispatch({ type: "pauseDone" }),
        Math.max(0, phase.until - performance.now()),
      );
    }
    return () => clearTimeout(timer);
  }, [phase, engine, dispatch, pauseMs]);

  // 3, 2, 1: a tick each second of the countdown.
  const countdownLeft =
    phase.kind === "countdown"
      ? Math.ceil((phase.startedAt + CALIBRATION.countdownMs - now) / 1000)
      : null;
  useEffect(() => {
    if (countdownLeft === null || countdownLeft < 1) return;
    if (lastTick.current !== countdownLeft) {
      lastTick.current = countdownLeft;
      playTick();
    }
  }, [countdownLeft]);

  const secondsLeft = (end: number) => Math.max(0, Math.ceil((end - now) / 1000));
  const effortText = t(site === "flexors" ? "emgStep.cal.squeeze" : "emgStep.cal.open");

  let content: ReactNode = null;
  switch (phase.kind) {
    case "restReady":
      content = (
        <>
          <p className="text-2xl font-semibold">{t("emgStep.cal.relax")}</p>
          <p className="opacity-80">{t("emgStep.cal.relaxHint")}</p>
          <Button size="lg" onClick={() => dispatch({ type: "startRest", now: performance.now() })}>
            {t("emgStep.cal.startRest")}
          </Button>
        </>
      );
      break;
    case "rest":
      content = (
        <p role="status" className="text-2xl font-semibold">
          {t("emgStep.cal.relaxing", {
            seconds: secondsLeft(phase.startedAt + CALIBRATION.restMs),
          })}
        </p>
      );
      break;
    case "restFailed":
      content = (
        <>
          <p role="alert" className="text-xl font-semibold text-amber-200">
            {t(
              phase.problem === "electrodeOff"
                ? "emgStep.cal.restElectrodeOff"
                : "emgStep.cal.restUnstable",
            )}
          </p>
          <Button size="lg" onClick={() => dispatch({ type: "startRest", now: performance.now() })}>
            {t("emgStep.cal.repeatRest")}
          </Button>
        </>
      );
      break;
    case "attemptReady":
    case "attemptSaturated":
      content = (
        <>
          {phase.kind === "attemptSaturated" && (
            <p role="alert" className="text-xl font-semibold text-amber-200">
              {t("emgStep.cal.saturated")}
            </p>
          )}
          <p className="text-2xl font-semibold">
            {t("emgStep.cal.attempt", { number: attemptNumber, total: totalAttempts })}:{" "}
            {effortText}
          </p>
          <Button
            size="lg"
            onClick={() => dispatch({ type: "startAttempt", now: performance.now() })}
          >
            {t("emgStep.cal.startAttempt")}
          </Button>
        </>
      );
      break;
    case "countdown":
      content = (
        <p role="status" className="text-6xl font-bold tabular-nums">
          {Math.max(1, countdownLeft ?? 1)}
        </p>
      );
      break;
    case "effort":
      content = (
        <p role="status" className="text-4xl font-bold">
          {effortText} {secondsLeft(phase.startedAt + CALIBRATION.effortMs)}
        </p>
      );
      break;
    case "pause":
      content = (
        <>
          <p role="status" className="text-2xl font-semibold">
            {t("emgStep.cal.pause", { seconds: secondsLeft(phase.until) })}
          </p>
          <p className="opacity-80">
            {t("emgStep.cal.next", { number: attemptNumber, total: totalAttempts })}
          </p>
          {state.extraUsed && state.attempts.length === CALIBRATION.attempts && (
            <p className="text-amber-200">{t("emgStep.cal.extra")}</p>
          )}
        </>
      );
      break;
    case "weak":
      content = (
        <>
          <p role="alert" className="text-xl font-semibold text-amber-200">
            {t("emgStep.cal.weak")}
          </p>
          <Button size="lg" onClick={() => dispatch({ type: "redoCalibration" })}>
            {t("emgStep.cal.redo")}
          </Button>
        </>
      );
      break;
    case "done":
      break;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel className="flex flex-col gap-3 lg:col-span-2">
        <EmgTrace
          engine={engine}
          seconds={phase.kind === "rest" ? 10 : 5}
          thresholdMv={state.rest ? thresholdMv(state.rest) : null}
          className="h-56 w-full rounded-xl bg-white/5"
        />
      </Panel>
      <Panel className="flex flex-col items-start gap-4">
        <h2 className="text-xl font-bold">{t("emgStep.cal.title")}</h2>
        {content}
        {state.rest && (
          <p className="text-sm opacity-80">
            {t("emgStep.cal.restValue", {
              mean: Math.round(state.rest.mean),
              sd: formatNumber(state.rest.sd, 1),
            })}
          </p>
        )}
        {state.attempts.length > 0 && (
          <p className="text-sm opacity-80">
            {t("emgStep.cal.attemptsValue", {
              values: state.attempts.map((attempt) => Math.round(attempt.peakMv)).join(", "),
            })}
          </p>
        )}
      </Panel>
    </div>
  );
}

// Stage D

function AttemptsPlot({ state }: { state: FlowState }) {
  const traces = state.attempts.map((attempt) => attempt.trace);
  const top = Math.max(1, ...traces.flat()) * 1.1;
  const colors = ["#7fd6cc", "#f4b183", "#c9b6f2", "#f6e27f"];
  return (
    <svg
      viewBox="0 0 300 120"
      className="h-36 w-full rounded-xl bg-white/5"
      role="img"
      aria-label={t("emgStep.summary.plot")}
    >
      {traces.map((trace, index) => (
        <polyline
          key={index}
          fill="none"
          stroke={colors[index % colors.length]}
          strokeWidth="2"
          points={trace
            .map(
              (value, i) =>
                `${(i / Math.max(1, trace.length - 1)) * 300},${120 - (value / top) * 115}`,
            )
            .join(" ")}
        />
      ))}
    </svg>
  );
}

function SummaryStage({
  state,
  dispatch,
  onSave,
  saving,
  error,
}: {
  state: FlowState;
  dispatch: (action: Parameters<typeof flowReducer>[1]) => void;
  onSave: (note: string) => void;
  saving: boolean;
  error: boolean;
}) {
  const [note, setNote] = useState("");
  if (!state.rest || !state.mvc) return null;
  const rows: { key: TranslationKey; value: string }[] = [
    {
      key: "emgStep.summary.rest",
      value: `${Math.round(state.rest.mean)} ± ${formatNumber(state.rest.sd, 1)} mV`,
    },
    { key: "emgStep.summary.mvc", value: `${Math.round(state.mvc.mvc)} mV` },
    { key: "emgStep.summary.threshold", value: `${Math.round(thresholdMv(state.rest))} mV` },
    { key: "emgStep.summary.spread", value: `${Math.round(state.mvc.spread * 100)}%` },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">{t("emgStep.summary.title")}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {rows.map(({ key, value }) => (
            <div key={key} className="contents">
              <dt className="opacity-80">{t(key)}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <AttemptsPlot state={state} />
        <label className="flex flex-col gap-1">
          <span>{t("emgStep.summary.gainNote")}</span>
          <input
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.target.value)}
            className="text-ink min-h-11 rounded-lg px-3"
          />
        </label>
      </Panel>
      <Panel className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">{t("emgStep.summary.checks")}</h2>
        <Checklist checks={state.readiness ?? []} />
        {error && (
          <p role="alert" className="text-amber-200">
            {t("emgStep.summary.saveError")}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button size="lg" loading={saving} onClick={() => onSave(note)}>
            {t("emgStep.summary.save")}
          </Button>
          <Button variant="secondary" onClick={() => dispatch({ type: "redoCalibration" })}>
            {t("emgStep.cal.redo")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/** /session/emg: safety and placement, the sensor check, calibration, and its summary. */
export function SessionEmgPage() {
  useSessionStep("emg");
  const navigate = useNavigate();
  const engine = useEmgEngine();
  const status = useEmgStatus();
  const { sessionId } = useSession();
  const [state, dispatch] = useReducer(flowReducer, INITIAL_FLOW);
  // The therapist's default site, chosen for the patient (who may change it).
  const programme = usePatientProgramme();
  const suggestedSite = defaultEmgSite(programme.data);
  useEffect(() => dispatch({ type: "suggestSite", site: suggestedSite }), [suggestedSite]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const simulatedAllowed = isSimulatedEmgAllowed();

  async function reportDevice(emg: DeviceInfo["emg"]) {
    if (sessionId === null) return;
    await api.patch(`/sessions/${sessionId}/device-info`, { emg }).catch(() => undefined);
  }

  async function skip() {
    await engine.disconnect().catch(() => undefined);
    await reportDevice({ connected: false });
    void navigate("/session/calibrate");
  }

  async function save(note: string) {
    if (!state.rest || !state.mvc || !state.site || sessionId === null) return;
    const source = engine.sourceKind ?? state.source ?? "simulated";
    const payload: EmgCalibrationCreate = {
      site: state.site,
      source,
      firmware_version: status.firmwareVersion,
      sample_rate: engine.sampleRateHz,
      rest_mean_mv: Math.round(state.rest.mean * 100) / 100,
      rest_sd_mv: Math.round(state.rest.sd * 100) / 100,
      mvc_mv: Math.round(state.mvc.mvc * 100) / 100,
      mvc_attempts: state.attempts.map((attempt) => Math.round(attempt.peakMv * 100) / 100),
      readiness: readinessRecord(state.readiness),
      quality: qualityOf(state, engine.arrivalStats(5000).gapsPct),
      battery_ok: batteryOk(state),
      gain_note: note.trim() || null,
    };
    setSaving(true);
    setSaveError(false);
    try {
      await api.post<EmgCalibrationRead>(`/sessions/${sessionId}/emg-calibration`, payload);
      engine.setSite(state.site);
      engine.setCalibration({
        restMean: state.rest.mean,
        restSd: state.rest.sd,
        mvc: state.mvc.mvc,
      });
      await reportDevice({
        connected: true,
        source,
        site: state.site,
        firmware_version: status.firmwareVersion,
      });
      void navigate("/session/calibrate");
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StageProgress stage={state.stage} />
        <div className="flex gap-2">
          {state.stage !== "safety" && (
            <Button
              variant="ghost"
              className="text-white"
              onClick={() => dispatch({ type: "back" })}
            >
              {t("emgStep.back")}
            </Button>
          )}
          <Button variant="ghost" className="text-white" onClick={() => void skip()}>
            {t("emgStep.skip")}
          </Button>
        </div>
      </div>
      {state.stage === "safety" && (
        <SafetyStage state={state} dispatch={dispatch} simulatedAllowed={simulatedAllowed} />
      )}
      {state.stage === "check" && (
        <CheckStage
          state={state}
          dispatch={dispatch}
          engine={engine}
          simulatedAllowed={simulatedAllowed}
        />
      )}
      {state.stage === "calibrate" && (
        <CalibrateStage state={state} dispatch={dispatch} engine={engine} />
      )}
      {state.stage === "summary" && (
        <SummaryStage
          state={state}
          dispatch={dispatch}
          onSave={(note) => void save(note)}
          saving={saving}
          error={saveError}
        />
      )}
    </div>
  );
}
