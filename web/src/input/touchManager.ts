import type {
  Finger,
  FingerTouchListener,
  FingerTouchSource,
  FingerTouchSourceId,
} from "./fingerTouch";

export const DEFAULT_TOUCH_SOURCE_ID: FingerTouchSourceId = "cv_touch";

/**
 * Holds every finger-touch source and runs the chosen one, passing its touches on. Switching
 * source ends a touch in progress first, so listeners never keep a touch that no source holds.
 */
export class TouchManager {
  private readonly sources: ReadonlyMap<FingerTouchSourceId, FingerTouchSource>;
  private readonly listeners = new Set<FingerTouchListener>();
  private activeId: FingerTouchSourceId;
  private running = false;
  private unsubscribeSource: (() => void) | null = null;

  constructor(
    sources: readonly FingerTouchSource[],
    initial: FingerTouchSourceId = DEFAULT_TOUCH_SOURCE_ID,
  ) {
    this.sources = new Map(sources.map((source) => [source.id, source]));
    if (!this.sources.has(initial)) throw new Error(`No touch source "${initial}"`);
    this.activeId = initial;
  }

  get sourceId(): FingerTouchSourceId {
    return this.activeId;
  }

  get source(): FingerTouchSource {
    return this.sources.get(this.activeId) as FingerTouchSource;
  }

  getTouch(): Finger | null {
    return this.source.getTouch();
  }

  isReady(): boolean {
    return this.source.isReady();
  }

  /** Sets the touch distance on every source that measures one, chosen or not. */
  setThreshold(threshold: number): void {
    this.sources.forEach((source) => source.setThreshold?.(threshold));
  }

  /** Does nothing for a source the manager does not have. */
  select(id: FingerTouchSourceId): void {
    if (id === this.activeId || !this.sources.has(id)) return;
    if (this.running) this.detach();
    this.activeId = id;
    if (this.running) this.attach();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attach();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.detach();
  }

  subscribe(listener: FingerTouchListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private attach(): void {
    this.unsubscribeSource = this.source.subscribe((event) => {
      this.listeners.forEach((listener) => listener(event));
    });
    this.source.start();
  }

  /** Stops before unsubscribing, so the touchEnd of a touch in progress still gets through. */
  private detach(): void {
    this.source.stop();
    this.unsubscribeSource?.();
    this.unsubscribeSource = null;
  }
}
