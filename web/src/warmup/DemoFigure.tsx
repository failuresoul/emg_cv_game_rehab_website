import { useEffect, useState } from "react";

import { t } from "@/i18n";
import type { Side } from "@/types/api";

import { poseAt } from "./demo";
import type { DemoKeyframe } from "./exercises";

const LOOP_MS = 5000;
const SIZE = 360;
const CENTER_X = SIZE / 2;
const SHOULDER_Y = 170;
const SCALE = 85;

/** A looping stick figure, with outward on the same side as the mirrored camera view. */
export function DemoFigure({
  frames,
  affectedSide,
}: {
  frames: DemoKeyframe[];
  affectedSide: Side;
}) {
  const [time, setTime] = useState(0);

  useEffect(() => {
    let request = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setTime(((now - start) % LOOP_MS) / LOOP_MS);
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, []);

  const outward = affectedSide === "left" ? -1 : 1;
  const pose = poseAt(frames, time);
  const toX = (x: number) => CENTER_X + outward * x * SCALE;
  const toY = (y: number) => SHOULDER_Y - y * SCALE;
  const trunkEndY = toY(-1.4);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={t("warmup.demo.label")}
      className="w-full max-h-[50dvh]"
    >
      <circle
        cx={CENTER_X}
        cy={SHOULDER_Y - 62}
        r={30}
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth={6}
      />
      <line
        x1={CENTER_X}
        y1={SHOULDER_Y - 32}
        x2={CENTER_X}
        y2={trunkEndY}
        stroke="var(--color-muted)"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <polyline
        points={`${toX(pose.shoulder.x)},${toY(pose.shoulder.y)} ${toX(pose.elbow.x)},${toY(pose.elbow.y)} ${toX(pose.wrist.x)},${toY(pose.wrist.y)}`}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={toX(pose.shoulder.x)}
        cy={toY(pose.shoulder.y)}
        r={9}
        fill="var(--color-primary)"
      />
    </svg>
  );
}
