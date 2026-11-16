/**
 * /dev/emg-monitor (development builds only; English on purpose): the hardware day's bench.
 * Connect the ESP32 (or the mock board), watch the raw signal and its envelope live for 10 s,
 * the rate, lost samples, saturation, rest SD and %MVC, the nine readiness items, send the
 * firmware's commands, and record the guided 30 s CSV into analysis/emg/recordings/ for
 * analysis/emg/emg_validation.py.
 */

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { useEmgEngine, useEmgStatus } from "@/emg/EmgProvider";
import { EMG } from "@/emg/emgSettings";
import type { EmgEngine } from "@/emg/engine";
import { type MockBoardOptions, MockSerial } from "@/emg/mockSerial";
import { windowStats } from "@/emg/processing";
import type { EmgCommand } from "@/emg/protocol";
import {
  type CheckResult,
  evaluateReadiness,
  evaluateSqueeze,
  gatherReadiness,
  GreenLatch,
  isSensorReady,
  type SqueezeResult,
  steadyChecksGreen,
} from "@/emg/readiness";
import { isWebSerialSupported, SerialEmgStream } from "@/emg/serial";
import { BoardSimBadge } from "@/features/emg/BoardSimBadge";

import { EmgRecorder, phaseAt, RECORD_MS, recordingName, toCsv } from "./recording";

const PLOT_SECONDS = 10;

const MOCK_FAULTS: Record<string, MockBoardOptions> = {
  "None (good board)": {},
  "Slow PONG (3 s)": { pongDelayMs: 3000 },
  "Lost samples (2%)": { dropEvery: 50 },
  "Garbled lines (1%)": { garbleEvery: 100 },
  "Wrong rate (450/s)": { rateScale: 0.9 },
  "Firmware drops": { firmwareDropsPerSecond: 5 },
};

const button =
  "min-h-10 rounded-lg border border-white/20 px-3 font-semibold hover:bg-white/10 disabled:opacity-40";

function Plot({ engine }: { engine: EmgEngine }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      const context = element?.getContext("2d");
      if (!element || !context) return;
      const width = (element.width = element.clientWidth * devicePixelRatio);
      const height = (element.height = element.clientHeight * devicePixelRatio);
      context.clearRect(0, 0, width, height);
      const signal = engine.recent(PLOT_SECONDS);
      const top = 3300;
      const y = (mv: number) => height - (Math.min(mv, top) / top) * height;
      const total = Math.round(PLOT_SECONDS * engine.sampleRateHz);
      const x = (index: number, count: number) => ((total - count + index) / total) * width;
      // Saturation line.
      context.strokeStyle = "rgba(255,120,80,0.7)";
      context.setLineDash([6, 4]);
      context.beginPath();
      context.moveTo(0, y(EMG.saturationMv));
      context.lineTo(width, y(EMG.saturationMv));
      context.stroke();
      context.setLineDash([]);
      const line = (values: Float64Array, style: string, lineWidth: number) => {
        context.strokeStyle = style;
        context.lineWidth = lineWidth * devicePixelRatio;
        context.beginPath();
        values.forEach((value, index) => {
          if (index === 0) context.moveTo(x(index, values.length), y(value));
          else context.lineTo(x(index, values.length), y(value));
        });
        context.stroke();
      };
      line(signal.mv, "rgba(150,200,255,0.45)", 1);
      line(signal.envelope, "rgb(110,230,170)", 2);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [engine]);
  return (
    <figure className="flex flex-col gap-1">
      <canvas ref={canvas} className="h-64 w-full rounded-lg bg-black/40" />
      <figcaption className="text-sm opacity-80">
        Last {PLOT_SECONDS} s · blue: raw mV · green: envelope ({EMG.smoothingMs} ms) · dashed:
        saturation ({EMG.saturationMv} mV) · scale 0–3300 mV
      </figcaption>
    </figure>
  );
}

function useTick(ms = 250): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export function EmgMonitorPage() {
  const engine = useEmgEngine();
  const status = useEmgStatus();
  const now = useTick();
  const [mock, setMock] = useState<MockSerial | null>(null);
  const [fault, setFault] = useState("None (good board)");
  const [contraction, setContraction] = useState(0);
  const [rate, setRate] = useState("500");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [squeeze, setSqueeze] = useState<SqueezeResult | null>(null);
  const [squeezeUntil, setSqueezeUntil] = useState<number | null>(null);
  const relaxedBefore = useRef<{ mean: number; sd: number }>({ mean: 0, sd: 0 });
  const latch = useRef(new GreenLatch());
  const [recorder, setRecorder] = useState<EmgRecorder | null>(null);
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  // Firmware lines other than samples, newest first.
  useEffect(
    () =>
      engine.onEvent((event) => {
        if (event.type === "samples") return;
        const text =
          event.type === "info"
            ? `I ${Object.entries(event.fields)
                .map(([key, value]) => `${key}=${value}`)
                .join(" ")}`
            : JSON.stringify(event);
        setLog((lines) => [`${new Date().toLocaleTimeString()}  ${text}`, ...lines].slice(0, 40));
      }),
    [engine],
  );

  useEffect(() => () => mock?.stopAutoRun(), [mock]);

  // The nine items, four times a second, as on the session page.
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [latched, setLatched] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      const time = performance.now();
      const results = evaluateReadiness(
        gatherReadiness(engine, engine.getStatus(), {
          simulated: false,
          webSerialSupported: isWebSerialSupported() || mock !== null,
          now: time,
          squeeze,
        }),
      );
      setChecks(results);
      setLatched(latch.current.update(steadyChecksGreen(results), time));
    }, 250);
    return () => clearInterval(timer);
  }, [engine, squeeze, mock]);

  // The test squeeze: judged against the relaxed level just before it.
  useEffect(() => {
    if (squeezeUntil === null) return undefined;
    const timer = setTimeout(
      () => {
        const signal = engine.recent(EMG.squeezeMs / 1000);
        setSqueeze(evaluateSqueeze(signal.t, signal.envelope, relaxedBefore.current));
        setSqueezeUntil(null);
      },
      Math.max(0, squeezeUntil - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [squeezeUntil, engine]);

  async function saveRecording(done: EmgRecorder, meta: { label: string; mock: boolean }) {
    const name = recordingName(new Date(), meta.label);
    const current = engine.getStatus();
    const csv = toCsv(done.rows, {
      recorded_at: new Date().toISOString(),
      label: meta.label,
      source: meta.mock ? "mock board" : engine.sourceKind,
      firmware: current.firmwareVersion,
      mode: current.mode,
      rate_hz: engine.sampleRateHz,
      smoothing_ms: EMG.smoothingMs,
      protocol: "rest 10 s; mvc1 10-13 s; mvc2 16-19 s; mvc3 22-25 s (cue at each start)",
    });
    try {
      const response = await fetch(`/__dev/save-emg?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv", "X-Muvi-Dev": "1" },
        body: csv,
      });
      const body = (await response.json()) as { file?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setSaved(`Saved ${body.file}`);
    } catch (failure) {
      // Keep the data: offer it as a download instead.
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      link.download = `${name}.csv`;
      link.click();
      setSaved(`Could not save (${String(failure)}); downloaded ${name}.csv instead`);
    }
  }

  // Recording: every sample until 30 s, then saved once (the label cannot change meanwhile).
  useEffect(() => {
    if (!recorder) return undefined;
    const meta = { label, mock: mock !== null };
    let saving = false;
    return engine.onSample((sample) => {
      recorder.push(sample);
      if (recorder.done && !saving) {
        saving = true;
        void saveRecording(recorder, meta);
      }
    });
    // Only a new recording starts a new subscription.
  }, [engine, recorder]); // eslint-disable-line react-hooks/exhaustive-deps
  const recording = recorder !== null && !recorder.done;

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  const connectEsp32 = () => run(() => engine.connectSerial());

  const connectMock = () =>
    run(async () => {
      const serial = new MockSerial(MOCK_FAULTS[fault]);
      serial.autoRun();
      setMock(serial);
      await engine.connectSerial(new SerialEmgStream(serial));
    });

  const disconnect = () =>
    run(async () => {
      await engine.disconnect();
      mock?.stopAutoRun();
      setMock(null);
      latch.current = new GreenLatch();
      setSqueeze(null);
    });

  const send = (command: EmgCommand) => run(() => engine.send(command));

  function startSqueeze() {
    const before = windowStats(engine.recent(EMG.relaxedWindowMs / 1000).envelope);
    relaxedBefore.current = { mean: before.mean, sd: before.sd };
    setSqueeze(null);
    setSqueezeUntil(performance.now() + EMG.squeezeMs);
  }

  function startRecording() {
    setSaved(null);
    setRecorder(new EmgRecorder());
  }

  const rate2s = engine.arrivalStats(EMG.rateWindowMs, now);
  const gaps5s = engine.arrivalStats(EMG.gapsWindowMs, now);
  const recent = engine.recent(EMG.saturationWindowMs / 1000);
  const relaxed = windowStats(engine.recent(EMG.relaxedWindowMs / 1000).envelope);
  const saturated = recent.mv.some((value) => value >= EMG.saturationMv);
  const elapsed = recorder?.elapsedMs ?? 0;
  const step = phaseAt(elapsed);
  const ready = isSensorReady(latched, squeeze?.pass === true);

  const stats: [string, string, boolean | null][] = [
    [
      "Rate (2 s)",
      `${rate2s.rateHz.toFixed(0)}/s`,
      status.connected ? rate2s.rateHz >= EMG.minRateHz && rate2s.rateHz <= EMG.maxRateHz : null,
    ],
    [
      "Lost samples (5 s)",
      `${gaps5s.gapsPct.toFixed(2)}%`,
      status.connected ? gaps5s.gapsPct < EMG.maxGapsPct : null,
    ],
    ["Firmware dropped", String(status.dropped), status.connected ? status.dropped === 0 : null],
    [
      "Saturation (5 s)",
      saturated ? `≥ ${EMG.saturationMv} mV` : "none",
      status.connected ? !saturated : null,
    ],
    ["Envelope now", `${engine.envelopeMv.toFixed(0)} mV`, null],
    ["Rest mean ± SD (2 s)", `${relaxed.mean.toFixed(0)} ± ${relaxed.sd.toFixed(1)} mV`, null],
    [
      "%MVC",
      engine.percentMvc === null ? "not calibrated" : `${engine.percentMvc.toFixed(0)}%`,
      null,
    ],
    [
      "Firmware",
      `${status.firmwareVersion ?? "–"} · ${status.mode ?? "–"} · ${engine.sampleRateHz} Hz`,
      null,
    ],
  ];

  return (
    <main className="bg-session-bg min-h-dvh p-4 text-white sm:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">EMG monitor</h1>
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm">development only</span>
          <span
            className={clsx(
              "rounded-full px-3 py-1 text-sm font-bold",
              status.connected
                ? status.streaming
                  ? "bg-green-600"
                  : "bg-amber-600"
                : "bg-gray-600",
            )}
          >
            {status.connected
              ? status.streaming
                ? "streaming"
                : "connected, stopped"
              : "not connected"}
            {mock ? " (mock board)" : ""}
          </span>
          <BoardSimBadge mode={status.connected ? status.mode : null} />
        </header>

        <section className="flex flex-wrap items-end gap-2 rounded-xl bg-white/5 p-3">
          <button
            className={button}
            disabled={status.connected || !isWebSerialSupported()}
            onClick={() => void connectEsp32()}
          >
            Connect ESP32
          </button>
          <label className="flex flex-col text-sm">
            Mock board fault
            <select
              className="min-h-10 rounded-lg bg-black/40 px-2"
              value={fault}
              disabled={status.connected}
              onChange={(event) => setFault(event.target.value)}
            >
              {Object.keys(MOCK_FAULTS).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <button className={button} disabled={status.connected} onClick={() => void connectMock()}>
            Use mock board
          </button>
          <button className={button} disabled={!status.connected} onClick={() => void disconnect()}>
            Disconnect
          </button>
          <span className="mx-2 h-8 w-px bg-white/20" aria-hidden />
          {(["START", "STOP", "PING", "INFO", "SIM ON", "SIM OFF"] as EmgCommand[]).map(
            (command) => (
              <button
                key={command}
                className={button}
                disabled={!status.connected}
                onClick={() => void send(command)}
              >
                {command}
              </button>
            ),
          )}
          <label className="flex items-end gap-1 text-sm">
            <span className="flex flex-col">
              RATE
              <input
                className="min-h-10 w-24 rounded-lg bg-black/40 px-2"
                inputMode="numeric"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
              />
            </span>
            <button
              className={button}
              disabled={!status.connected || !/^\d+$/.test(rate)}
              onClick={() => void send(`RATE ${Number(rate)}`)}
            >
              Set
            </button>
          </label>
          {!isWebSerialSupported() && (
            <p className="w-full text-amber-200">
              No Web Serial here: use Chrome or Edge at http://localhost.
            </p>
          )}
          {error && (
            <p role="alert" className="w-full text-amber-200">
              {error}
            </p>
          )}
          {mock && (
            <label className="flex w-full items-center gap-3 text-sm">
              Mock forearm contraction
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={contraction}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setContraction(value);
                  mock.setSignal({ contraction: value });
                }}
                className="w-64"
              />
              {Math.round(contraction * 100)}%
              <button className={button} onClick={() => mock.unplug()}>
                Unplug
              </button>
              <button className={button} onClick={() => mock.replug()}>
                Plug back in
              </button>
            </label>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="flex flex-col gap-3 lg:col-span-2">
            <Plot engine={engine} />
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stats.map(([name, value, ok]) => (
                <div key={name} className="rounded-lg bg-white/5 p-2">
                  <dt className="text-sm opacity-80">{name}</dt>
                  <dd
                    className={clsx(
                      "font-semibold tabular-nums",
                      ok === false && "text-amber-300",
                      ok === true && "text-green-300",
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-col gap-2 rounded-xl bg-white/5 p-3">
              <h2 className="text-lg font-bold">Record 30 s CSV</h2>
              <p className="text-sm opacity-80">
                10 s relaxed, then squeeze as hard as you can at each prompt (3 s) and relax
                between. Saved to analysis/emg/recordings/ for analysis/emg/emg_validation.py.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col text-sm">
                  Label (person, site, gain)
                  <input
                    className="min-h-10 w-72 rounded-lg bg-black/40 px-2"
                    value={label}
                    disabled={recording}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="shadik-flexors-gain5"
                  />
                </label>
                <button
                  className={button}
                  disabled={!status.streaming || recording}
                  onClick={startRecording}
                >
                  Record 30 s CSV
                </button>
              </div>
              {recording && (
                <p
                  role="status"
                  className={clsx(
                    "rounded-lg p-3 text-center text-2xl font-bold",
                    step.phase.startsWith("mvc") ? "bg-green-700" : "bg-white/10",
                  )}
                >
                  {step.phase === "rest"
                    ? "Relax completely"
                    : step.phase.startsWith("mvc")
                      ? "SQUEEZE as hard as you can"
                      : "Relax"}{" "}
                  · {Math.ceil((RECORD_MS - elapsed) / 1000)} s left
                </p>
              )}
              {saved && <p role="status">{saved}</p>}
            </div>

            <details className="rounded-xl bg-white/5 p-3">
              <summary className="cursor-pointer font-semibold">
                Firmware lines ({log.length})
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto text-xs">{log.join("\n")}</pre>
            </details>
          </section>

          <section className="flex flex-col gap-2 rounded-xl bg-white/5 p-3">
            <h2 className="text-lg font-bold">Readiness (9 items)</h2>
            <ol className="flex flex-col gap-1">
              {checks.map((check) => (
                <li
                  key={check.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-2 py-1"
                >
                  <span>
                    <span aria-hidden className={check.pass ? "text-green-300" : "text-amber-300"}>
                      {check.pass ? "●" : "○"}
                    </span>{" "}
                    {check.id}
                  </span>
                  <span className="text-sm tabular-nums opacity-90">{check.value ?? "–"}</span>
                </li>
              ))}
            </ol>
            <button
              className={button}
              disabled={!status.streaming || squeezeUntil !== null}
              onClick={startSqueeze}
            >
              {squeezeUntil !== null ? "Squeeze now…" : "Test squeeze (2 s)"}
            </button>
            <p
              role="status"
              className={clsx(
                "rounded-full px-3 py-1 text-center font-bold",
                ready ? "bg-green-600" : "bg-white/10",
              )}
            >
              {ready
                ? "Ready for calibration"
                : latched
                  ? "Steady: now the test squeeze"
                  : "Not ready yet"}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
