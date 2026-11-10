import type { ActivationSourceId, LevelSource } from "./types";

export const DEFAULT_SOURCE_ID: ActivationSourceId = "cv_grip";
const KEYBOARD_ID = "keyboard";

export interface LevelSnapshot<Id extends string = ActivationSourceId> {
  sourceId: Id;
  level: number;
  ready: boolean;
}

export type ActivationSnapshot = LevelSnapshot<ActivationSourceId>;

type SnapshotListener<Id extends string> = (snapshot: LevelSnapshot<Id>) => void;

/**
 * Holds every source of one kind of level (activation or openness) and runs the chosen one. Games
 * read getLevel() from the manager, so changing the source never touches a game.
 */
export class InputManager<Id extends string = ActivationSourceId> {
  private readonly sources: ReadonlyMap<Id, LevelSource<Id>>;
  private readonly listeners = new Set<SnapshotListener<Id>>();
  private activeId: Id;
  /** The source to go back to when keyboard input is turned off. */
  private previousId: Id;
  private running = false;
  private unsubscribeSource: (() => void) | null = null;

  /** Without an initial id, an activation manager starts on the camera grip. */
  constructor(sources: readonly LevelSource<Id>[], initial: Id = DEFAULT_SOURCE_ID as Id) {
    this.sources = new Map(sources.map((source) => [source.id, source]));
    if (!this.sources.has(initial)) throw new Error(`No input source "${initial}"`);
    this.activeId = initial;
    this.previousId = initial;
  }

  get sourceId(): Id {
    return this.activeId;
  }

  get source(): LevelSource<Id> {
    return this.sources.get(this.activeId) as LevelSource<Id>;
  }

  get keyboardActive(): boolean {
    return this.activeId === KEYBOARD_ID;
  }

  getLevel(): number {
    return this.source.getLevel();
  }

  isReady(): boolean {
    return this.source.isReady();
  }

  snapshot(): LevelSnapshot<Id> {
    return { sourceId: this.activeId, level: this.getLevel(), ready: this.isReady() };
  }

  /** Does nothing for a source the manager does not have. */
  select(id: Id): void {
    if (id === this.activeId || !this.sources.has(id)) return;
    if (this.running) this.detach();
    if (id === KEYBOARD_ID) this.previousId = this.activeId;
    this.activeId = id;
    if (this.running) this.attach();
    this.emit();
  }

  /** Keyboard input on, or back to the source used before it. */
  toggleKeyboard(): void {
    this.select(this.keyboardActive ? this.previousId : (KEYBOARD_ID as Id));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attach();
    this.emit();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.detach();
  }

  subscribe(listener: SnapshotListener<Id>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private attach(): void {
    const source = this.source;
    this.unsubscribeSource = source.subscribe(() => this.emit());
    source.start();
  }

  private detach(): void {
    this.unsubscribeSource?.();
    this.unsubscribeSource = null;
    this.source.stop();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
