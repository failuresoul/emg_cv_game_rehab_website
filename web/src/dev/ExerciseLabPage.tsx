// A developer tool that never reaches the production build. Its text is deliberately plain English
// rather than t(): anything in the translation files would ship to production.
import clsx from "clsx";
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
import {
  ActivationMeter,
  ActivationSourceBadge,
  DEFAULT_GRIP_REFS,
  DEFAULT_TOUCH_THRESHOLD,
  FINGERS,
  TOUCH_HYSTERESIS,
  useHandInput,
} from "@/input";
import type { Side } from "@/types/api";
import type { AngleMeasure } from "@/vision/angles";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { useVision } from "@/vision/useVision";
import { visionEngine } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";
import {
  ALL_EXERCISE_IDS,
  type ExerciseId,
  type ExercisePreset,
  EXERCISES,
} from "@/warmup/exercises";

import { type ChartPoint, LabSession, type LabSnapshot } from "./labSession";

const PRIMARY = "var(--color-primary)";
const MUTED = "var(--color-muted)";
const LOW_COLOR = "var(--color-warning)";
const HIGH_COLOR = "var(--color-success)";
// The smallest gap between low and high, as a share of the measure's range.
const MIN_THRESHOLD_GAP_SHARE = 0.03;

const AngleChart = memo(function AngleChart({
  points,
  low,
  high,
  range,
}: {
  points: readonly ChartPoint[];
  low: number;
  high: number;
  range: { min: number; max: number };
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
            domain={[range.min, range.max]}
            ticks={Array.from(
              { length: 5 },
              (_, index) => range.min + ((range.max - range.min) * index) / 4,
            )}
            tickFormatter={(tick: number) => (range.max > 10 ? tick.toFixed(0) : tick.toFixed(2))}
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
            name="Filtered value"
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
  digits = 1,
}: {
  name: string;
  raw: Partial<AngleMeasure> | null | undefined;
  filtered: number | null | undefined;
  digits?: number;
}) {
  return (
    <tr>
      <th scope="row" className="py-1 pr-3 text-left font-medium">
        {name}
      </th>
      <td className="px-2 py-1 tabular-nums">{number(raw?.value, digits)}</td>
      <td className="px-2 py-1 tabular-nums">{number(filtered, digits)}</td>
      <td className="px-2 py-1">{raw?.source ?? "–"}</td>
      <td className="px-2 py-1">{raw?.trunkReference ?? "–"}</td>
      <td className="px-2 py-1 tabular-nums">{number(raw?.confidence, 2)}</td>
    </tr>
  );
}

const COMPENSATION_ROWS = [
  { type: "trunk", name: "Trunk displacement", key: "trunkDisplacement", unit: "SW", digits: 2 },
  { type: "lean", name: "Trunk lean", key: "trunkLeanDeg", unit: "deg", digits: 1 },
  { type: "shoulder", name: "Shoulder hike", key: "shoulderHike", unit: "SW", digits: 2 },
] as const;

function CompensationCard({
  snapshot,
  onRebaseline,
}: {
  snapshot: LabSnapshot | null;
  onRebaseline: () => void;
}) {
  const reading = snapshot?.compensation;
  const sustained = reading?.sustained ?? [];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Compensation</h2>
        <Button variant="secondary" onClick={onRebaseline}>
          Re-baseline
        </Button>
      </div>
      <p className="font-medium">
        Baseline:{" "}
        {reading?.baseline
          ? `ready (hips ${reading.baseline.trunkVector ? "used" : "hidden, shoulder line used"})`
          : "collecting, sit still for 2 seconds"}
        {" · "}
        {sustained.length > 0 ? (
          <span className="text-warning font-bold">compensating: {sustained.join(", ")}</span>
        ) : (
          <span className="text-success font-bold">upright</span>
        )}
      </p>
      <table className="w-full">
        <thead className="text-muted text-left">
          <tr>
            <th className="pr-3 font-semibold">Measure</th>
            <th className="px-2 font-semibold">Live</th>
            <th className="px-2 font-semibold">Threshold</th>
            <th className="px-2 font-semibold">Checked</th>
          </tr>
        </thead>
        <tbody>
          {COMPENSATION_ROWS.map((row) => {
            const value = reading?.values?.[row.key];
            const threshold = snapshot?.compensationThresholds[row.key];
            return (
              <tr key={row.key}>
                <th scope="row" className="py-1 pr-3 text-left font-medium">
                  {row.name}
                </th>
                <td className="px-2 py-1 tabular-nums">
                  {number(value, row.digits)} {row.unit}
                </td>
                <td className="px-2 py-1 tabular-nums">
                  {number(threshold, row.digits)} {row.unit}
                </td>
                <td className="px-2 py-1">
                  {snapshot?.compensationChecks.includes(row.type) ? "yes" : "no"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
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

function HandInputCard({ side }: { side: Side }) {
  const {
    sourceId,
    grip,
    gripReady,
    openness,
    opennessReady,
    touch,
    isTouchReady,
    subscribeTouch,
  } = useHandInput({ affectedSide: side });
  const [lastTouch, setLastTouch] = useState("–");
  useEffect(
    () =>
      subscribeTouch((event) =>
        setLastTouch(`${event.type} ${event.finger} at ${(event.t / 1000).toFixed(2)}s`),
      ),
    [subscribeTouch],
  );
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">Hand input</h2>
        <ActivationSourceBadge sourceId={sourceId} />
        <span className="font-medium">
          Source {sourceId} · {opennessReady ? "ready" : "not ready (hand not visible)"}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex items-center gap-3">
          <ActivationMeter level={grip} ready={gripReady} />
          <Stat label="Grip" value={number(grip, 2)} />
        </div>
        <div className="flex items-center gap-3">
          <ActivationMeter level={openness} ready={opennessReady} />
          <Stat label="Openness" value={number(openness, 2)} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-muted">Thumb touching</p>
          <ul className="flex gap-2" aria-label="Thumb touch">
            {FINGERS.map((finger) => (
              <li
                key={finger}
                className={clsx(
                  "flex min-h-11 min-w-16 items-center justify-center rounded-xl border-2 px-2 font-bold",
                  touch === finger
                    ? "border-accent bg-accent text-white"
                    : "border-primary text-ink bg-surface",
                )}
              >
                {finger}
              </li>
            ))}
          </ul>
          <p className="font-medium">
            Now {touch ?? "none"} · last {lastTouch}
            {isTouchReady() ? "" : " · not ready"}
          </p>
        </div>
      </div>
      <p className="text-muted">
        Default references: open {DEFAULT_GRIP_REFS.openRef}, closed {DEFAULT_GRIP_REFS.closedRef},
        touch below {DEFAULT_TOUCH_THRESHOLD} (release above{" "}
        {DEFAULT_TOUCH_THRESHOLD + TOUCH_HYSTERESIS}). Press K for keyboard input, then hold Space
        to squeeze, O to open, and 1–4 to touch the index to little finger.
      </p>
    </Card>
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

  const exercise = EXERCISES[config.exerciseId];
  const range = exercise.gauge;
  const isDegrees = exercise.unit === "deg";
  const step = isDegrees ? 1 : 0.01;
  const digits = isDegrees ? 0 : 2;

  function changeThreshold(which: "low" | "high", value: number) {
    const gap = (range.max - range.min) * MIN_THRESHOLD_GAP_SHARE;
    const next =
      which === "low"
        ? { low: Math.min(value, thresholds.high - gap), high: thresholds.high }
        : { low: thresholds.low, high: Math.max(value, thresholds.low + gap) };
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
          <SkeletonCanvas
            result={result}
            highlightSide={config.side}
            trunkWarning={(snapshot?.compensation.sustained.length ?? 0) > 0}
          />
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
              <MeasureRow
                name="Forward reach"
                raw={snapshot?.raw.forwardReachRatio}
                filtered={snapshot?.filtered.forwardReachRatio}
                digits={2}
              />
              <MeasureRow
                name="Hand aperture"
                raw={
                  snapshot?.hand.raw && {
                    value: snapshot.hand.raw.handApertureRatio,
                    source: snapshot.hand.raw.source,
                  }
                }
                filtered={snapshot?.hand.filtered.handApertureRatio}
                digits={2}
              />
              {FINGERS.map((finger, index) => (
                <MeasureRow
                  key={finger}
                  name={`Thumb to ${finger}`}
                  raw={
                    snapshot?.hand.raw && {
                      value: snapshot.hand.raw.thumbFingerDistances[index],
                      source: snapshot.hand.raw.source,
                    }
                  }
                  filtered={snapshot?.hand.filtered.thumbFingerDistances?.[index]}
                  digits={2}
                />
              ))}
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
              options={ALL_EXERCISE_IDS.map((id) => ({ value: id, label: id }))}
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
                {which} {thresholds[which].toFixed(digits)}
                {isDegrees ? "°" : ""}
              </span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={step}
                value={thresholds[which]}
                onChange={(event) => changeThreshold(which, Number(event.target.value))}
                className="min-h-11 flex-1"
              />
            </label>
          ))}
        </Card>

        <HandInputCard side={config.side} />

        <Card className="flex flex-col gap-4">
          <Stat label="State" value={snapshot?.counterState ?? "–"} />
          {exercise.counter === "sequence" && (
            <p className="font-medium">
              Sequence: {snapshot?.sequenceStep ?? 0} of {FINGERS.length} touched, next{" "}
              {FINGERS[snapshot?.sequenceStep ?? 0]} (touch below {thresholds.low.toFixed(2)},
              release above {thresholds.high.toFixed(2)})
            </p>
          )}
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
          <h2 className="mb-2 font-bold">
            {exercise.counter === "sequence"
              ? "Filtered thumb distance to the next finger, last 10 seconds"
              : `Filtered ${exercise.measure}, last 10 seconds`}
          </h2>
          <AngleChart
            points={snapshot?.chart ?? []}
            low={thresholds.low}
            high={thresholds.high}
            range={range}
          />
        </Card>

        <CompensationCard snapshot={snapshot} onRebaseline={() => session.rebaseline()} />

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
