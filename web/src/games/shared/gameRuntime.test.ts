import { describe, expect, it } from "vitest";

import { COUNTDOWN_STEP_MS, GameRuntime, RESUME_DELAY_MS } from "./gameRuntime";
import { STEP_MS } from "./fixedTimestep";
import type { GameInstance } from "./types";

/** A game that records what the runtime asks of it, and finishes after `length` ms. */
function fakeGame(length = Infinity) {
  const log: string[] = [];
  const updates: number[] = [];
  let startedAt: number | null = null;
  const game: GameInstance = {
    start: () => log.push("start"),
    update: (_dt, now) => {
      startedAt ??= now;
      updates.push(now);
    },
    render: () => {},
    pause: () => log.push("pause"),
    resume: () => log.push("resume"),
    isFinished: () => startedAt !== null && (updates.at(-1) ?? 0) - startedAt >= length,
    getSummary: () => ({
      score: 0,
      trialsDone: 0,
      trialsPlanned: 1,
      summary: {
        successes: 0,
        success_rate: 0,
        mean_movement_ms: null,
        mean_path_efficiency: null,
        compensated_trials: 0,
      },
    }),
    destroy: () => {},
  };
  return { game, log, updates };
}

const OK = { handPresent: true, hidden: false };
const NO_HAND = { handPresent: false, hidden: false };

/** Frames every 16 ms from `from`, and always one exactly at `to`. */
function play(runtime: GameRuntime, from: number, to: number, conditions = OK) {
  for (let t = from; t < to; t += 16) runtime.frame(t, conditions);
  runtime.frame(to, conditions);
}

describe("GameRuntime", () => {
  it("counts down 3, 2, 1 before starting the game", () => {
    const { game, log } = fakeGame();
    const counts: number[] = [];
    const runtime = new GameRuntime(game, { onCountdown: (count) => counts.push(count) });
    play(runtime, 0, 3 * COUNTDOWN_STEP_MS - 20);
    expect(counts).toEqual([3, 2, 1]);
    expect(runtime.stage).toBe("countdown");
    expect(log).toEqual([]);

    runtime.frame(3 * COUNTDOWN_STEP_MS, OK);
    expect(runtime.stage).toBe("playing");
    expect(log).toEqual(["start"]);
  });

  it("updates at 60 Hz while playing", () => {
    const { game, updates } = fakeGame();
    const runtime = new GameRuntime(game);
    play(runtime, 0, 3000);
    play(runtime, 3016, 4000);
    expect(updates.length).toBeGreaterThanOrEqual(58);
    expect(updates.length).toBeLessThanOrEqual(60);
    expect(updates[1] - updates[0]).toBeCloseTo(STEP_MS);
  });

  it("pauses when the hand is lost and carries on 1 second after it returns", () => {
    const { game, log } = fakeGame();
    const runtime = new GameRuntime(game);
    play(runtime, 0, 3000);
    runtime.frame(3100, NO_HAND);
    expect(runtime.stage).toBe("paused");
    expect(runtime.pauseReason).toBe("hand");

    runtime.frame(4000, OK);
    runtime.frame(4000 + RESUME_DELAY_MS - 10, OK);
    expect(runtime.stage).toBe("paused");
    runtime.frame(4000 + RESUME_DELAY_MS, OK);
    expect(runtime.stage).toBe("playing");
    expect(log).toEqual(["start", "pause", "resume"]);
  });

  it("waits a full second again if the hand disappears while resuming", () => {
    const { game } = fakeGame();
    const runtime = new GameRuntime(game);
    play(runtime, 0, 3000);
    runtime.frame(3100, NO_HAND);
    runtime.frame(4000, OK);
    runtime.frame(4600, NO_HAND);
    runtime.frame(4700, OK);
    runtime.frame(5100, OK);
    expect(runtime.stage).toBe("paused");
    runtime.frame(5700, OK);
    expect(runtime.stage).toBe("playing");
  });

  it("pauses while the tab is hidden", () => {
    const { game } = fakeGame();
    const runtime = new GameRuntime(game);
    play(runtime, 0, 3000);
    runtime.frame(3100, { handPresent: true, hidden: true });
    expect(runtime.pauseReason).toBe("hidden");
  });

  it("does not resume a pause the patient chose by itself", () => {
    const { game } = fakeGame();
    const runtime = new GameRuntime(game);
    play(runtime, 0, 3000);
    runtime.pause("manual", 3100);
    play(runtime, 3116, 8000);
    expect(runtime.stage).toBe("paused");
    runtime.resume(8000);
    expect(runtime.stage).toBe("playing");
  });

  it("leaves time spent paused out of game time", () => {
    const { game, updates } = fakeGame();
    const runtime = new GameRuntime(game);
    play(runtime, 0, 3000);
    play(runtime, 3016, 3500);
    const beforePause = updates.at(-1) as number;
    runtime.pause("manual", 3500);
    runtime.resume(13500);
    runtime.frame(13516, OK);
    expect((updates.at(-1) as number) - beforePause).toBeLessThan(50);
    expect(runtime.toGameTime(13516)).toBeCloseTo(3516);
    expect(runtime.elapsedMs(13516)).toBeCloseTo(516, 0);
  });

  it("finishes once the game says so", () => {
    const { game } = fakeGame(500);
    const finished: boolean[] = [];
    const runtime = new GameRuntime(game, { onFinish: (completed) => finished.push(completed) });
    play(runtime, 0, 3000);
    play(runtime, 3016, 4000);
    expect(runtime.stage).toBe("finished");
    expect(finished).toEqual([true]);
  });

  it("ends early from the pause screen", () => {
    const { game } = fakeGame();
    const finished: boolean[] = [];
    const runtime = new GameRuntime(game, { onFinish: (completed) => finished.push(completed) });
    play(runtime, 0, 3000);
    runtime.pause("manual", 3100);
    runtime.end();
    runtime.end();
    expect(runtime.stage).toBe("finished");
    expect(finished).toEqual([false]);
  });
});
