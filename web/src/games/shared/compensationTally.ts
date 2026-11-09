import type { TrialCompensation } from "@/types/api";
import type { CompensationValues } from "@/warmup/compensation";
import type { CompensationType } from "@/warmup/compensationConfig";

/** Compensation seen while reaching: the kinds held long enough to count, and the largest values. */
export class CompensationTally {
  private readonly types = new Set<CompensationType>();
  private max: CompensationValues | null = null;

  add(sustained: readonly CompensationType[], values: CompensationValues | null): void {
    sustained.forEach((type) => this.types.add(type));
    if (!values) return;
    this.max = this.max
      ? {
          trunkDisplacement: Math.max(this.max.trunkDisplacement, values.trunkDisplacement),
          trunkLeanDeg: Math.max(this.max.trunkLeanDeg, values.trunkLeanDeg),
          shoulderHike: Math.max(this.max.shoulderHike, values.shoulderHike),
        }
      : { ...values };
  }

  toRecord(): TrialCompensation {
    const types = (["trunk", "lean", "shoulder"] as const).filter((type) => this.types.has(type));
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      flagged: types.length > 0,
      type: types.length > 0 ? types.join("+") : null,
      max_values: this.max
        ? {
            trunk_displacement_sw: round(this.max.trunkDisplacement),
            trunk_lean_deg: round(this.max.trunkLeanDeg),
            shoulder_hike_sw: round(this.max.shoulderHike),
          }
        : {},
    };
  }
}
