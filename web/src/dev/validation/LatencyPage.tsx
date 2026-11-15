// A developer tool that never reaches the production build (/dev/latency, Day 19). Plain English,
// like the other lab pages.
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Side } from "@/types/api";
import { POSE } from "@/vision/landmarks";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { useVision } from "@/vision/useVision";
import { visionEngine } from "@/vision/visionEngine";
import { VisionStatusCard } from "@/vision/VisionStatusCard";

import { downloadText } from "./download";
import { LatencyLog, type StageSummary } from "./latency";

/** The line the wrist crosses, as a share of the image height from the top. */
const LINE = 0.5;

function Stat({ label, value }: { label: string; value: StageSummary }) {
  const show = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "–");
  return (
    <tr>
      <th scope="row" className="pr-4 text-left font-medium">
        {label}
      </th>
      <td className="pr-4 tabular-nums">{show(value.mean)} ms</td>
      <td className="pr-4 tabular-nums">{show(value.p95)} ms</td>
      <td className="tabular-nums">{value.n}</td>
    </tr>
  );
}

export function LatencyPage() {
  const { status, result, retry } = useVision();
  const [side, setSide] = useState<Side>("right");
  const [recording, setRecording] = useState(false);
  const [summary, setSummary] = useState(() => new LatencyLog().summary());
  const [frames, setFrames] = useState(0);
  const square = useRef<HTMLDivElement>(null);
  const log = useRef(new LatencyLog());
  const recordingRef = useRef(false);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  // Each frame: the wrist above or below the line turns the square white or black, at once.
  useEffect(
    () =>
      visionEngine.subscribe((frame) => {
        const wrist = frame.pose?.[side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
        const above = wrist !== undefined && wrist.y < LINE;
        requestAnimationFrame(() => {
          if (square.current) square.current.style.background = above ? "#ffffff" : "#000000";
          const renderedAt = performance.now();
          if (recordingRef.current) {
            log.current.add({
              timestamp: frame.timestamp,
              detectedAt: frame.detectedAt ?? frame.timestamp,
              renderedAt,
              above,
              fps: frame.fps,
            });
          }
        });
      }),
    [side],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setSummary(log.current.summary());
      setFrames(log.current.length);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1800px] flex-col gap-4 p-4">
      <header>
        <h1 className="text-2xl font-bold">Latency check</h1>
        <p className="text-muted">Development only. Nothing is sent to the server.</p>
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="relative">
          {status.phase === "running" ? (
            <div className="-scale-x-100">
              <SkeletonCanvas result={result} highlightSide={side} />
            </div>
          ) : (
            <VisionStatusCard status={status} retry={retry} />
          )}
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 left-0 border-t-4 border-dashed border-yellow-400"
            style={{ top: `${LINE * 100}%` }}
          />
        </div>
        <div className="flex flex-col gap-4">
          <div
            ref={square}
            aria-label="Latency square: white when the wrist is above the line"
            className="aspect-square w-full max-w-[420px] border-4 border-gray-400 bg-black"
          />
          <Card className="flex flex-col gap-3 p-4">
            <ol className="list-decimal pl-5 text-sm">
              <li>
                Sit so the camera sees your {side} arm, then raise and lower your wrist across the
                yellow line.
              </li>
              <li>The square turns white when the wrist is above the line and black below it.</li>
              <li>
                For the true delay, film your arm and the square together with a phone in slow
                motion (240 fps), then count the frames from the wrist crossing to the square
                changing (latency_manual.csv: trial, latency_ms).
              </li>
              <li>Record here at the same time for the software's own stages, then download.</li>
            </ol>
            <label className="flex items-center gap-2">
              Affected side
              <select
                className="rounded border border-muted px-2 py-1"
                value={side}
                onChange={(event) => setSide(event.target.value as Side)}
              >
                <option value="right">right</option>
                <option value="left">left</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setRecording((on) => !on)}>
                {recording ? "Stop recording" : "Start recording"}
              </Button>
              <Button
                variant="secondary"
                disabled={frames === 0}
                onClick={() => downloadText("latency_software.csv", log.current.toCsv())}
              >
                Download timing CSV
              </Button>
              <Button variant="ghost" onClick={() => log.current.clear()}>
                Clear
              </Button>
            </div>
            <p aria-live="polite">
              {recording ? "Recording" : "Not recording"}: {frames} frames
            </p>
            <table className="text-sm">
              <thead>
                <tr className="text-left">
                  <th scope="col">Stage</th>
                  <th scope="col">Mean</th>
                  <th scope="col">p95</th>
                  <th scope="col">Frames</th>
                </tr>
              </thead>
              <tbody>
                <Stat label="Frame to landmarks" value={summary.detect} />
                <Stat label="Landmarks to drawn" value={summary.render} />
                <Stat label="Frame to drawn" value={summary.total} />
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </main>
  );
}
