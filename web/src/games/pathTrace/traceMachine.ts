/** The start circle's radius, in SW. */
export const START_RADIUS_SW = 0.12;
/**
 * Once inside, the fingertip may drift this much past the start circle's edge (as a share of its
 * radius) before it counts as leaving, so jitter at the edge does not keep resetting the hold.
 */
export const START_LEAVE_MARGIN = 0.25;
/** A start circle not held in this time ends the trial calmly as reach_fail. */
export const START_TIMEOUT_MS = 15000;
/** How long the stars show before the rest. */
export const OUTCOME_MS = 1800;

export type TracePhase = "START" | "TRACE" | "OUTCOME" | "REST" | "DONE";

const LIVE_PHASES: ReadonlySet<TracePhase> = new Set(["START", "TRACE"]);

export interface TraceSettings {
  /** The path's length, in SW. */
  pathLengthSw: number;
  guideSpeedSwS: number;
  startHoldMs: number;
  restMs: number;
}

export interface TraceInput {
  nowMs: number;
  /** The cursor's distance from the start circle's centre, in SW; null when the hand is unseen. */
  distanceToStartSw: number | null;
}

/** Game-time moments of the trial; null until reached. */
export interface TraceMoments {
  spawn: number;
  /** The first time the cursor entered the start circle. */
  startEnter: number | null;
  /** The hold was done and the guide set off. */
  traceStart: number | null;
  /** The guide reached the end of the path. */
  traceEnd: number | null;
  end: number | null;
}

export type TraceEvent =
  | { type: "phase"; phase: TracePhase }
  | { type: "entered" }
  | { type: "left" }
  | { type: "traceDone" }
  | { type: "startTimeout" };

/**
 * One trace: START (move into the start circle and hold it) → TRACE (the guide moves along the
 * path at a steady speed) → OUTCOME → REST → DONE. Not holding the start circle within 15 s ends
 * the trial early. Pure: feed it update() with each fixed step's input; how well the patient
 * followed is measured afterwards, from the raw trajectory.
 */
export class TraceMachine {
  private readonly settings: TraceSettings;
  private current: TracePhase = "START";
  private holdStart: number | null = null;
  private holdShare = 0;
  private timedOut = false;
  private phaseEnds = 0;
  readonly moments: TraceMoments;

  constructor(settings: TraceSettings, spawnMs: number) {
    this.settings = settings;
    this.moments = {
      spawn: spawnMs,
      startEnter: null,
      traceStart: null,
      traceEnd: null,
      end: null,
    };
  }

  get phase(): TracePhase {
    return this.current;
  }

  get isLive(): boolean {
    return LIVE_PHASES.has(this.current);
  }

  /** How full the start circle's hold ring is, from 0 to 1. */
  get holdProgress(): number {
    return this.holdShare;
  }

  /** True when the start circle was never held in time. */
  get startTimedOut(): boolean {
    return this.timedOut;
  }

  /** How long the guide takes to travel the whole path. */
  get traceDurationMs(): number {
    return (this.settings.pathLengthSw / this.settings.guideSpeedSwS) * 1000;
  }

  /** How far along the path the guide is, in SW: 0 before the trace, the full length after. */
  guideDistance(nowMs: number): number {
    const start = this.moments.traceStart;
    if (start === null) return 0;
    const travelled = (this.settings.guideSpeedSwS * (nowMs - start)) / 1000;
    return Math.min(this.settings.pathLengthSw, Math.max(0, travelled));
  }

  update({ nowMs, distanceToStartSw }: TraceInput): TraceEvent[] {
    const events: TraceEvent[] = [];
    const go = (phase: TracePhase) => {
      this.current = phase;
      events.push({ type: "phase", phase });
    };

    switch (this.current) {
      case "START": {
        const radius = START_RADIUS_SW;
        const inside =
          distanceToStartSw !== null &&
          distanceToStartSw <=
            (this.holdStart === null ? radius : radius * (1 + START_LEAVE_MARGIN));
        if (inside) {
          if (this.holdStart === null) {
            this.holdStart = nowMs;
            this.moments.startEnter ??= nowMs;
            events.push({ type: "entered" });
          }
          const held = nowMs - this.holdStart;
          this.holdShare =
            this.settings.startHoldMs > 0 ? Math.min(1, held / this.settings.startHoldMs) : 1;
          if (held >= this.settings.startHoldMs) {
            this.moments.traceStart = nowMs;
            this.holdShare = 1;
            go("TRACE");
            break;
          }
        } else if (this.holdStart !== null) {
          this.holdStart = null;
          this.holdShare = 0;
          events.push({ type: "left" });
        }
        if (this.holdStart === null && nowMs - this.moments.spawn >= START_TIMEOUT_MS) {
          this.timedOut = true;
          events.push({ type: "startTimeout" });
          this.finish(nowMs, go);
        }
        break;
      }
      case "TRACE":
        if (this.guideDistance(nowMs) >= this.settings.pathLengthSw) {
          this.moments.traceEnd = nowMs;
          events.push({ type: "traceDone" });
          this.finish(nowMs, go);
        }
        break;
      case "OUTCOME":
        if (nowMs >= this.phaseEnds) {
          this.phaseEnds = nowMs + this.settings.restMs;
          go("REST");
        }
        break;
      case "REST":
        if (nowMs >= this.phaseEnds) go("DONE");
        break;
      default:
        break;
    }
    return events;
  }

  private finish(nowMs: number, go: (phase: TracePhase) => void): void {
    this.moments.end = nowMs;
    this.phaseEnds = nowMs + OUTCOME_MS;
    go("OUTCOME");
  }
}
