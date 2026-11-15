// Development only (/dev/angle-validation, Day 19): MediaPipe's joint angles averaged over a short
// window, in the clinical convention a phone clinometer reads:
// - elbow: flexion, 0 = straight (180 minus the app's angle at the elbow), with the upper arm
//   hanging so the clinometer on the forearm reads the same angle;
// - shoulder_flexion and shoulder_abduction: the upper arm's angle from hanging down.
// 3D uses the world landmarks; 2D the image landmarks only (as without depth).

import type { Side } from "@/types/api";
import { computeJointAngles, type AngleMeasure, type JointAngleInput } from "@/vision/angles";

export const JOINTS = ["elbow", "shoulder_flexion", "shoulder_abduction"] as const;
export type Joint = (typeof JOINTS)[number];

export interface AngleRow {
  id: string;
  joint: Joint;
  reference_deg: number;
  mp3d_deg: number | null;
  mp2d_deg: number | null;
  visibility: number | null;
  timestamp: string;
}

function clinical(joint: Joint, measure: AngleMeasure | null): number | null {
  if (!measure) return null;
  return joint === "elbow" ? 180 - measure.value : measure.value;
}

function pick(
  joint: Joint,
  input: JointAngleInput,
  side: Side,
): { value: number | null; visibility: number | null } {
  const angles = computeJointAngles(input, side);
  const measure = joint === "elbow" ? angles.elbowFlexionDeg : angles.armElevationDeg;
  return { value: clinical(joint, measure), visibility: measure?.confidence ?? null };
}

/** Collects one frame at a time; mean() gives the averages over everything collected. */
export class AngleSampler {
  private readonly joint: Joint;
  private readonly side: Side;
  private readonly values3d: number[] = [];
  private readonly values2d: number[] = [];
  private readonly visibilities: number[] = [];

  constructor(joint: Joint, side: Side) {
    this.joint = joint;
    this.side = side;
  }

  add(input: JointAngleInput): void {
    if (input.poseWorld) {
      const world = pick(this.joint, input, this.side);
      if (world.value !== null) this.values3d.push(world.value);
      if (world.visibility !== null) this.visibilities.push(world.visibility);
    }
    const flat = pick(this.joint, { ...input, poseWorld: null }, this.side);
    if (flat.value !== null) this.values2d.push(flat.value);
  }

  get frames(): number {
    return Math.max(this.values3d.length, this.values2d.length);
  }

  mean(): { mp3d_deg: number | null; mp2d_deg: number | null; visibility: number | null } {
    const average = (values: number[]) =>
      values.length
        ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
        : null;
    return {
      mp3d_deg: average(this.values3d),
      mp2d_deg: average(this.values2d),
      visibility: average(this.visibilities),
    };
  }
}

const COLUMNS = [
  "joint",
  "reference_deg",
  "mp3d_deg",
  "mp2d_deg",
  "visibility",
  "timestamp",
] as const;

/** The file run_validation.py reads as analysis/validation/angles.csv. */
export function anglesCsv(rows: readonly AngleRow[]): string {
  const cell = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  return (
    [
      COLUMNS.join(","),
      ...rows.map((row) => COLUMNS.map((column) => cell(row[column])).join(",")),
    ].join("\n") + "\n"
  );
}

export const ANGLE_ROWS_KEY = "muvi-dev-angle-validation";

export function loadRows(storage: Pick<Storage, "getItem"> | null): AngleRow[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(ANGLE_ROWS_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as AngleRow[]) : [];
  } catch {
    return [];
  }
}

export function saveRows(
  storage: Pick<Storage, "setItem"> | null,
  rows: readonly AngleRow[],
): void {
  try {
    storage?.setItem(ANGLE_ROWS_KEY, JSON.stringify(rows));
  } catch {
    // Storage full or blocked: the rows stay on the page until it is closed.
  }
}
