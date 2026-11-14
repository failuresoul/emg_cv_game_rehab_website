// The part of the app's test hooks (src/testing/testMode.ts) the end-to-end tests use; the
// tests run in Node, outside the app's own types.
interface Window {
  __muviTest?: {
    currentTarget: { phase: string; pointSw: { x: number; y: number } | null } | null;
    game: { stage: string } | null;
    vision: {
      play(script: unknown): void;
      playRecording(name: string, options?: { loop?: boolean }): Promise<void>;
      clear(): void;
      source(): string;
      framesEmitted(): number;
    };
    emg: { setLevel(level: number | null): void };
  };
}
