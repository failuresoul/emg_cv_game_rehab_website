import type { ActivationSource, ActivationSourceId } from "./types";

export const DEFAULT_SOURCE_ID: ActivationSourceId = "cv_grip";

export interface ActivationSnapshot {
  sourceId: ActivationSourceId;
  level: number;
  ready: boolean;
}

type SnapshotListener = (snapshot: ActivationSnapshot) => void;

/**
 * Holds every source and runs the chosen one. Games read getLevel() from the manager, so changing
 * the source never touches a game.
 */
export class InputManager {
  private readonly sources: ReadonlyMap<ActivationSourceId, ActivationSource>;
  private readonly listeners = new Set<SnapshotListener>();
  private activeId: ActivationSourceId;
  /** The source to go back to when keyboard input is turned off. */
  private previousId: ActivationSourceId;
  private running = false;
  private unsubscribeSource: (() => void) | null = null;

  constructor(
    sources: readonly ActivationSource[],
    initial: ActivationSourceId = DEFAULT_SOURCE_ID,
  ) {
    this.sources = new Map(sources.map((source) => [source.id, source]));
    if (!this.sources.has(initial)) throw new Error(`No activation source "${initial}"`);
    this.activeId = initial;
    this.previousId = initial;
  }

  get sourceId(): ActivationSourceId {
    return this.activeId;
  }

  get source(): ActivationSource {
    return this.sources.get(this.activeId) as ActivationSource;
  }

  get keyboardActive(): boolean {
    return this.activeId === "keyboard";
  }

  getLevel(): number {
    return this.source.getLevel();
  }

  isReady(): boolean {
    return this.source.isReady();
  }

  snapshot(): ActivationSnapshot {
    return { sourceId: this.activeId, level: this.getLevel(), ready: this.isReady() };
  }

  /** Does nothing for a source the manager does not have. */
  select(id: ActivationSourceId): void {
    if (id === this.activeId || !this.sources.has(id)) return;
    if (this.running) this.detach();
    if (id === "keyboard") this.previousId = this.activeId;
    this.activeId = id;
    if (this.running) this.attach();
    this.emit();
  }

  /** Keyboard input on, or back to the source used before it. */
  toggleKeyboard(): void {
    this.select(this.keyboardActive ? this.previousId : "keyboard");
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

  subscribe(listener: SnapshotListener): () => void {
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
