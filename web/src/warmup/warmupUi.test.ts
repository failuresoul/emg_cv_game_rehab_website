import { describe, expect, it } from "vitest";

import { poseAt, gaugeArc, gaugePoint } from "./demo";
import { EXERCISES } from "./exercises";
import { awaitingRestKey, feedbackKey, starsFor } from "./feedback";

const FRAMES = EXERCISES.shoulder_flexion.demoKeyframes;

describe("poseAt", () => {
  it("returns the keyframes at their own times", () => {
    expect(poseAt(FRAMES, 0).wrist).toEqual(FRAMES[0].wrist);
    expect(poseAt(FRAMES, 0.5).wrist).toEqual(FRAMES[2].wrist);
    expect(poseAt(FRAMES, 1).wrist).toEqual(FRAMES[4].wrist);
  });

  it("goes halfway between keyframes", () => {
    const pose = poseAt(FRAMES, 0.125);

    expect(pose.elbow.x).toBeCloseTo((FRAMES[0].elbow.x + FRAMES[1].elbow.x) / 2);
    expect(pose.elbow.y).toBeCloseTo((FRAMES[0].elbow.y + FRAMES[1].elbow.y) / 2);
  });

  it("keeps times outside the loop on the keyframes", () => {
    expect(poseAt(FRAMES, -1).wrist).toEqual(FRAMES[0].wrist);
    expect(poseAt(FRAMES, 2).wrist).toEqual(FRAMES[4].wrist);
  });
});

describe("gauge geometry", () => {
  it("places 0 on the left, 90 on top and 180 on the right", () => {
    const left = gaugePoint(0, 100, 100, 50);
    const top = gaugePoint(90, 100, 100, 50);
    const right = gaugePoint(180, 100, 100, 50);

    expect(left.x).toBeCloseTo(50);
    expect(left.y).toBeCloseTo(100);
    expect(top.x).toBeCloseTo(100);
    expect(top.y).toBeCloseTo(50);
    expect(right.x).toBeCloseTo(150);
  });

  it("keeps out-of-range angles on the semicircle", () => {
    expect(gaugePoint(-20, 100, 100, 50).y).toBeCloseTo(100);
    expect(gaugePoint(200, 100, 100, 50).x).toBeCloseTo(150);
  });

  it("draws an arc between two angles", () => {
    const start = gaugePoint(30, 100, 100, 50);
    const end = gaugePoint(90, 100, 100, 50);

    expect(gaugeArc(30, 90, 100, 100, 50)).toBe(
      `M ${start.x} ${start.y} A 50 50 0 0 1 ${end.x} ${end.y}`,
    );
  });
});

describe("starsFor", () => {
  it("gives stars for any effort", () => {
    expect(starsFor(0, 10)).toBe(0);
    expect(starsFor(1, 10)).toBe(1);
    expect(starsFor(4, 10)).toBe(1);
    expect(starsFor(5, 10)).toBe(2);
    expect(starsFor(9, 10)).toBe(2);
    expect(starsFor(10, 10)).toBe(3);
  });
});

describe("feedback words", () => {
  it("has words for every feedback", () => {
    expect(feedbackKey("good", "up")).toBe("warmup.feedback.good");
    expect(feedbackKey("higher", "up")).toBe("warmup.feedback.higher");
    expect(feedbackKey("lower", "down")).toBe("warmup.feedback.lower");
    expect(feedbackKey("almost", "up")).toBe("warmup.feedback.almost");
    expect(feedbackKey("forward", "up")).toBe("warmup.feedback.forward");
    expect(feedbackKey("sideways", "up")).toBe("warmup.feedback.sideways");
  });

  it("asks to lower the arm or straighten the elbow, depending on the exercise", () => {
    expect(feedbackKey("slow", "up")).toBe("warmup.feedback.slowDown");
    expect(feedbackKey("slow", "down")).toBe("warmup.feedback.slowStraighten");
    expect(awaitingRestKey("up")).toBe("warmup.waiting.lower");
    expect(awaitingRestKey("down")).toBe("warmup.waiting.straighten");
  });
});
