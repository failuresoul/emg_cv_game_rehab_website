import type { ActivationSourceId, LevelSource } from "./types";

export const DEFAULT_SOURCE_ID: ActivationSourceId = "cv_grip";
const KEYBOARD_ID = "keyboard";

export interface LevelSnapshot<Id extends string = ActivationSourceId> {
  /** The source in use now: the chosen one, or its fallback while the chosen one is not ready. */
  sourceId: Id;
  level: number;
  ready: boolean;
  /** The source chosen (by priority or the K key). */
  selectedId?: Id;
  /** True while the chosen source is paused and its fallback is used instead. */
  fallback?: boolean;
}

export type ActivationSnapshot = LevelSnapshot<ActivationSourceId>;

type SnapshotListener<Id extends string> = (snapshot: LevelSnapshot<Id>) => void;

/**
 * Holds every source of one kind of level (activation or openness) and runs the chosen one. Games
 * read getLevel() from the manager, so changing the source never touches a game.
 *
 * A source may have a fallback (the muscle sensor falls back to the camera): while the chosen
 * source is not ready, the fallback is used, and the chosen one again as soon as it is ready.
 * Both run, so the switch is immediate either way.
 */
export class InputManager<Id extends string = ActivationSourceId> {
  private readonly sources: ReadonlyMap<Id, LevelSource<Id>>;
  private readonly listeners = new Set<SnapshotListener<Id>>();
  private activeId: Id;
  /** The source to go back to when keyboard input is turned off. */
  private previousId: Id;
  private running = false;
  private unsubscribeSource: (() => void) | null = null;
  private readonly fallbacks: Partial<Record<Id, Id>>;

  /** Without an initial id, an activation manager starts on the camera grip. */
  constructor(
    sources: readonly LevelSource<Id>[],
    initial: Id = DEFAULT_SOURCE_ID as Id,
    fallbacks: Partial<Record<Id, Id>> = {},
  ) {
    this.sources = new Map(sources.map((source) => [source.id, source]));
    if (!this.sources.has(initial)) throw new Error(`No input source "${initial}"`);
    this.activeId = initial;
    this.previousId = initial;
    this.fallbacks = fallbacks;
  }

  /** The source chosen (it may be paused; see effectiveId). */
  get sourceId(): Id {
    return this.activeId;
  }

  /** The source in use now: the chosen one, or its fallback while it is not ready. */
  get effectiveId(): Id {
    const fallback = this.fallbacks[this.activeId];
    if (fallback && this.sources.has(fallback) && !this.chosen.isReady()) return fallback;
    return this.activeId;
  }

  /** True while the chosen source is paused and its fallback is in use. */
  get usingFallback(): boolean {
    return this.effectiveId !== this.activeId;
  }

  private get chosen(): LevelSource<Id> {
    return this.sources.get(this.activeId) as LevelSource<Id>;
  }

  get source(): LevelSource<Id> {
    return this.sources.get(this.effectiveId) as LevelSource<Id>;
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
    const effective = this.effectiveId;
    return {
      sourceId: effective,
      level: this.getLevel(),
      ready: this.isReady(),
      selectedId: this.activeId,
      fallback: effective !== this.activeId,
    };
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

  /** The chosen source, and its fallback when it has one: both run. */
  private runningSources(): LevelSource<Id>[] {
    const fallback = this.fallbacks[this.activeId];
    const ids =
      fallback && this.sources.has(fallback) ? [this.activeId, fallback] : [this.activeId];
    return ids.map((id) => this.sources.get(id) as LevelSource<Id>);
  }

  private attach(): void {
    const sources = this.runningSources();
    const unsubscribes = sources.map((source) => source.subscribe(() => this.emit()));
    this.unsubscribeSource = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    sources.forEach((source) => source.start());
  }

  private detach(): void {
    this.unsubscribeSource?.();
    this.unsubscribeSource = null;
    this.runningSources().forEach((source) => source.stop());
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
