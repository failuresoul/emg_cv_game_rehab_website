// A developer tool that never reaches the production build (the Exercise Lab is development only).
// Its text is plain English rather than t(), like the rest of the lab.
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LandmarkRecorder, serialiseRecording } from "@/testing/landmarkFormat";
import { visionEngine } from "@/vision/visionEngine";

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const SIZE_WARNING_BYTES = 15 * 1024 * 1024;

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves what the camera tracking sees (landmarks only, never the image) as a file for the
 * automated tests: web/public/test-fixtures/landmarks/<name>.json, played back with
 * ?replay=<name> in test mode.
 */
export function LandmarkRecorderCard() {
  const [name, setName] = useState("my-recording");
  const [recording, setRecording] = useState(false);
  const [stats, setStats] = useState({ frames: 0, seconds: 0, megabytes: 0 });
  const recorderRef = useRef<LandmarkRecorder | null>(null);

  useEffect(() => {
    if (!recording) return undefined;
    const recorder = new LandmarkRecorder();
    recorderRef.current = recorder;
    const unsubscribe = visionEngine.subscribe((result) => recorder.add(result));
    const timer = setInterval(() => {
      setStats({
        frames: recorder.frameCount,
        seconds: recorder.durationMs / 1000,
        megabytes: recorder.approximateBytes / 1024 / 1024,
      });
    }, 500);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [recording]);

  const stop = () => {
    setRecording(false);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.frameCount > 0) {
      download(name, serialiseRecording(recorder.toRecording()));
    }
  };

  const nameOk = NAME_PATTERN.test(name);
  return (
    <Card className="flex flex-wrap items-end gap-3 p-4">
      <label className="flex flex-col gap-1 text-sm">
        Recording name
        <input
          className="rounded border border-muted px-2 py-1"
          value={name}
          disabled={recording}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {recording ? (
        <Button onClick={stop}>Stop</Button>
      ) : (
        <Button
          variant="secondary"
          disabled={!nameOk}
          onClick={() => {
            setStats({ frames: 0, seconds: 0, megabytes: 0 });
            setRecording(true);
          }}
        >
          Record landmarks
        </Button>
      )}
      <p className="text-sm text-muted" aria-live="polite">
        {recording ? "Recording: " : "Last: "}
        {stats.frames} frames, {stats.seconds.toFixed(1)} s, about {stats.megabytes.toFixed(1)} MB
        {stats.megabytes * 1024 * 1024 > SIZE_WARNING_BYTES ? " (over 15 MB: keep it shorter)" : ""}
      </p>
      {!nameOk && <p className="text-sm text-danger">Use letters, digits, dots, dashes or _.</p>}
      <p className="w-full text-xs text-muted">
        Saves landmarks only (no image) to {name || "…"}.json. Put it in
        web/public/test-fixtures/landmarks/ and open the app in test mode with ?replay=
        {name || "…"}.
      </p>
    </Card>
  );
}
