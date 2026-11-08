import { useEffect, useState } from "react";

import { t } from "@/i18n";
import type { Side } from "@/types/api";

import { handPoseAt, poseAt } from "./demo";
import {
  type DemoKeyframe,
  type ExerciseDemo,
  HAND_KNUCKLES,
  type HandKeyframe,
} from "./exercises";

const LOOP_MS = 5000;
const SIZE = 360;
const CENTER_X = SIZE / 2;
const SHOULDER_Y = 170;
const SCALE = 85;
const HAND_WRIST_Y = 320;
const HAND_SCALE = 140;

/** Time through the loop, from 0 to 1. */
function useLoopTime(): number {
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

  return time;
}

function ArmFigure({
  frames,
  outward,
  time,
}: {
  frames: DemoKeyframe[];
  outward: number;
  time: number;
}) {
  const pose = poseAt(frames, time);
  const toX = (x: number) => CENTER_X + outward * x * SCALE;
  const toY = (y: number) => SHOULDER_Y - y * SCALE;
  const trunkEndY = toY(-1.4);

  return (
    <>
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
    </>
  );
}

/** A palm and five finger lines. The thumb is on the inner side, as in the mirrored view. */
function HandFigure({
  frames,
  outward,
  time,
}: {
  frames: HandKeyframe[];
  outward: number;
  time: number;
}) {
  const { tips } = handPoseAt(frames, time);
  // +x in a hand keyframe is towards the little finger, which is outward for a palm facing away.
  const toX = (x: number) => CENTER_X + outward * x * HAND_SCALE;
  const toY = (y: number) => HAND_WRIST_Y - y * HAND_SCALE;
  const palm = [HAND_KNUCKLES[1], HAND_KNUCKLES[4], { x: 0.22, y: 0 }, { x: -0.25, y: 0 }];

  return (
    <>
      <polygon
        points={palm.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ")}
        fill="var(--color-primary)"
        fillOpacity={0.15}
        stroke="var(--color-muted)"
        strokeWidth={6}
        strokeLinejoin="round"
      />
      {tips.map((tip, index) => (
        <line
          key={index}
          x1={toX(HAND_KNUCKLES[index].x)}
          y1={toY(HAND_KNUCKLES[index].y)}
          x2={toX(tip.x)}
          y2={toY(tip.y)}
          stroke={index === 0 ? "var(--color-primary)" : "var(--color-accent)"}
          strokeWidth={14}
          strokeLinecap="round"
        />
      ))}
    </>
  );
}

/** A looping demo, with outward on the same side as the mirrored camera view. */
export function DemoFigure({ demo, affectedSide }: { demo: ExerciseDemo; affectedSide: Side }) {
  const time = useLoopTime();
  const outward = affectedSide === "left" ? -1 : 1;

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={t(demo.kind === "arm" ? "warmup.demo.label" : "warmup.demo.handLabel")}
      className="w-full max-h-[50dvh]"
    >
      {demo.kind === "arm" ? (
        <ArmFigure frames={demo.keyframes} outward={outward} time={time} />
      ) : (
        <HandFigure frames={demo.keyframes} outward={outward} time={time} />
      )}
    </svg>
  );
}
