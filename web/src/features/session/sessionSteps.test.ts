import { describe, expect, it } from "vitest";

import type { GameId } from "@/types/api";

import {
  BAR_STEPS,
  barIndex,
  decideResume,
  firstUnfinished,
  pathForStep,
  queueFromServer,
  type ResumableSession,
  RESUME_MAX_AGE_MS,
  SESSION_STEPS,
  stepForPath,
} from "./sessionSteps";

const IDS: GameId[] = ["reach_activate", "balloon_pop", "fruit_catch"];
const NOW = Date.parse("2026-11-10T10:00:00Z");

function session(changes: Partial<ResumableSession> = {}): ResumableSession {
  return {
    id: 7,
    status: "active",
    started_at: new Date(NOW - 10 * 60 * 1000).toISOString(),
    current_step: "warmup",
    game_queue: null,
    ...changes,
  };
}

describe("stepForPath", () => {
  it("maps every session page to its step", () => {
    expect(stepForPath("/session/setup")).toBe("setup");
    expect(stepForPath("/session/calibrate")).toBe("calibrate");
    expect(stepForPath("/session/warmup")).toBe("warmup");
    expect(stepForPath("/session/plan")).toBe("plan");
    expect(stepForPath("/session/game/balloon_pop")).toBe("game");
    expect(stepForPath("/session/cooldown")).toBe("cooldown");
    expect(stepForPath("/session/summary/")).toBe("summary");
  });

  it("is null elsewhere", () => {
    expect(stepForPath("/patient")).toBeNull();
    expect(stepForPath("/session")).toBeNull();
    expect(stepForPath("/session/unknown")).toBeNull();
    expect(stepForPath("/admin/sessions/3")).toBeNull();
  });
});

describe("barIndex", () => {
  it("puts the plan and the games under Games, and the summary past the end", () => {
    expect(SESSION_STEPS.map(barIndex)).toEqual([0, 1, 2, 3, 3, 4, 5]);
    expect(BAR_STEPS[barIndex("game")]?.id).toBe("games");
    expect(barIndex("summary")).toBe(BAR_STEPS.length);
  });
});

describe("pathForStep", () => {
  const queue = { sessionId: 7, games: IDS, index: 1 };

  it("goes to the step's page", () => {
    expect(pathForStep("warmup", null)).toBe("/session/warmup");
    expect(pathForStep("summary", null)).toBe("/session/summary");
  });

  it("resumes the games at the current game", () => {
    expect(pathForStep("game", queue)).toBe("/session/game/balloon_pop");
  });

  it("goes to the cool-down after the last game, and the plan without a queue", () => {
    expect(pathForStep("game", { ...queue, index: 3 })).toBe("/session/cooldown");
    expect(pathForStep("game", null)).toBe("/session/plan");
  });
});

describe("queueFromServer", () => {
  it("copies a valid queue", () => {
    expect(queueFromServer(7, { games: IDS, index: 2 }, IDS)).toEqual({
      sessionId: 7,
      games: IDS,
      index: 2,
    });
  });

  it("clamps the index and rejects unknown or empty queues", () => {
    expect(queueFromServer(7, { games: IDS, index: 9 }, IDS)?.index).toBe(3);
    expect(queueFromServer(7, { games: ["bloom"], index: 0 }, IDS)).toBeNull();
    expect(queueFromServer(7, { games: [], index: 0 }, IDS)).toBeNull();
    expect(queueFromServer(7, null, IDS)).toBeNull();
  });
});

describe("firstUnfinished", () => {
  const order = ["a", "b", "c", "d"];

  it("finds the first item not done, in order", () => {
    expect(firstUnfinished(order, [])).toBe("a");
    expect(firstUnfinished(order, ["a", "b"])).toBe("c");
    expect(firstUnfinished(order, ["a", "c"])).toBe("b");
  });

  it("is null when everything is done", () => {
    expect(firstUnfinished(order, ["d", "c", "b", "a"])).toBeNull();
  });
});

describe("decideResume", () => {
  it("has nothing to resume without an active, recent session", () => {
    expect(decideResume(null, "/patient", IDS, NOW)).toEqual({ kind: "none" });
    expect(decideResume(session({ status: "completed" }), "/patient", IDS, NOW)).toEqual({
      kind: "none",
    });
    const old = session({ started_at: new Date(NOW - RESUME_MAX_AGE_MS).toISOString() });
    expect(decideResume(old, "/patient", IDS, NOW)).toEqual({ kind: "none" });
    expect(decideResume(session({ started_at: "not a date" }), "/patient", IDS, NOW)).toEqual({
      kind: "none",
    });
  });

  it("offers to continue from the home page, at the saved step", () => {
    expect(decideResume(session(), "/patient", IDS, NOW)).toEqual({
      kind: "offer",
      path: "/session/warmup",
      step: "warmup",
    });
  });

  it("offers even a session still at setup from the home page", () => {
    expect(decideResume(session({ current_step: "setup" }), "/patient", IDS, NOW).kind).toBe(
      "offer",
    );
  });

  it("stays put after a refresh on the saved step", () => {
    expect(decideResume(session(), "/session/warmup", IDS, NOW)).toEqual({ kind: "stay" });
    const playing = session({ current_step: "game", game_queue: { games: IDS, index: 2 } });
    expect(decideResume(playing, "/session/game/fruit_catch", IDS, NOW)).toEqual({
      kind: "stay",
    });
  });

  it("offers when a session page is not the saved step", () => {
    const playing = session({ current_step: "game", game_queue: { games: IDS, index: 1 } });
    expect(decideResume(playing, "/session/setup", IDS, NOW)).toEqual({
      kind: "offer",
      path: "/session/game/balloon_pop",
      step: "game",
    });
    expect(decideResume(playing, "/session/game/reach_activate", IDS, NOW).kind).toBe("offer");
  });

  it("does not ask when nothing has been done yet", () => {
    expect(decideResume(session({ current_step: "setup" }), "/session/plan", IDS, NOW)).toEqual({
      kind: "stay",
    });
  });
});
