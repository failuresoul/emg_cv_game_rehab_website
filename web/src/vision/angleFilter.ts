import type { JointAngles } from "./angles";
import type { HandMeasures } from "./hand";
import { median } from "./geometry";

const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.4;

/**
 * For counting repetitions only. Saved data must use raw values.
 * A 5-frame median removes single spikes, then a moving average steadies what is left.
 */
export class AngleFilter {
  private readonly window: number[] = [];
  private average: number | null = null;

  /** A missing value clears the history, so old values do not leak in after a gap. */
  add(value: number | null): number | null {
    if (value === null || !Number.isFinite(value)) {
      this.reset();
      return null;
    }
    this.window.push(value);
    if (this.window.length > MEDIAN_WINDOW) this.window.shift();

    const middle = median(this.window);
    this.average =
      this.average === null ? middle : this.average + EMA_ALPHA * (middle - this.average);
    return this.average;
  }

  reset(): void {
    this.window.length = 0;
    this.average = null;
  }
}

export interface FilteredAngles {
  armElevationDeg: number | null;
  elevationPlaneDeg: number | null;
  elbowFlexionDeg: number | null;
  forwardReachRatio: number | null;
}

export class JointAngleFilter {
  private readonly elevation = new AngleFilter();
  private readonly plane = new AngleFilter();
  private readonly elbow = new AngleFilter();
  private readonly reach = new AngleFilter();

  add(angles: JointAngles): FilteredAngles {
    return {
      armElevationDeg: this.elevation.add(angles.armElevationDeg?.value ?? null),
      elevationPlaneDeg: this.plane.add(angles.elevationPlaneDeg?.value ?? null),
      elbowFlexionDeg: this.elbow.add(angles.elbowFlexionDeg?.value ?? null),
      forwardReachRatio: this.reach.add(angles.forwardReachRatio?.value ?? null),
    };
  }
}

export interface FilteredHand {
  handApertureRatio: number | null;
  /** Index, middle, ring and little finger; null unless all four are known. */
  thumbFingerDistances: [number, number, number, number] | null;
}

/** The same filtering for the hand. Each distance is filtered on its own. */
export class HandFilter {
  private readonly aperture = new AngleFilter();
  private readonly distances = [
    new AngleFilter(),
    new AngleFilter(),
    new AngleFilter(),
    new AngleFilter(),
  ] as const;

  add(hand: HandMeasures | null): FilteredHand {
    const handApertureRatio = this.aperture.add(hand?.handApertureRatio ?? null);
    const [index, middle, ring, little] = this.distances.map((filter, position) =>
      filter.add(hand?.thumbFingerDistances[position] ?? null),
    );
    const thumbFingerDistances =
      index !== null && middle !== null && ring !== null && little !== null
        ? ([index, middle, ring, little] as [number, number, number, number])
        : null;
    return { handApertureRatio, thumbFingerDistances };
  }
}
