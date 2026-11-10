import { clamp01, isTyping, LevelListeners, type LevelSource } from "./types";

/** Holding the key takes the level from 0 to 1 in this time. */
export const KEYBOARD_RISE_MS = 300;
/** Releasing the key takes the level from 1 to 0 in this time. */
export const KEYBOARD_FALL_MS = 200;

export interface KeyboardSourceOptions {
  now?: () => number;
  /** The KeyboardEvent.code to hold: "Space" (squeeze) by default, "KeyO" to open the hand. */
  code?: string;
}

/**
 * For testing without a camera: holding a key (Space by default) raises the level. The level is
 * worked out from the time, so getLevel() is exact whenever it is called; start() also sends it to
 * listeners every frame.
 */
export class KeyboardSource implements LevelSource<"keyboard"> {
  readonly id = "keyboard";
  readonly labelKey = "input.source.keyboard";
  readonly code: string;
  private readonly now: () => number;
  private readonly listeners = new LevelListeners();
  private pressed = false;
  /** The level when Space was last pressed or released, and when that was. */
  private fromLevel = 0;
  private fromTime = 0;
  private lastEmitted: number | null = null;
  private frameId: number | null = null;
  private running = false;

  constructor({ now = () => performance.now(), code = "Space" }: KeyboardSourceOptions = {}) {
    this.now = now;
    this.code = code;
  }

  isReady(): boolean {
    return true;
  }

  getLevel(at: number = this.now()): number {
    const elapsed = Math.max(0, at - this.fromTime);
    return this.pressed
      ? clamp01(this.fromLevel + elapsed / KEYBOARD_RISE_MS)
      : clamp01(this.fromLevel - elapsed / KEYBOARD_FALL_MS);
  }

  /** The key pressed. Repeats while it is held change nothing. */
  press(at: number = this.now()): void {
    if (this.pressed) return;
    this.fromLevel = this.getLevel(at);
    this.fromTime = at;
    this.pressed = true;
  }

  release(at: number = this.now()): void {
    if (!this.pressed) return;
    this.fromLevel = this.getLevel(at);
    this.fromTime = at;
    this.pressed = false;
  }

  /** Sends the level to listeners if it has changed since the last time. */
  tick(at: number = this.now()): void {
    const level = this.getLevel(at);
    if (level === this.lastEmitted) return;
    this.lastEmitted = level;
    this.listeners.emit(level);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    const loop = () => {
      this.tick();
      this.frameId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.pressed = false;
    this.fromLevel = 0;
    this.fromTime = this.now();
    this.tick();
  }

  subscribe(listener: (level: number) => void): () => void {
    return this.listeners.add(listener);
  }

  // Space would otherwise scroll the page or press whichever button has focus.
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== this.code || isTyping(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    this.press();
  };

  // A release always counts, so a key let go in a text field never stays held.
  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (event.code !== this.code) return;
    event.preventDefault();
    this.release();
  };

  /** A key released in another window never reaches this one. */
  private readonly onBlur = () => this.release();
}
