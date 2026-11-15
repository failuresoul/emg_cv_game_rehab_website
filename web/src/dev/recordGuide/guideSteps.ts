// Development only (the guided recorder, /dev/record-guide). Plain English, like the other lab
// pages: nothing here reaches the production build.
import type { Finger } from "@/input/fingerTouch";

export type GuideIcon =
  | "still"
  | "arrow"
  | "raiseForward"
  | "raiseSideways"
  | "elbow"
  | "hand"
  | "thumb"
  | "pinch"
  | "lean";

/** One part of a step, such as one direction or one repetition. */
export interface GuideBeat {
  /** Shown big on the panel: "Up-right", "2 / 3"... */
  label: string;
  ms: number;
  /** The direction to reach, in screen degrees: 0 right, 90 up. */
  directionDeg?: number;
  /** The finger to touch with the thumb. */
  finger?: Finger;
}

export interface GuideStep {
  id: string;
  name: string;
  /** One short sentence on the panel. */
  instruction: string;
  /** Read aloud during the 3-2-1 countdown. */
  voice: string;
  icon: GuideIcon;
  beats: GuideBeat[];
}

const repeat = (count: number, ms: number): GuideBeat[] =>
  Array.from({ length: count }, (_, index) => ({ label: `${index + 1} / ${count}`, ms }));

const DIRECTIONS: [string, number][] = [
  ["Right", 0],
  ["Up-right", 45],
  ["Up", 90],
  ["Up-left", 135],
  ["Left", 180],
  ["Down-left", 225],
  ["Down", 270],
  ["Down-right", 315],
];

const FINGER_ORDER: [Finger, string][] = [
  ["index", "Index"],
  ["middle", "Middle"],
  ["ring", "Ring"],
  ["little", "Little"],
];

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "still_start",
    name: "Sit still",
    instruction: "Sit still with your arm resting.",
    voice: "Sit still, with your arm resting.",
    icon: "still",
    beats: [{ label: "Stay still", ms: 5000 }],
  },
  {
    id: "reach_8",
    name: "Reach in 8 directions",
    instruction: "Reach towards the arrow, hold for a second, then come back.",
    voice: "Reach towards each arrow, hold for one second, and come back.",
    icon: "arrow",
    beats: DIRECTIONS.map(([label, directionDeg]) => ({ label, ms: 3000, directionDeg })),
  },
  {
    id: "raise_forward",
    name: "Raise forward",
    instruction: "Raise your arm forward to shoulder height, then lower it.",
    voice: "Raise your arm forward to shoulder height, and lower it. Three times.",
    icon: "raiseForward",
    beats: repeat(3, 4000),
  },
  {
    id: "raise_sideways",
    name: "Raise sideways",
    instruction: "Raise your arm out to the side, then lower it.",
    voice: "Raise your arm out to the side, and lower it. Three times.",
    icon: "raiseSideways",
    beats: repeat(3, 4000),
  },
  {
    id: "elbow",
    name: "Bend the elbow",
    instruction: "Bend and straighten your elbow; keep the upper arm still.",
    voice: "Bend and straighten your elbow, keeping your upper arm still. Ten times.",
    icon: "elbow",
    beats: repeat(10, 3000),
  },
  {
    id: "hand_open_close",
    name: "Open and close the hand",
    instruction: "Open your hand wide, then make a fist.",
    voice: "Open your hand wide, then make a fist. Ten times.",
    icon: "hand",
    beats: repeat(10, 2000),
  },
  {
    id: "thumb_touch",
    name: "Thumb to each finger",
    instruction: "Touch your thumb to the finger shown.",
    voice: "Touch your thumb to each finger in turn. Two rounds.",
    icon: "thumb",
    beats: [0, 1].flatMap((round) =>
      FINGER_ORDER.map(([finger, name]) => ({
        label: `${name} (round ${round + 1})`,
        ms: 1500,
        finger,
      })),
    ),
  },
  {
    id: "pinch_carry",
    name: "Pinch, move, release",
    instruction: "Pinch thumb and index, move your hand, then let go.",
    voice: "Pinch your thumb and index finger, move your hand, and let go. Three times.",
    icon: "pinch",
    beats: repeat(3, 4000),
  },
  {
    id: "lean",
    name: "Lean forward and back",
    instruction: "Lean your body forward, then sit back up.",
    voice: "Lean your body forward, and sit back up. Two times.",
    icon: "lean",
    beats: repeat(2, 5000),
  },
  {
    id: "still_end",
    name: "Sit still",
    instruction: "Sit still with your arm resting.",
    voice: "Last one. Sit still, with your arm resting.",
    icon: "still",
    beats: [{ label: "Stay still", ms: 5000 }],
  },
];

export function stepDurationMs(step: GuideStep): number {
  return step.beats.reduce((total, beat) => total + beat.ms, 0);
}
