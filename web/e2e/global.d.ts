// The part of the app's test hooks (src/testing/testMode.ts) the end-to-end tests use; the
// tests run in Node, outside the app's own types.
interface Window {
  __muviTest?: {
    currentTarget: {
      phase: string;
      pointSw: { x: number; y: number } | null;
      hand: "open" | "close" | "pinch" | "release" | null;
      finger: string | null;
      level?: number | null;
    } | null;
    game: { stage: string; level: number; source: string } | null;
    vision: {
      play(script: unknown): void;
      playRecording(name: string, options?: { loop?: boolean; marker?: string }): Promise<void>;
      clear(): void;
      source(): string;
      framesEmitted(): number;
      engineStatus(): string;
    };
    emg: {
      setLevel(level: number | null): void;
      unplug(): void;
      replug(): Promise<void>;
    };
    i18n: {
      values(language: "en" | "bn"): Record<string, string>;
      language(): string;
    };
  };
}
