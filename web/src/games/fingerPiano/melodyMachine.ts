import type { Finger } from "@/input/fingerTouch";

/** A note takes this long to slide from the top of its lane to the hit line. */
export const FALL_MS = 3000;
/** How long the result of a melody shows before the rest. */
export const OUTCOME_MS = 1500;
/** A melody counts as played well with at least this share of its notes hit. */
export const SUCCESS_HIT_RATE = 0.75;

export type MelodyPhase = "PREVIEW" | "PLAY" | "OUTCOME" | "REST" | "DONE";

const LIVE_PHASES: ReadonlySet<MelodyPhase> = new Set(["PREVIEW", "PLAY"]);

/** pending until played or its window closes; then hit, wrong (only wrong fingers) or missed. */
export type NoteStatus = "pending" | "hit" | "wrong" | "missed";

export interface NoteState {
  finger: Finger;
  /** When the note reaches the hit line, in game time. */
  arrivalMs: number;
  status: NoteStatus;
  /** Touch time minus arrival for a hit: negative is early. Null otherwise. */
  errorMs: number | null;
  /** Wrong-finger touches during the note's window. */
  wrongTouches: number;
}

export interface MelodySettings {
  notes: readonly Finger[];
  noteIntervalMs: number;
  /** The whole window around each arrival: half before, half after. */
  hitWindowMs: number;
  previewMs: number;
  restMs: number;
}

export type MelodyEvent =
  | { type: "phase"; phase: MelodyPhase }
  | { type: "hit"; index: number; finger: Finger; errorMs: number }
  | { type: "wrong"; index: number; finger: Finger }
  /** A touch outside every open note's window: not counted. */
  | { type: "stray"; finger: Finger }
  | { type: "closed"; index: number; status: "wrong" | "missed" }
  | { type: "outcome"; outcome: "success" | "miss" };

/**
 * One melody: PREVIEW (the sequence is shown) → PLAY (notes slide down and reach the hit line one
 * after another) → OUTCOME → REST → DONE.
 *
 * Each touch counts once, for the earliest open note whose window it falls in, preferring a note
 * of the finger touched; so one touch never plays two notes. A touch of the right finger in the
 * window is a hit. A wrong finger is recorded against the note but does not close it: the right
 * finger can still play it before the window ends. Only touch starts count, so holding a touch
 * plays nothing more. Pure: give it touches and the time.
 */
export class MelodyMachine {
  private readonly settings: MelodySettings;
  private current: MelodyPhase = "PREVIEW";
  private readonly noteStates: NoteState[];
  private readonly half: number;
  private result: "success" | "miss" | null = null;
  private phaseEnds: number;
  readonly spawnMs: number;
  readonly playStartMs: number;

  constructor(settings: MelodySettings, spawnMs: number) {
    this.settings = settings;
    this.spawnMs = spawnMs;
    this.playStartMs = spawnMs + settings.previewMs;
    this.phaseEnds = this.playStartMs;
    this.half = settings.hitWindowMs / 2;
    this.noteStates = settings.notes.map((finger, index) => ({
      finger,
      arrivalMs: this.playStartMs + FALL_MS + index * settings.noteIntervalMs,
      status: "pending",
      errorMs: null,
      wrongTouches: 0,
    }));
  }

  get phase(): MelodyPhase {
    return this.current;
  }

  get isLive(): boolean {
    return LIVE_PHASES.has(this.current);
  }

  get notes(): readonly NoteState[] {
    return this.noteStates;
  }

  get outcome(): "success" | "miss" | null {
    return this.result;
  }

  /** The note to play next, or null once every note is done. */
  get nextNote(): NoteState | null {
    return this.noteStates.find((note) => note.status === "pending") ?? null;
  }

  /** When the melody's last window closes. */
  get lastCloseMs(): number {
    const last = this.noteStates.at(-1);
    return last ? last.arrivalMs + this.half : this.playStartMs;
  }

  /** A touch start at game time t. */
  touch(finger: Finger, t: number): MelodyEvent[] {
    if (this.current !== "PLAY" && this.current !== "PREVIEW") return [];
    const open = this.noteStates
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => note.status === "pending" && Math.abs(t - note.arrivalMs) <= this.half);
    if (open.length === 0) return [{ type: "stray", finger }];

    const match = open.find(({ note }) => note.finger === finger);
    if (match) {
      match.note.status = "hit";
      match.note.errorMs = t - match.note.arrivalMs;
      return [{ type: "hit", index: match.index, finger, errorMs: match.note.errorMs }];
    }
    const [first] = open;
    first.note.wrongTouches++;
    return [{ type: "wrong", index: first.index, finger }];
  }

  update(nowMs: number): MelodyEvent[] {
    const events: MelodyEvent[] = [];
    const go = (phase: MelodyPhase) => {
      this.current = phase;
      events.push({ type: "phase", phase });
    };

    if (this.current === "PREVIEW" && nowMs >= this.phaseEnds) go("PLAY");

    switch (this.current) {
      case "PLAY": {
        this.noteStates.forEach((note, index) => {
          if (note.status !== "pending" || nowMs <= note.arrivalMs + this.half) return;
          note.status = note.wrongTouches > 0 ? "wrong" : "missed";
          events.push({ type: "closed", index, status: note.status });
        });
        if (this.noteStates.every((note) => note.status !== "pending")) {
          const hits = this.noteStates.filter((note) => note.status === "hit").length;
          const rate = this.noteStates.length > 0 ? hits / this.noteStates.length : 0;
          this.result = rate >= SUCCESS_HIT_RATE ? "success" : "miss";
          this.phaseEnds = nowMs + OUTCOME_MS;
          events.push({ type: "outcome", outcome: this.result });
          go("OUTCOME");
        }
        break;
      }
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
}
