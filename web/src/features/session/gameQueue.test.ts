import { describe, expect, it } from "vitest";

import type { GameId } from "@/types/api";

import { GAME_IDS, GAMES } from "@/games/shared/registry";

import {
  createQueue,
  DEFAULT_PLAN,
  defaultPlanRows,
  currentGame,
  finishGame,
  loadQueue,
  move,
  nextAfter,
  saveQueue,
} from "./gameQueue";

const ALL: GameId[] = ["reach_activate", "balloon_pop", "fruit_catch"];

/** A simple stand-in for sessionStorage. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("game queue", () => {
  it("plays the games in order, then moves on", () => {
    let queue = createQueue(7, ["balloon_pop", "reach_activate"]);
    expect(currentGame(queue)).toBe("balloon_pop");
    expect(nextAfter(queue, "balloon_pop")).toBe("reach_activate");

    queue = finishGame(queue, "balloon_pop");
    expect(currentGame(queue)).toBe("reach_activate");
    expect(nextAfter(queue, "reach_activate")).toBeNull();

    queue = finishGame(queue, "reach_activate");
    expect(currentGame(queue)).toBeNull();
  });

  it("goes to the cool-down after a game that is not in the queue", () => {
    const queue = createQueue(7, ["balloon_pop"]);
    expect(nextAfter(queue, "fruit_catch")).toBeNull();
    expect(finishGame(queue, "fruit_catch")).toEqual(queue);
    expect(nextAfter(null, "fruit_catch")).toBeNull();
  });

  it("does not go backwards when an earlier game is finished again", () => {
    let queue = createQueue(1, ALL);
    queue = finishGame(queue, "reach_activate");
    queue = finishGame(queue, "balloon_pop");
    expect(finishGame(queue, "reach_activate").index).toBe(2);
  });

  it("moves a game up or down, and not past either end", () => {
    expect(move(ALL, 2, -1)).toEqual(["reach_activate", "fruit_catch", "balloon_pop"]);
    expect(move(ALL, 0, 1)).toEqual(["balloon_pop", "reach_activate", "fruit_catch"]);
    expect(move(ALL, 0, -1)).toEqual(ALL);
    expect(move(ALL, 2, 1)).toEqual(ALL);
  });
});

describe("keeping the queue across a refresh", () => {
  it("saves and loads the queue for its session", () => {
    const storage = memoryStorage();
    const queue = finishGame(createQueue(12, ALL), "reach_activate");
    saveQueue(queue, storage);
    expect(loadQueue(12, ALL, storage)).toEqual(queue);
    expect(loadQueue(13, ALL, storage)).toBeNull();
  });

  it("ignores anything it cannot trust", () => {
    const storage = memoryStorage();
    storage.setItem("motionlab.gameQueue.1", "not json");
    storage.setItem("motionlab.gameQueue.2", JSON.stringify({ games: ["chess"], index: 0 }));
    storage.setItem("motionlab.gameQueue.3", JSON.stringify({ games: ALL, index: "1" }));
    storage.setItem("motionlab.gameQueue.4", JSON.stringify({ games: ALL, index: 99 }));
    expect(loadQueue(1, ALL, storage)).toBeNull();
    expect(loadQueue(2, ALL, storage)).toBeNull();
    expect(loadQueue(3, ALL, storage)).toBeNull();
    expect(loadQueue(4, ALL, storage)?.index).toBe(3);
  });

  it("carries on without storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => saveQueue(createQueue(1, ALL), broken)).not.toThrow();
    expect(loadQueue(1, ALL, broken)).toBeNull();
    expect(loadQueue(1, ALL, undefined)).toBeNull();
  });
});

describe("defaultPlanRows", () => {
  const ready = GAME_IDS.filter((id) => GAMES[id].implemented);

  it("ticks Reach & Activate, Balloon Pop, Bloom and Finger Piano, in that order", () => {
    const rows = defaultPlanRows(ready);
    expect(rows.filter((row) => row.selected).map((row) => row.id)).toEqual([
      "reach_activate",
      "balloon_pop",
      "bloom",
      "finger_piano",
    ]);
    expect(rows.slice(0, 4).every((row) => row.selected)).toBe(true);
  });

  it("lists Fruit Catch after them, unticked", () => {
    const rows = defaultPlanRows(ready);
    expect(rows.find((row) => row.id === "fruit_catch")).toEqual({
      id: "fruit_catch",
      selected: false,
    });
    expect(rows.map((row) => row.id).sort()).toEqual([...ready].sort());
  });

  it("takes about 16 minutes", () => {
    const minutes = DEFAULT_PLAN.reduce((total, id) => total + GAMES[id].estimatedMinutes, 0);
    expect(minutes).toBe(16);
  });

  it("leaves out default games that are not available", () => {
    const rows = defaultPlanRows(["fruit_catch", "bloom"]);
    expect(rows).toEqual([
      { id: "bloom", selected: true },
      { id: "fruit_catch", selected: false },
    ]);
  });
});
