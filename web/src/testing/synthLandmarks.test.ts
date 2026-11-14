import { describe, expect, it } from "vitest";

import type { Side } from "@/types/api";
import { angleBetween, computeJointAngles } from "@/vision/angles";
import { computeHandMeasures, selectAffectedHand } from "@/vision/hand";
import { computePosture } from "@/vision/posture";
import { evaluateSetupChecks } from "@/vision/setupChecks";
import { Tracker } from "@/vision/tracking";
import type { VisionResult } from "@/vision/visionEngine";

import {
  type FeedFrame,
  generateFrames,
  minimumJerk,
  SYNTH_FRAME_HEIGHT,
  SYNTH_FRAME_WIDTH,
  type SynthScript,
  SynthPlayer,
} from "./synthLandmarks";

const SIDES: Side[] = ["left", "right"];

function result(frame: FeedFrame): VisionResult {
  return {
    timestamp: frame.t,
    hand: frame.hands[0]?.landmarks ?? null,
    hands: frame.hands,
    pose: frame.pose,
    poseWorld: frame.poseWorld,
    fps: 30,
    delegate: "GPU",
    brightness: frame.brightness,
    frameWidth: SYNTH_FRAME_WIDTH,
    frameHeight: SYNTH_FRAME_HEIGHT,
  };
}

const last = (frames: FeedFrame[]) => frames[frames.length - 1];

function angles(frame: FeedFrame, side: Side) {
  return computeJointAngles(result(frame), side);
}

function fingertipSw(frames: FeedFrame[], side: Side) {
  const tracker = new Tracker(side);
  let state = null;
  for (const frame of frames) state = tracker.process(result(frame));
  return state?.fingertipRawSw ?? null;
}

describe.each(SIDES)("synthetic landmarks, %s side", (side) => {
  it("sitting still passes the setup checks and the hand is the affected one", () => {
    const frames = generateFrames({ affectedSide: side, steps: [{ do: "still", ms: 1000 }] });
    expect(frames).toHaveLength(31);
    const frame = last(frames);
    expect(evaluateSetupChecks(result(frame), side)).toEqual({
      cameraOn: true,
      upperBodyVisible: true,
      armVisible: true,
      enoughLight: true,
    });
    expect(selectAffectedHand(result(frame), side)).not.toBeNull();
    const measured = angles(frame, side);
    expect(measured.armElevationDeg?.source).toBe("3d");
    expect(measured.armElevationDeg?.value).toBeLessThan(25);
  });

  it.each([
    ["forward", 90, 90],
    ["forward", 45, 90],
    ["sideways", 60, 0],
    ["sideways", 90, 0],
  ] as const)("raising the arm %s to %i degrees measures that", (plane, deg, planeDeg) => {
    const frames = generateFrames({
      affectedSide: side,
      steps: [{ do: "raise", plane, deg, ms: 1000, holdMs: 300 }],
    });
    const measured = angles(last(frames), side);
    expect(measured.armElevationDeg?.value).toBeCloseTo(deg, -0.5); // within 1.6 degrees
    expect(Math.abs((measured.elevationPlaneDeg?.value ?? NaN) - planeDeg)).toBeLessThan(4);
    expect(measured.elbowFlexionDeg?.value).toBeGreaterThan(175);
    if (plane === "forward" && deg === 90) {
      expect(measured.forwardReachRatio?.value).toBeGreaterThan(0.95);
    }
  });

  it("bends and straightens the elbow to the angles given", () => {
    const script: SynthScript = {
      affectedSide: side,
      steps: [
        { do: "raise", plane: "forward", deg: 70, ms: 600 },
        { do: "elbow", deg: 100, ms: 800, holdMs: 200 },
      ],
    };
    const bent = last(generateFrames(script));
    expect(angles(bent, side).elbowFlexionDeg?.value).toBeCloseTo(100, -0.5);
    expect(angles(bent, side).armElevationDeg?.value).toBeCloseTo(70, -0.5);
    const straight = last(
      generateFrames({ ...script, steps: [...script.steps, { do: "elbow", deg: 170, ms: 800 }] }),
    );
    expect(angles(straight, side).elbowFlexionDeg?.value).toBeCloseTo(170, -0.5);
  });

  it.each([
    { x: 1.0, y: 0.0 },
    { x: 0.6, y: 0.5 },
    { x: -0.4, y: 0.2 },
    { x: 0.3, y: -0.6 },
  ])("reaches the fingertip to the body-frame point (%o)", (point) => {
    const frames = generateFrames({
      affectedSide: side,
      steps: [
        { do: "still", ms: 500 },
        { do: "reach", to: point, ms: 1200, holdMs: 300 },
      ],
    });
    const tip = fingertipSw(frames, side);
    expect(tip).not.toBeNull();
    expect(Math.hypot(tip!.x - point.x, tip!.y - point.y)).toBeLessThan(0.05);
  });

  it("reaches and comes back", () => {
    const frames = generateFrames({
      affectedSide: side,
      steps: [
        { do: "still", ms: 500 },
        { do: "reach", to: { x: 0.9, y: 0.3 }, ms: 1000, holdMs: 200, back: true },
      ],
    });
    const start = fingertipSw(frames.slice(0, 15), side)!;
    const end = fingertipSw(frames, side)!;
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(0.05);
    // Halfway through the reach, minimum-jerk: about half way.
    const middle = fingertipSw(frames.slice(0, 31), side)!;
    expect(middle.x).toBeGreaterThan(start.x + 0.1);
    expect(middle.x).toBeLessThan(0.9 - 0.1);
  });

  it("opens and closes the hand to the apertures of an open hand and a fist", () => {
    const aperture = (open: number) => {
      const frame = last(
        generateFrames({ affectedSide: side, steps: [{ do: "hand", open, ms: 400 }] }),
      );
      return computeHandMeasures(frame.hands[0], SYNTH_FRAME_WIDTH, SYNTH_FRAME_HEIGHT)!
        .handApertureRatio;
    };
    const open = aperture(1);
    const half = aperture(0.5);
    const fist = aperture(0);
    expect(open).toBeGreaterThan(1.65);
    expect(open).toBeLessThan(1.95);
    expect(fist).toBeLessThan(1.25);
    expect(fist).toBeGreaterThan(0.8);
    expect(half).toBeGreaterThan(fist);
    expect(half).toBeLessThan(open);
  });

  it("touches the thumb to each finger in turn", () => {
    const player = new SynthPlayer({
      affectedSide: side,
      steps: [
        { do: "hand", open: 1, ms: 300 },
        { do: "thumbTouch", msEach: 600, holdMs: 200 },
      ],
    });
    const distancesAt = (ms: number) =>
      computeHandMeasures(player.frameAt(ms).frame.hands[0], SYNTH_FRAME_WIDTH, SYNTH_FRAME_HEIGHT)!
        .thumbFingerDistances;
    // Each finger: 1 ms to choose it, 300 ms to touch, 200 ms held, 300 ms to let go.
    for (let finger = 0; finger < 4; finger++) {
      const heldAt = 300 + finger * 801 + 1 + 300 + 100;
      const distances = distancesAt(heldAt);
      expect(distances[finger]).toBeLessThan(0.15);
      for (let other = 0; other < 4; other++) {
        if (other !== finger) expect(distances[other]).toBeGreaterThan(0.3);
      }
    }
    expect(Math.min(...distancesAt(player.durationMs + 100))).toBeGreaterThan(0.3);
  });

  it("pinches, carries the pinch to another point, and releases", () => {
    const steps: SynthScript["steps"] = [
      { do: "reach", to: { x: 0.8, y: -0.2 }, ms: 900 },
      { do: "pinch", ms: 300 },
      { do: "reach", to: { x: 0.2, y: 0.4 }, ms: 900 },
    ];
    const carried = generateFrames({ affectedSide: side, steps });
    const pinchGap = (frame: FeedFrame) =>
      computeHandMeasures(frame.hands[0], SYNTH_FRAME_WIDTH, SYNTH_FRAME_HEIGHT)!
        .thumbFingerDistances[0];
    expect(pinchGap(last(carried))).toBeLessThan(0.15);
    const tip = fingertipSw(carried, side)!;
    expect(Math.hypot(tip.x - 0.2, tip.y - 0.4)).toBeLessThan(0.06);
    const released = generateFrames({
      affectedSide: side,
      steps: [...steps, { do: "release", ms: 300 }],
    });
    expect(pinchGap(last(released))).toBeGreaterThan(0.4);
  });

  it.each([
    { forwardDeg: 15, sidewaysDeg: 0 },
    { forwardDeg: 0, sidewaysDeg: 10 },
  ])("leans the trunk (%o)", (lean) => {
    const frames = generateFrames({
      affectedSide: side,
      steps: [
        { do: "still", ms: 300 },
        { do: "lean", ...lean, ms: 800 },
      ],
    });
    const before = computePosture(result(frames[0]), side)!;
    const after = computePosture(result(last(frames)), side)!;
    const tilt = angleBetween(before.trunkVector!, after.trunkVector!);
    expect(tilt).toBeCloseTo(lean.forwardDeg + lean.sidewaysDeg, -0.5);
  });

  it("reaches the game's target, read when the step starts", () => {
    let target = { x: 0.7, y: 0.1 };
    const player = new SynthPlayer(
      {
        affectedSide: side,
        steps: [
          { do: "reach", to: "target", ms: 800, holdMs: 200 },
          { do: "reach", to: "target", ms: 800, holdMs: 200 },
        ],
      },
      { resolveTarget: () => target },
    );
    const tracker = new Tracker(side);
    let tip = null;
    for (let ms = 0; ms <= 1000; ms += player.frameMs) {
      tip = tracker.process(result(player.frameAt(ms).frame)).fingertipRawSw;
    }
    expect(Math.hypot(tip!.x - 0.7, tip!.y - 0.1)).toBeLessThan(0.05);
    target = { x: 0.2, y: 0.6 };
    for (let ms = 1000 + player.frameMs; ms <= 2000; ms += player.frameMs) {
      tip = tracker.process(result(player.frameAt(ms).frame)).fingertipRawSw;
    }
    expect(Math.hypot(tip!.x - 0.2, tip!.y - 0.6)).toBeLessThan(0.05);
  });
});

describe("synthetic streams", () => {
  it("hides the hand, then the person, for the steps' durations", () => {
    const frames = generateFrames({
      affectedSide: "left",
      steps: [
        { do: "still", ms: 300 },
        { do: "hideHand", ms: 600 },
        { do: "leave", ms: 600 },
      ],
    });
    expect(frames[5].hands).toHaveLength(1);
    expect(frames[18].hands).toHaveLength(0);
    expect(frames[18].pose).not.toBeNull();
    expect(frames[35].pose).toBeNull();
    expect(last(frames).pose).not.toBeNull();
  });

  it("loops, and is the same each time with the same seed", () => {
    const script: SynthScript = {
      affectedSide: "right",
      loop: true,
      steps: [{ do: "raise", plane: "sideways", deg: 80, ms: 500, back: true }],
    };
    const player = new SynthPlayer(script);
    expect(player.durationMs).toBe(1000);
    const first = player.frameAt(200).frame;
    const again = player.frameAt(1200).frame;
    expect(again.t).toBeCloseTo(first.t + 1000, 6);
    expect(angles(again, "right").armElevationDeg?.value).toBeCloseTo(
      angles(first, "right").armElevationDeg!.value,
      0,
    );
    expect(generateFrames(script)).toEqual(generateFrames(script));
  });

  it("rounds to 4 decimals and keeps landmarks in the frame while sitting still", () => {
    const frame = generateFrames({ affectedSide: "left", steps: [{ do: "still", ms: 100 }] })[0];
    for (const landmark of [...frame.pose!.slice(0, 25), ...frame.hands[0].landmarks]) {
      expect(Math.round(landmark.x * 10_000)).toBeCloseTo(landmark.x * 10_000, 6);
      expect(landmark.x).toBeGreaterThan(0);
      expect(landmark.x).toBeLessThan(1);
      expect(landmark.y).toBeGreaterThan(0);
      expect(landmark.y).toBeLessThan(1);
    }
  });

  it("eases with minimum jerk", () => {
    expect(minimumJerk(0)).toBe(0);
    expect(minimumJerk(0.5)).toBeCloseTo(0.5, 10);
    expect(minimumJerk(1)).toBe(1);
    expect(minimumJerk(0.1)).toBeLessThan(0.1);
  });
});
