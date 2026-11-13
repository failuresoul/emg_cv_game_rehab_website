// A developer tool that never reaches the production build. Its text is deliberately plain English
// rather than t(): anything in the translation files would ship to production.
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { EmgEngine } from "@/emg/engine";
import { useEmgEngine, useEmgStatus } from "@/emg/EmgProvider";
import { type OnsetEvent, SATURATION_MV, windowStats } from "@/emg/processing";
import type { EmgCommand } from "@/emg/protocol";
import { isWebSerialSupported } from "@/emg/serial";
import { isSimulatedEmgAllowed } from "@/emg/simulated";
import type { EmgEvent } from "@/emg/stream";

const PLOT_FPS = 15;

/** The last 10 s of one series, redrawn about 15 times a second straight from the engine. */
function EmgPlot({
  engine,
  series,
  max,
  label,
}: {
  engine: EmgEngine;
  series: "mv" | "percent";
  max: number;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / PLOT_FPS) return;
      last = now;
      const element = canvas.current;
      const context = element?.getContext("2d");
      if (!element || !context) return;
      const { width, height } = element;
      const signal = engine.recent(10);
      const values = series === "mv" ? signal.envelope : signal.percent;
      const raw = signal.mv;
      context.clearRect(0, 0, width, height);
      context.strokeStyle = "rgba(0,0,0,0.12)";
      for (let line = 1; line < 4; line += 1) {
        context.beginPath();
        context.moveTo(0, (height * line) / 4);
        context.lineTo(width, (height * line) / 4);
        context.stroke();
      }
      const n = values.length;
      if (n < 2) return;
      const y = (value: number) => height - (Math.min(max, Math.max(0, value)) / max) * height;
      const x = (index: number) => ((index + (5000 - n)) / 5000) * width;
      if (series === "mv") {
        context.strokeStyle = "rgba(94,107,112,0.5)";
        context.beginPath();
        for (let index = 0; index < n; index += 1) {
          if (index === 0) context.moveTo(x(index), y(raw[index]!));
          else context.lineTo(x(index), y(raw[index]!));
        }
        context.stroke();
        context.strokeStyle = "rgba(179,38,30,0.6)";
        context.setLineDash([4, 4]);
        context.beginPath();
        context.moveTo(0, y(SATURATION_MV));
        context.lineTo(width, y(SATURATION_MV));
        context.stroke();
        context.setLineDash([]);
      }
      context.strokeStyle = "#0f5c5c";
      context.lineWidth = 2;
      context.beginPath();
      let started = false;
      for (let index = 0; index < n; index += 1) {
        const value = values[index]!;
        if (Number.isNaN(value)) continue;
        if (!started) {
          context.moveTo(x(index), y(value));
          started = true;
        } else context.lineTo(x(index), y(value));
      }
      context.stroke();
      context.lineWidth = 1;
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, series, max]);

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-muted text-sm">
        {label} (last 10 s; top = {max})
      </figcaption>
      <canvas
        ref={canvas}
        width={1000}
        height={200}
        className="bg-background h-48 w-full rounded-lg"
      />
    </figure>
  );
}

function StatusBadge({ ok, children }: { ok: boolean | null; children: string }) {
  return (
    <span
      className={clsx(
        "rounded-full px-3 py-1 text-sm font-semibold",
        ok === null
          ? "bg-black/5 text-muted"
          : ok
            ? "bg-success/10 text-success"
            : "bg-danger/10 text-danger",
      )}
    >
      {children}
    </span>
  );
}

function describe(event: EmgEvent): string | null {
  switch (event.type) {
    case "samples":
      return null;
    case "connected":
      return "connected";
    case "disconnected":
      return `disconnected${event.error ? ` (${event.error})` : ""}`;
    case "status":
      return `S counter ${event.counter}, dropped ${event.dropped}, ${event.version}, ${event.mode}`;
    case "pong":
      return `PONG ${event.version}`;
    case "ok":
      return `OK ${event.detail}`;
    case "error":
      return `ERR ${event.detail}`;
    case "info":
      return `INFO ${Object.entries(event.fields)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")}`;
    case "invalid":
      return `invalid line: ${event.line}`;
  }
}

/** /dev/emg-lab: connect the ESP32 or the simulated source, and watch the signal. */
export function EmgLabPage() {
  const engine = useEmgEngine();
  const status = useEmgStatus();
  const [error, setError] = useState<string | null>(null);
  const [onsets, setOnsets] = useState<OnsetEvent[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const serialSupported = isWebSerialSupported();
  const simulatedAllowed = isSimulatedEmgAllowed();

  useEffect(
    () => engine.onOnset((event) => setOnsets((list) => [event, ...list].slice(0, 20))),
    [engine],
  );
  // Leaving the lab closes the serial port, so the session's EMG step can open it.
  useEffect(() => () => void engine.disconnect().catch(() => undefined), [engine]);
  useEffect(
    () =>
      engine.onEvent((event) => {
        const text = describe(event);
        if (text)
          setLog((list) => [`${new Date().toLocaleTimeString()}  ${text}`, ...list].slice(0, 30));
      }),
    [engine],
  );

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function record(kind: "rest" | "mvc", seconds: number) {
    const envelope = engine.recent(seconds).envelope;
    const stats = windowStats(envelope);
    const current = engine.getCalibration();
    if (kind === "rest") {
      engine.setCalibration({
        restMean: stats.mean,
        restSd: stats.sd,
        mvc: current?.mvc ?? stats.mean + 1000,
      });
    } else {
      engine.setCalibration({
        restMean: current?.restMean ?? 200,
        restSd: current?.restSd ?? 10,
        mvc: stats.peak,
      });
    }
  }

  const commands: EmgCommand[] = ["PING", "SIM ON", "SIM OFF", "START", "STOP", "INFO"];
  const calibration = engine.getCalibration();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">EMG lab (development only)</h1>
      {!serialSupported && (
        <p className="bg-warning/20 rounded-lg p-3">
          This browser has no Web Serial: use Chrome or Edge on a computer to connect the ESP32. The
          simulated source still works.
        </p>
      )}
      <Card className="flex flex-wrap gap-3">
        <Button disabled={!serialSupported} onClick={() => void run(() => engine.connectSerial())}>
          Connect ESP32
        </Button>
        <Button
          variant="secondary"
          disabled={!serialSupported}
          onClick={() => void run(() => engine.reconnectSerial())}
        >
          Reconnect
        </Button>
        {simulatedAllowed && (
          <Button variant="secondary" onClick={() => void run(() => engine.connectSimulated())}>
            Use simulated
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={!status.connected}
          onClick={() => void run(() => engine.disconnect())}
        >
          Disconnect
        </Button>
        <span className="text-muted self-center text-sm">Simulated: hold M to contract.</span>
      </Card>
      {error && <p className="text-danger">{error}</p>}

      <Card className="flex flex-wrap items-center gap-2">
        <StatusBadge ok={status.connected}>
          {status.connected ? `Connected (${status.source})` : "Not connected"}
        </StatusBadge>
        <StatusBadge ok={status.streaming}>
          {status.streaming ? "Streaming" : "Stopped"}
        </StatusBadge>
        <StatusBadge
          ok={null}
        >{`Firmware ${status.firmwareVersion ?? "?"} · ${status.mode ?? "?"}`}</StatusBadge>
        <StatusBadge
          ok={
            status.sampleRate === null
              ? null
              : Math.abs(status.sampleRate - engine.sampleRateHz) < 25
          }
        >
          {`Rate ${status.sampleRate ?? "–"} / ${engine.sampleRateHz} Hz`}
        </StatusBadge>
        <StatusBadge ok={status.gapsPct < 1}>{`Gaps ${status.gapsPct}%`}</StatusBadge>
        <StatusBadge ok={status.dropped === 0}>{`Dropped ${status.dropped}`}</StatusBadge>
        <StatusBadge ok={!status.saturation}>
          {status.saturation ? "Saturating" : "No saturation"}
        </StatusBadge>
        <StatusBadge ok={!status.electrodeOff}>
          {status.electrodeOff ? "Electrode off?" : "Signal moving"}
        </StatusBadge>
        <StatusBadge
          ok={null}
        >{`%MVC ${status.percentMvc === null ? "–" : Math.round(status.percentMvc)}`}</StatusBadge>
        {status.error && <StatusBadge ok={false}>{`Error: ${status.error}`}</StatusBadge>}
      </Card>

      <Card className="flex flex-wrap gap-2">
        {commands.map((command) => (
          <Button
            key={command}
            variant="secondary"
            disabled={!status.connected}
            onClick={() => void run(() => engine.send(command))}
          >
            {command}
          </Button>
        ))}
        <Button variant="secondary" disabled={!status.streaming} onClick={() => record("rest", 2)}>
          Record rest (last 2 s)
        </Button>
        <Button variant="secondary" disabled={!status.streaming} onClick={() => record("mvc", 3)}>
          Record MVC (peak of last 3 s)
        </Button>
        <Button variant="ghost" onClick={() => engine.setCalibration(null)}>
          Clear calibration
        </Button>
        {calibration && (
          <span className="text-muted self-center text-sm">
            rest {calibration.restMean.toFixed(0)} ± {calibration.restSd.toFixed(1)} mV, MVC{" "}
            {calibration.mvc.toFixed(0)} mV
          </span>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <EmgPlot
          engine={engine}
          series="mv"
          max={3300}
          label="Envelope, mV (grey raw, teal 50 ms smoothed, red line saturation)"
        />
        <EmgPlot engine={engine} series="percent" max={120} label="%MVC (after calibration)" />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-bold">Onsets and offsets</h2>
          <ul className="font-mono text-sm">
            {onsets.length === 0 && <li className="text-muted">None yet (calibrate first)</li>}
            {onsets.map((event, index) => (
              <li key={`${event.t}-${index}`}>
                {event.type} at {(event.t / 1000).toFixed(3)} s
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">Firmware events</h2>
          <ul className="font-mono text-sm">
            {log.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        </Card>
      </div>
    </main>
  );
}
