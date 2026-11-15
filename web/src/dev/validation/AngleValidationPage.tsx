// A developer tool that never reaches the production build (/dev/angle-validation, Day 19).
// Plain English, like the other lab pages. Usable alone: Space starts a measurement, the beeps
// say when to hold still and when it is done, and the rows stay in this browser.
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { playBeep, playChime, prepareAudio } from "@/lib/beep";
import type { Side } from "@/types/api";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { useVision } from "@/vision/useVision";
import { visionEngine } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";

import {
  AngleSampler,
  anglesCsv,
  type AngleRow,
  JOINTS,
  type Joint,
  loadRows,
  saveRows,
} from "./angleSamples";
import { downloadText } from "./download";

const COUNTDOWN_S = 5;
const SAMPLE_MS = 2000;

type Phase =
  | { kind: "idle" }
  | { kind: "countdown"; left: number }
  | { kind: "sampling" }
  | { kind: "enter"; measured: ReturnType<AngleSampler["mean"]> };

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const JOINT_HELP: Record<Joint, string> = {
  elbow: "Upper arm hanging straight down; bend the elbow and hold. Clinometer on the forearm.",
  shoulder_flexion: "Raise the straight arm forward and hold. Clinometer on the upper arm.",
  shoulder_abduction:
    "Raise the straight arm out to the side and hold. Clinometer on the upper arm.",
};

export function AngleValidationPage() {
  const { status, result, retry } = useVision();
  const [joint, setJoint] = useState<Joint>("elbow");
  const [side, setSide] = useState<Side>("right");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [reference, setReference] = useState("");
  const [rows, setRows] = useState<AngleRow[]>(() => loadRows(storage()));
  const timers = useRef<number[]>([]);
  const referenceInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveRows(storage(), rows), [rows]);
  useEffect(() => () => timers.current.forEach((timer) => clearTimeout(timer)), []);

  const start = useCallback(() => {
    if (phase.kind === "countdown" || phase.kind === "sampling") return;
    prepareAudio();
    const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
    for (let second = 0; second < COUNTDOWN_S; second++) {
      later(second * 1000, () => {
        playBeep();
        setPhase({ kind: "countdown", left: COUNTDOWN_S - second });
      });
    }
    later(COUNTDOWN_S * 1000, () => {
      setPhase({ kind: "sampling" });
      const sampler = new AngleSampler(joint, side);
      const stop = visionEngine.subscribe((frame) => sampler.add(frame));
      later(SAMPLE_MS, () => {
        stop();
        playChime();
        setReference("");
        setPhase({ kind: "enter", measured: sampler.mean() });
        setTimeout(() => referenceInput.current?.focus(), 0);
      });
    });
  }, [phase.kind, joint, side]);

  // Space starts a measurement (not while typing the reference).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start]);

  const save = () => {
    if (phase.kind !== "enter") return;
    const value = Number(reference);
    if (!Number.isFinite(value) || value < 0 || value > 200) return;
    setRows((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        joint,
        reference_deg: value,
        ...phase.measured,
        timestamp: new Date().toISOString(),
      },
    ]);
    setPhase({ kind: "idle" });
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1800px] flex-col gap-4 p-4">
      <header>
        <h1 className="text-2xl font-bold">Angle validation</h1>
        <p className="text-muted">
          Development only. Rows stay in this browser until you download them.
        </p>
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {status.phase === "running" ? (
          <div className="-scale-x-100">
            <SkeletonCanvas result={result} highlightSide={side} />
          </div>
        ) : (
          <VisionStatusCard status={status} retry={retry} />
        )}
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              Joint
              <select
                className="rounded border border-muted px-2 py-1"
                value={joint}
                onChange={(event) => setJoint(event.target.value as Joint)}
              >
                {JOINTS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Side
              <select
                className="rounded border border-muted px-2 py-1"
                value={side}
                onChange={(event) => setSide(event.target.value as Side)}
              >
                <option value="right">right</option>
                <option value="left">left</option>
              </select>
            </label>
          </div>
          <p className="text-sm">
            {JOINT_HELP[joint]} Press Space (or the button), take the pose during the 5 beeps, hold
            still until the chime (2 s), then type the clinometer's reading.
          </p>
          <Button
            size="lg"
            disabled={phase.kind === "countdown" || phase.kind === "sampling"}
            onClick={start}
          >
            Measure (Space)
          </Button>
          <p className="text-5xl font-bold tabular-nums" aria-live="assertive">
            {phase.kind === "countdown" && phase.left}
            {phase.kind === "sampling" && "Hold still…"}
          </p>
          {phase.kind === "enter" && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <p>
                MediaPipe: 3D {phase.measured.mp3d_deg ?? "–"}°, 2D {phase.measured.mp2d_deg ?? "–"}
                ° (visibility {phase.measured.visibility ?? "–"})
              </p>
              <label className="flex items-center gap-2">
                Reference angle (°)
                <input
                  ref={referenceInput}
                  type="number"
                  step="0.5"
                  min={0}
                  max={200}
                  required
                  className="w-28 rounded border border-muted px-2 py-1 text-lg"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit">Save row</Button>
                <Button variant="ghost" type="button" onClick={() => setPhase({ kind: "idle" })}>
                  Discard
                </Button>
              </div>
            </form>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() => downloadText("angles.csv", anglesCsv(rows))}
            >
              Download CSV
            </Button>
            <p className="text-sm text-muted">{rows.length} rows</p>
          </div>
          {rows.length > 0 && (
            <table className="text-sm">
              <thead>
                <tr className="text-left">
                  <th scope="col">Joint</th>
                  <th scope="col">Reference</th>
                  <th scope="col">3D</th>
                  <th scope="col">2D</th>
                  <th scope="col">
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.joint}</td>
                    <td className="tabular-nums">{row.reference_deg}</td>
                    <td className="tabular-nums">{row.mp3d_deg ?? "–"}</td>
                    <td className="tabular-nums">{row.mp2d_deg ?? "–"}</td>
                    <td>
                      <Button
                        variant="ghost"
                        aria-label={`Delete the ${row.joint} row at ${row.reference_deg}°`}
                        onClick={() =>
                          setRows((current) => current.filter((item) => item.id !== row.id))
                        }
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </main>
  );
}
