import type { TrialOutcome } from "@/types/api";

import { BASKET_LINE_Y_SW, covers, fallMs } from "./lateral";

/** How long a caught fruit shows in the basket. */
export const CATCH_MS = 600;
/** How long a missed fruit rests on the ground before it fades. */
export const LANDED_MS = 800;

export type FruitPhase = "FALLING" | "CAUGHT" | "DROPPING" | "LANDED" | "DONE";

export interface FruitSetup {
  /** Where the fruit falls, along x, in SW. */
  x: number;
  /** Where it appears (the top of the play area) and where the ground is, in SW. */
  startY: number;
  groundY: number;
  speedSwS: number;
  basketWidthSw: number;
}

/** Game-time moments of one fruit; null until reached. */
export interface FruitMoments {
  spawn: number;
  /** The first time the basket was under the fruit. */
  under: number | null;
  /** When the fruit reached the basket line: caught or not. */
  end: number | null;
}

export type FruitEvent =
  | { type: "under" }
  | { type: "outcome"; outcome: TrialOutcome }
  | { type: "landed" }
  | { type: "done" };

/**
 * One fruit: it falls straight down at a steady speed. When it reaches the basket line, it is
 * caught if the basket covers its x then; otherwise it carries on and lands softly on the ground.
 * Pure: feed it the game time and the basket's centre (from the RAW fingertip) each step.
 */
export class FruitTrial {
  readonly setup: FruitSetup;
  readonly moments: FruitMoments;
  private current: FruitPhase = "FALLING";
  private result: TrialOutcome | null = null;
  private phaseEnds = 0;
  /** When it reaches the line and the ground, from spawn. */
  private readonly toLineMs: number;
  private readonly toGroundMs: number;

  constructor(setup: FruitSetup, spawnMs: number) {
    this.setup = setup;
    this.moments = { spawn: spawnMs, under: null, end: null };
    this.toLineMs = fallMs(setup.startY, BASKET_LINE_Y_SW, setup.speedSwS);
    this.toGroundMs = fallMs(setup.startY, setup.groundY, setup.speedSwS);
  }

  get phase(): FruitPhase {
    return this.current;
  }

  get outcome(): TrialOutcome | null {
    return this.result;
  }

  /** True while it is still falling towards the basket. */
  get isLive(): boolean {
    return this.current === "FALLING";
  }

  /** Where the fruit is drawn, in SW: it stops in the basket, or on the ground. */
  y(nowMs: number): number {
    const fallen = this.setup.speedSwS * (Math.max(0, nowMs - this.moments.spawn) / 1000);
    const y = this.setup.startY - fallen;
    if (this.result === "success") return BASKET_LINE_Y_SW;
    return Math.max(this.setup.groundY, y);
  }

  update(nowMs: number, basketCentre: number | null): FruitEvent[] {
    const events: FruitEvent[] = [];
    const elapsed = nowMs - this.moments.spawn;
    const covered =
      basketCentre !== null && covers(basketCentre, this.setup.basketWidthSw, this.setup.x);

    switch (this.current) {
      case "FALLING":
        if (covered && this.moments.under === null) {
          this.moments.under = nowMs;
          events.push({ type: "under" });
        }
        if (elapsed >= this.toLineMs) {
          this.moments.end = nowMs;
          this.result = covered ? "success" : "miss";
          events.push({ type: "outcome", outcome: this.result });
          if (covered) {
            this.current = "CAUGHT";
            this.phaseEnds = nowMs + CATCH_MS;
          } else {
            this.current = "DROPPING";
          }
        }
        break;
      case "DROPPING":
        if (elapsed >= this.toGroundMs) {
          this.current = "LANDED";
          this.phaseEnds = nowMs + LANDED_MS;
          events.push({ type: "landed" });
        }
        break;
      case "CAUGHT":
      case "LANDED":
        if (nowMs >= this.phaseEnds) {
          this.current = "DONE";
          events.push({ type: "done" });
        }
        break;
      default:
        break;
    }
    return events;
  }
}
