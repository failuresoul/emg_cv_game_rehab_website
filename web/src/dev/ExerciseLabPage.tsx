// A developer tool that never reaches the production build. Its text is deliberately plain English
// rather than t(): anything in the translation files would ship to production.
import { memo, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import type { Side } from "@/types/api";
import type { AngleMeasure } from "@/vision/angles";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { useVision } from "@/vision/useVision";
import { visionEngine } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";
import { EXERCISE_ORDER, type ExerciseId, type ExercisePreset } from "@/warmup/exercises";

import { type ChartPoint, LabSession, type LabSnapshot } from "./labSession";

const PRIMARY = "var(--color-primary)";
const MUTED = "var(--color-muted)";
const LOW_COLOR = "var(--color-warning)";
const HIGH_COLOR = "var(--color-success)";
const MIN_THRESHOLD_GAP = 5;

const AngleChart = memo(function AngleChart({
  points,
  low,
  high,
}: {
  points: readonly ChartPoint[];
  low: number;
  high: number;
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...points]} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={false} stroke={MUTED} strokeOpacity={0.2} />
          <XAxis
            type="number"
            dataKey="secondsAgo"
            domain={[-10, 0]}
            ticks={[-10, -8, -6, -4, -2, 0]}
            allowDataOverflow
            tick={{ fill: MUTED }}
            tickLine={false}
            unit=" s"
          />
          <YAxis
            domain={[0, 180]}
            ticks={[0, 45, 90, 135, 180]}
            width={48}
            tick={{ fill: MUTED }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip />
          <ReferenceLine
            y={low}
            stroke={LOW_COLOR}
            strokeWidth={2}
            strokeDasharray="6 4"
            label={{ value: "low", position: "insideTopLeft", fill: "var(--color-ink)" }}
          />
          <ReferenceLine
            y={high}
            stroke={HIGH_COLOR}
            strokeWidth={2}
            strokeDasharray="6 4"
            label={{ value: "high", position: "insideTopLeft", fill: "var(--color-ink)" }}
          />
          <Line
            type="linear"
            dataKey="value"
            name="Filtered angle"
            stroke={PRIMARY}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

const number = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? "–" : value.toFixed(digits);

function MeasureRow({
  name,
  raw,
  filtered,
}: {
  name: string;
  raw: AngleMeasure | null | undefined;
  filtered: number | null | undefined;
}) {
  return (
    <tr>
      <th scope="row" className="py-1 pr-3 text-left font-medium">
        {name}
      </th>
      <td className="px-2 py-1 tabular-nums">{number(raw?.value)}</td>
      <td className="px-2 py-1 tabular-nums">{number(filtered)}</td>
      <td className="px-2 py-1">{raw?.source ?? "–"}</td>
      <td className="px-2 py-1">{raw?.trunkReference ?? "–"}</td>
      <td className="px-2 py-1 tabular-nums">{number(raw?.confidence, 2)}</td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-muted">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function downloadCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `exercise-lab-${new Date().toISOString().replaceAll(":", "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function LiveLab() {
  const { status, result, retry } = useVision();
  const [session] = useState(
    () => new LabSession({ exerciseId: "shoulder_flexion", preset: "standard", side: "left" }),
  );
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null);
  const [config, setConfig] = useState(session.currentConfig);
  const [thresholds, setThresholds] = useState(session.currentThresholds);
  const [hasRecording, setHasRecording] = useState(false);

  useEffect(
    () =>
      visionEngine.subscribe((frame) => {
        setSnapshot(session.process(frame));
      }),
    [session],
  );

  function changeConfig(changes: Partial<typeof config>) {
    const next = { ...config, ...changes };
    session.configure(next);
    setConfig(next);
    setThresholds(session.currentThresholds);
  }

  function changeThreshold(which: "low" | "high", value: number) {
    const next =
      which === "low"
        ? { low: Math.min(value, thresholds.high - MIN_THRESHOLD_GAP), high: thresholds.high }
        : { low: thresholds.low, high: Math.max(value, thresholds.low + MIN_THRESHOLD_GAP) };
    session.setThresholds(next);
    setThresholds(next);
  }

  if (status.phase !== "running") return <VisionStatusCard status={status} retry={retry} />;

  const manual = snapshot?.manualCount ?? 0;
  const full = snapshot?.fullReps ?? 0;
  const difference = full - manual;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="bg-session-bg rounded-xl">
          <SkeletonCanvas result={result} highlightSide={config.side} />
        </div>
        <Card>
          <table className="w-full">
            <thead className="text-muted text-left">
              <tr>
                <th className="pr-3 font-semibold">Measure</th>
                <th className="px-2 font-semibold">Raw</th>
                <th className="px-2 font-semibold">Filtered</th>
                <th className="px-2 font-semibold">Source</th>
                <th className="px-2 font-semibold">Trunk</th>
                <th className="px-2 font-semibold">Confidence</th>
              </tr>
            </thead>
            <tbody>
              <MeasureRow
                name="Elevation"
                raw={snapshot?.raw.armElevationDeg}
                filtered={snapshot?.filtered.armElevationDeg}
              />
              <MeasureRow
                name="Plane"
                raw={snapshot?.raw.elevationPlaneDeg}
                filtered={snapshot?.filtered.elevationPlaneDeg}
              />
              <MeasureRow
                name="Elbow"
                raw={snapshot?.raw.elbowFlexionDeg}
                filtered={snapshot?.filtered.elbowFlexionDeg}
              />
            </tbody>
          </table>
          <p className="mt-3 font-medium">
            FPS {number(snapshot?.fps)} · {result?.delegate ?? "–"}
          </p>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label="Exercise"
              value={config.exerciseId}
              options={EXERCISE_ORDER.map((id) => ({ value: id, label: id }))}
              onChange={(event) => changeConfig({ exerciseId: event.target.value as ExerciseId })}
            />
            <Select
              label="Preset"
              value={config.preset}
              options={[
                { value: "standard", label: "standard" },
                { value: "gentle", label: "gentle" },
              ]}
              onChange={(event) => changeConfig({ preset: event.target.value as ExercisePreset })}
            />
            <Select
              label="Affected side"
              value={config.side}
              options={[
                { value: "left", label: "left" },
                { value: "right", label: "right" },
              ]}
              onChange={(event) => changeConfig({ side: event.target.value as Side })}
            />
          </div>
          {(["low", "high"] as const).map((which) => (
            <label key={which} className="flex items-center gap-3 font-medium">
              <span className="w-24">
                {which} {thresholds[which]}°
              </span>
              <input
                type="range"
                min={0}
                max={180}
                value={thresholds[which]}
                onChange={(event) => changeThreshold(which, Number(event.target.value))}
                className="min-h-11 flex-1"
              />
            </label>
          ))}
        </Card>

        <Card className="flex flex-col gap-4">
          <Stat label="State" value={snapshot?.counterState ?? "–"} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Full" value={full} />
            <Stat label="Partial" value={snapshot?.partialReps ?? 0} />
            <Stat label="Manual" value={manual} />
            <Stat label="Difference" value={difference > 0 ? `+${difference}` : difference} />
          </div>
          {snapshot?.trackingPaused && (
            <p className="text-danger font-medium">Tracking lost: the counter is paused.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => session.pressManualCount()}>
              Manual count
            </Button>
            {snapshot?.isRecording ? (
              <Button
                variant="danger"
                onClick={() => {
                  session.stopRecording();
                  setHasRecording(session.hasRecording);
                }}
              >
                Stop ({snapshot.recordedRows} rows)
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  session.startRecording();
                  setHasRecording(false);
                }}
              >
                Record
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={!hasRecording || snapshot?.isRecording}
              onClick={() => downloadCsv(session.toCsv())}
            >
              Download CSV
            </Button>
            <Button variant="ghost" onClick={() => session.reset()}>
              Reset
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 font-bold">Filtered angle, last 10 seconds</h2>
          <AngleChart points={snapshot?.chart ?? []} low={thresholds.low} high={thresholds.high} />
        </Card>

        <Card>
          <h2 className="mb-2 font-bold">Event log</h2>
          <ol className="h-48 overflow-y-auto font-mono text-base">
            {(snapshot?.events ?? []).map((event) => (
              <li key={event.id}>
                <span className="text-muted">{(event.timestamp / 1000).toFixed(2)}s</span>{" "}
                {event.text}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

export function ExerciseLabPage() {
  const [started, setStarted] = useState(false);

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1800px] flex-col gap-4 p-4">
      <header>
        <h1 className="text-2xl font-bold">Exercise Lab</h1>
        <p className="text-muted">
          Development only. Nothing here is sent to the server, and recordings stay on this
          computer.
        </p>
      </header>
      {started ? (
        <LiveLab />
      ) : (
        <div>
          <Button size="lg" onClick={() => setStarted(true)}>
            Start camera
          </Button>
        </div>
      )}
    </main>
  );
}
