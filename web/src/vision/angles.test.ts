import { describe, expect, it } from "vitest";

import type { Side } from "@/types/api";

import {
  angleBetween,
  ArmLengthTracker,
  computeJointAngles,
  cross,
  dot,
  type JointAngleInput,
  norm,
  normalise,
  projectOntoPlane,
  subtract,
  type Vec3,
} from "./angles";
import { POSE } from "./landmarks";

interface Arm {
  /** From the shoulder, in the person's terms: outward, up and forward, in metres. */
  elbow: [number, number, number];
  wrist: [number, number, number];
}

const ARM_LENGTH = 0.3;
const HANGING: Arm = { elbow: [0, -ARM_LENGTH, 0], wrist: [0, -2 * ARM_LENGTH, 0] };

interface PoseOptions {
  hipVisibility?: number;
  elbowVisibility?: number;
  otherShoulderVisibility?: number;
  wristVisibility?: number;
}

/**
 * World landmarks of a person facing the camera. MediaPipe's axes are x right, y down and z away
 * from the camera, and a person's own left is on the right of a raw camera image.
 */
function worldPose(side: Side, arm: Arm, options: PoseOptions = {}): JointAngleInput["poseWorld"] {
  const { hipVisibility = 1, elbowVisibility = 1, otherShoulderVisibility = 1 } = options;
  const { wristVisibility = 1 } = options;
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }));
  const shoulderY = -0.5;

  const place = (index: number, x: number, y: number, z: number, visibility: number) => {
    landmarks[index] = { x, y, z, visibility };
  };
  // Both shoulders and hips are symmetric, so only the visibility depends on the affected side.
  const affectedSign = side === "left" ? 1 : -1;
  const [leftVisibility, rightVisibility] =
    side === "left" ? [1, otherShoulderVisibility] : [otherShoulderVisibility, 1];
  place(POSE.LEFT_SHOULDER, 0.2, shoulderY, 0, leftVisibility);
  place(POSE.RIGHT_SHOULDER, -0.2, shoulderY, 0, rightVisibility);
  place(POSE.LEFT_HIP, 0.2, 0, 0, hipVisibility);
  place(POSE.RIGHT_HIP, -0.2, 0, 0, hipVisibility);

  const fromShoulder = ([outward, up, forward]: [number, number, number]) =>
    [affectedSign * (0.2 + outward), shoulderY - up, -forward] as const;
  const elbowIndex = side === "left" ? POSE.LEFT_ELBOW : POSE.RIGHT_ELBOW;
  const wristIndex = side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST;
  place(elbowIndex, ...fromShoulder(arm.elbow), elbowVisibility);
  place(wristIndex, ...fromShoulder(arm.wrist), wristVisibility);
  return landmarks;
}

function measure(side: Side, arm: Arm, options?: PoseOptions) {
  return computeJointAngles(
    { pose: null, poseWorld: worldPose(side, arm, options), frameWidth: 640, frameHeight: 480 },
    side,
  );
}

const SIDES: Side[] = ["left", "right"];

describe("vector helpers", () => {
  const x: Vec3 = { x: 1, y: 0, z: 0 };
  const y: Vec3 = { x: 0, y: 1, z: 0 };

  it("subtracts, multiplies and measures", () => {
    expect(subtract({ x: 3, y: 2, z: 1 }, { x: 1, y: 1, z: 1 })).toEqual({ x: 2, y: 1, z: 0 });
    expect(dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    expect(cross(x, y)).toEqual({ x: 0, y: 0, z: 1 });
    expect(norm({ x: 3, y: 4, z: 0 })).toBe(5);
  });

  it("normalises, leaving a zero vector alone", () => {
    expect(norm(normalise({ x: 3, y: 4, z: 12 }))).toBeCloseTo(1);
    expect(normalise({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("measures angles in degrees", () => {
    expect(angleBetween(x, y)).toBeCloseTo(90);
    expect(angleBetween(x, x)).toBeCloseTo(0);
    expect(angleBetween(x, { x: -2, y: 0, z: 0 })).toBeCloseTo(180);
    expect(angleBetween(x, { x: 0, y: 0, z: 0 })).toBeNaN();
  });

  it("projects onto a plane, for a normal of any length", () => {
    expect(projectOntoPlane({ x: 1, y: 2, z: 3 }, { x: 0, y: 5, z: 0 })).toEqual({
      x: 1,
      y: 0,
      z: 3,
    });
  });
});

describe.each(SIDES)("%s-affected arm positions", (side) => {
  it("gives about 0 elevation for a hanging arm, with no plane", () => {
    const angles = measure(side, HANGING);

    expect(angles.armElevationDeg?.value).toBeCloseTo(0);
    expect(angles.elevationPlaneDeg).toBeNull();
    expect(angles.armElevationDeg?.source).toBe("3d");
    expect(angles.armElevationDeg?.trunkReference).toBe("hip");
  });

  it("gives about 90 elevation and 0 plane sideways", () => {
    const angles = measure(side, {
      elbow: [ARM_LENGTH, 0, 0],
      wrist: [2 * ARM_LENGTH, 0, 0],
    });

    expect(angles.armElevationDeg?.value).toBeCloseTo(90);
    expect(angles.elevationPlaneDeg?.value).toBeCloseTo(0);
  });

  it("gives about 90 elevation and 90 plane forward", () => {
    const angles = measure(side, {
      elbow: [0, 0, ARM_LENGTH],
      wrist: [0, 0, 2 * ARM_LENGTH],
    });

    expect(angles.armElevationDeg?.value).toBeCloseTo(90);
    expect(angles.elevationPlaneDeg?.value).toBeCloseTo(90);
  });

  it("gives about 45 plane halfway between sideways and forward", () => {
    const part = ARM_LENGTH * Math.SQRT1_2;
    const angles = measure(side, { elbow: [part, 0, part], wrist: [2 * part, 0, 2 * part] });

    expect(angles.elevationPlaneDeg?.value).toBeCloseTo(45);
  });

  it("gives over 90 plane reaching across the body", () => {
    const part = ARM_LENGTH * Math.SQRT1_2;
    const angles = measure(side, { elbow: [-part, 0, part], wrist: [-2 * part, 0, 2 * part] });

    expect(angles.elevationPlaneDeg?.value).toBeCloseTo(135);
  });

  it("gives a negative plane reaching behind", () => {
    const angles = measure(side, { elbow: [0, 0, -ARM_LENGTH], wrist: [0, 0, -2 * ARM_LENGTH] });

    expect(angles.elevationPlaneDeg?.value).toBeCloseTo(-90);
  });

  it("gives about 180 elevation for an arm straight up, with no plane", () => {
    const angles = measure(side, { elbow: [0, ARM_LENGTH, 0], wrist: [0, 2 * ARM_LENGTH, 0] });

    expect(angles.armElevationDeg?.value).toBeCloseTo(180);
    expect(angles.elevationPlaneDeg).toBeNull();
  });

  it("gives about 180 for a straight elbow", () => {
    expect(measure(side, HANGING).elbowFlexionDeg?.value).toBeCloseTo(180);
  });

  it("gives about 90 for a right-angle elbow", () => {
    const angles = measure(side, {
      elbow: [0, -ARM_LENGTH, 0],
      wrist: [0, -ARM_LENGTH, ARM_LENGTH],
    });

    expect(angles.elbowFlexionDeg?.value).toBeCloseTo(90);
  });

  it("falls back to vertical when the hips have low visibility", () => {
    const angles = measure(
      side,
      { elbow: [ARM_LENGTH, 0, 0], wrist: [2 * ARM_LENGTH, 0, 0] },
      { hipVisibility: 0.3 },
    );

    expect(angles.armElevationDeg?.trunkReference).toBe("vertical");
    expect(angles.armElevationDeg?.value).toBeCloseTo(90);
    expect(angles.elevationPlaneDeg?.value).toBeCloseTo(0);
  });

  it("returns null for all measures when the elbow is not visible", () => {
    const angles = measure(side, HANGING, { elbowVisibility: 0.49 });

    expect(angles.armElevationDeg).toBeNull();
    expect(angles.elevationPlaneDeg).toBeNull();
    expect(angles.elbowFlexionDeg).toBeNull();
  });

  it("returns only the elbow measure as null when the wrist is not visible", () => {
    const angles = measure(side, HANGING, { wristVisibility: 0.2 });

    expect(angles.elbowFlexionDeg).toBeNull();
    expect(angles.armElevationDeg).not.toBeNull();
  });

  it("returns only the plane as null when the other shoulder is not visible", () => {
    const angles = measure(
      side,
      { elbow: [ARM_LENGTH, 0, 0], wrist: [2 * ARM_LENGTH, 0, 0] },
      { otherShoulderVisibility: 0.2 },
    );

    expect(angles.elevationPlaneDeg).toBeNull();
    expect(angles.armElevationDeg?.value).toBeCloseTo(90);
  });

  it("reports the lowest visibility of the landmarks used", () => {
    const angles = measure(side, HANGING, { elbowVisibility: 0.6, hipVisibility: 0.8 });

    expect(angles.armElevationDeg?.confidence).toBe(0.6);
  });

  it("leaves a low-visibility hip out of the confidence once it stops being used", () => {
    const angles = measure(side, HANGING, { hipVisibility: 0.1 });

    expect(angles.armElevationDeg?.confidence).toBe(1);
  });
});

describe("mirrored poses", () => {
  const part = ARM_LENGTH * Math.SQRT1_2;
  const arms: [string, Arm][] = [
    ["hanging", HANGING],
    ["sideways", { elbow: [ARM_LENGTH, 0, 0], wrist: [2 * ARM_LENGTH, 0, 0] }],
    ["forward", { elbow: [0, 0, ARM_LENGTH], wrist: [0, 0, 2 * ARM_LENGTH] }],
    ["up and forward", { elbow: [0, part, part], wrist: [0, 2 * part, 2 * part] }],
    ["bent", { elbow: [part, -part, 0], wrist: [part, -part, ARM_LENGTH] }],
  ];

  it.each(arms)("give both affected sides the same values: %s", (_, arm) => {
    const left = measure("left", arm);
    const right = measure("right", arm);

    expect(right.armElevationDeg?.value).toBeCloseTo(left.armElevationDeg?.value ?? NaN);
    expect(right.elbowFlexionDeg?.value).toBeCloseTo(left.elbowFlexionDeg?.value ?? NaN);
    if (left.elevationPlaneDeg === null) {
      expect(right.elevationPlaneDeg).toBeNull();
    } else {
      expect(right.elevationPlaneDeg?.value).toBeCloseTo(left.elevationPlaneDeg.value);
    }
  });

  it("are not fooled by a leaning trunk", () => {
    // The whole body tilts 20 degrees, with the arm still out to the person's side.
    const tilt = (20 * Math.PI) / 180;
    const rotate = ({ x, y, z, visibility }: Vec3 & { visibility: number }) => ({
      x: x * Math.cos(tilt) - y * Math.sin(tilt),
      y: x * Math.sin(tilt) + y * Math.cos(tilt),
      z,
      visibility,
    });
    const upright = worldPose("left", {
      elbow: [ARM_LENGTH, 0, 0],
      wrist: [2 * ARM_LENGTH, 0, 0],
    }) as (Vec3 & { visibility: number })[];

    const angles = computeJointAngles(
      { pose: null, poseWorld: upright.map(rotate), frameWidth: 640, frameHeight: 480 },
      "left",
    );

    expect(angles.armElevationDeg?.value).toBeCloseTo(90);
    expect(angles.elevationPlaneDeg?.value).toBeCloseTo(0);
  });
});

describe("2D fallback", () => {
  const FRAME_WIDTH = 640;
  const FRAME_HEIGHT = 480;

  /** Normalised image landmarks from pixel positions. */
  function imagePose(elbowPx: [number, number], wristPx: [number, number], hipVisibility = 1) {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }));
    const place = (index: number, [x, y]: [number, number], visibility = 1) => {
      landmarks[index] = { x: x / FRAME_WIDTH, y: y / FRAME_HEIGHT, z: 0, visibility };
    };
    place(POSE.LEFT_SHOULDER, [400, 200]);
    place(POSE.RIGHT_SHOULDER, [240, 200]);
    place(POSE.LEFT_HIP, [400, 400], hipVisibility);
    place(POSE.RIGHT_HIP, [240, 400], hipVisibility);
    place(POSE.LEFT_ELBOW, elbowPx);
    place(POSE.LEFT_WRIST, wristPx);
    return landmarks;
  }

  const compute = (pose: ReturnType<typeof imagePose>, poseWorld: JointAngleInput["poseWorld"]) =>
    computeJointAngles(
      { pose, poseWorld, frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT },
      "left",
    );

  it("is used when world landmarks are missing, and corrects the aspect ratio", () => {
    // 100 px sideways and 100 px down is 45 degrees, although the normalised values differ.
    const angles = compute(imagePose([500, 300], [600, 400]), null);

    expect(angles.armElevationDeg?.source).toBe("2d");
    expect(angles.armElevationDeg?.value).toBeCloseTo(45);
    expect(angles.elbowFlexionDeg?.source).toBe("2d");
    expect(angles.elbowFlexionDeg?.value).toBeCloseTo(180);
  });

  it("treats an empty world list as missing", () => {
    expect(compute(imagePose([500, 300], [600, 400]), []).armElevationDeg?.source).toBe("2d");
  });

  it("cannot tell the plane without depth", () => {
    expect(compute(imagePose([500, 200], [600, 200]), null).elevationPlaneDeg).toBeNull();
  });

  it("uses vertical when the hips are not visible", () => {
    const angles = compute(imagePose([500, 200], [600, 200], 0.2), null);

    expect(angles.armElevationDeg?.trunkReference).toBe("vertical");
    expect(angles.armElevationDeg?.value).toBeCloseTo(90);
  });

  it("returns nulls with no landmarks at all", () => {
    const angles = computeJointAngles(
      { pose: null, poseWorld: null, frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT },
      "left",
    );

    expect(angles.armElevationDeg).toBeNull();
    expect(angles.elbowFlexionDeg).toBeNull();
  });

  it("reads visibility from image landmarks when world landmarks have none", () => {
    const pose = imagePose([500, 300], [600, 400]);
    pose[POSE.LEFT_ELBOW].visibility = 0.1;
    const world = worldPose("left", HANGING)?.map(({ x, y, z }) => ({ x, y, z })) ?? [];

    expect(compute(pose, world).armElevationDeg).toBeNull();
  });
});

describe("bad landmarks", () => {
  const compute = (poseWorld: JointAngleInput["poseWorld"]) =>
    computeJointAngles({ pose: null, poseWorld, frameWidth: 640, frameHeight: 480 }, "left");
  const sideways: Arm = { elbow: [ARM_LENGTH, 0, 0], wrist: [2 * ARM_LENGTH, 0, 0] };

  /** A copy of the pose with one landmark changed. */
  function withLandmark(index: number, changes: Partial<Vec3 & { visibility: number }>) {
    const pose = (worldPose("left", sideways) ?? []).map((landmark) => ({ ...landmark }));
    pose[index] = { ...pose[index], ...changes };
    return pose;
  }

  it("returns null rather than NaN when the elbow's position is NaN", () => {
    const angles = compute(withLandmark(POSE.LEFT_ELBOW, { x: NaN }));

    expect(angles.armElevationDeg).toBeNull();
    expect(angles.elevationPlaneDeg).toBeNull();
    expect(angles.elbowFlexionDeg).toBeNull();
  });

  it("returns null only for the elbow measure when the wrist's position is NaN", () => {
    const angles = compute(withLandmark(POSE.LEFT_WRIST, { y: NaN }));

    expect(angles.elbowFlexionDeg).toBeNull();
    expect(angles.armElevationDeg?.value).toBeCloseTo(90);
  });

  it("treats a NaN visibility as not visible", () => {
    expect(compute(withLandmark(POSE.LEFT_ELBOW, { visibility: NaN })).armElevationDeg).toBeNull();
  });

  it("returns null when the elbow sits exactly on the shoulder", () => {
    const shoulder = (worldPose("left", sideways) ?? [])[POSE.LEFT_SHOULDER];
    const angles = compute(withLandmark(POSE.LEFT_ELBOW, { ...shoulder, visibility: 1 }));

    expect(angles.armElevationDeg).toBeNull();
    expect(angles.elbowFlexionDeg).toBeNull();
  });

  it("returns nulls for a pose missing landmarks", () => {
    const angles = compute(Array.from({ length: 12 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 })));

    expect(angles.armElevationDeg).toBeNull();
    expect(angles.elbowFlexionDeg).toBeNull();
  });

  it("uses the hip of the affected side, ignoring the other one", () => {
    const pose = withLandmark(POSE.RIGHT_HIP, { visibility: 0.1 });

    expect(compute(pose).armElevationDeg?.trunkReference).toBe("hip");
    expect(
      compute(withLandmark(POSE.LEFT_HIP, { visibility: 0.1 })).armElevationDeg?.trunkReference,
    ).toBe("vertical");
  });

  it("does not use a hip exactly at 0.5 visibility as hidden", () => {
    const angles = compute(withLandmark(POSE.LEFT_HIP, { visibility: 0.5 }));

    expect(angles.armElevationDeg?.trunkReference).toBe("hip");
  });
});

describe("forwardReachRatio", () => {
  const reach = (side: Side, arm: Arm, options?: PoseOptions) =>
    measure(side, arm, options).forwardReachRatio?.value;

  it.each(SIDES)("is about 0 with the arm hanging down (%s)", (side) => {
    // The wrist is a full arm's length from the shoulder, but none of it is forward.
    expect(reach(side, HANGING)).toBeCloseTo(0, 5);
  });

  it.each(SIDES)("is about 1 with the arm straight forward (%s)", (side) => {
    const forward: Arm = { elbow: [0, 0, ARM_LENGTH], wrist: [0, 0, 2 * ARM_LENGTH] };

    expect(reach(side, forward)).toBeCloseTo(1, 5);
  });

  it("is about 0 with the arm straight out to the side", () => {
    const sideways: Arm = { elbow: [ARM_LENGTH, 0, 0], wrist: [2 * ARM_LENGTH, 0, 0] };

    expect(reach("left", sideways)).toBeCloseTo(0, 5);
  });

  it("is about 0.5 with the forearm forward and the upper arm down", () => {
    const bent: Arm = { elbow: [0, -ARM_LENGTH, 0], wrist: [0, -ARM_LENGTH, ARM_LENGTH] };

    expect(reach("left", bent)).toBeCloseTo(0.5, 5);
  });

  it("uses the vertical when the hips are hidden, and says so", () => {
    const forward: Arm = { elbow: [0, 0, ARM_LENGTH], wrist: [0, 0, 2 * ARM_LENGTH] };
    const result = measure("left", forward, { hipVisibility: 0.1 }).forwardReachRatio;

    expect(result?.value).toBeCloseTo(1, 5);
    expect(result?.trunkReference).toBe("vertical");
    expect(result?.source).toBe("3d");
  });

  it("is null without world landmarks, without the wrist or without the other shoulder", () => {
    const flat = computeJointAngles(
      { pose: null, poseWorld: null, frameWidth: 640, frameHeight: 480 },
      "left",
    );

    expect(flat.forwardReachRatio).toBeNull();
    expect(measure("left", HANGING, { wristVisibility: 0.2 }).forwardReachRatio).toBeNull();
    expect(measure("left", HANGING, { otherShoulderVisibility: 0.2 }).forwardReachRatio).toBeNull();
  });

  it("divides by the median arm length of recent frames, ignoring one bad frame", () => {
    const tracker = new ArmLengthTracker();
    const input = (arm: Arm) => ({
      pose: null,
      poseWorld: worldPose("left", arm),
      frameWidth: 640,
      frameHeight: 480,
    });
    for (let frame = 0; frame < 10; frame++) computeJointAngles(input(HANGING), "left", tracker);

    // One frame where the arm looks twice as long, straight forward.
    const stretched: Arm = { elbow: [0, 0, 2 * ARM_LENGTH], wrist: [0, 0, 4 * ARM_LENGTH] };
    const result = computeJointAngles(input(stretched), "left", tracker).forwardReachRatio;

    expect(tracker.value()).toBeCloseTo(2 * ARM_LENGTH, 5);
    // 1.2 m forward over the usual 0.6 m arm, rather than 1.0 from this frame's own length.
    expect(result?.value).toBeCloseTo(2, 5);
  });
});

describe("ArmLengthTracker", () => {
  it("keeps the median of the last 30 valid lengths", () => {
    const tracker = new ArmLengthTracker();
    expect(tracker.value()).toBeNull();

    for (let frame = 0; frame < 30; frame++) tracker.add(0.5);
    for (let frame = 0; frame < 30; frame++) tracker.add(0.7);

    expect(tracker.value()).toBeCloseTo(0.7);
  });

  it("ignores lengths that are not positive numbers", () => {
    const tracker = new ArmLengthTracker();
    tracker.add(0.6);

    for (const bad of [0, -1, NaN, Infinity]) tracker.add(bad);

    expect(tracker.value()).toBeCloseTo(0.6);
  });
});
