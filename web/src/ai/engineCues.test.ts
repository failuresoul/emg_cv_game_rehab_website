import { describe, expect, it } from "vitest";

import { en } from "@/i18n/en";
import type { EngineCue } from "@/types/api";

import { cueAction, LEVEL_MESSAGE_GAP_MS, LevelMessages } from "./engineCues";

describe("cueAction", () => {
  it("turns each cue into something gentle for the patient", () => {
    expect(cueAction("posture")).toEqual({
      kind: "message",
      key: "warmup.cue.back",
      tone: "gentle",
    });
    expect(cueAction("encourage")).toEqual({
      kind: "message",
      key: "game.cue.encourage",
      tone: "gentle",
    });
    expect(cueAction("rest")).toEqual({ kind: "rest" });
    expect(cueAction("finish_soon")).toEqual({ kind: "banner", key: "game.cue.finishSoon" });
    expect(cueAction("finish")).toEqual({ kind: "finish" });
  });

  it("never mentions how the difficulty is chosen", () => {
    const cues: EngineCue[] = ["posture", "encourage", "rest", "finish_soon", "finish"];
    const keys = [
      ...cues.flatMap((cue) => {
        const action = cueAction(cue);
        return "key" in action ? [action.key] : [];
      }),
      "game.level.up",
      "game.level.down",
      "game.hud.level",
      "game.rest.title",
      "game.rest.breathe",
    ] as const;
    for (const key of keys) expect(en[key]).not.toMatch(/\bAI\b|algorithm|engine/i);
    expect(en["game.cue.finishSoon"]).toBe("A few more and then we finish");
  });
});

describe("LevelMessages", () => {
  it("words a level change up or down", () => {
    const messages = new LevelMessages();
    expect(messages.message(null, 4, 0)).toBeNull(); // The first level: nothing to compare.
    expect(messages.message(4, 5, 1000)).toBe("game.level.up");
    expect(en["game.level.up"]).toBe("Nice — a little more challenge");
    expect(en["game.level.down"]).toBe("Let's make it a bit easier");
  });

  it("says it at most once every 30 seconds", () => {
    const messages = new LevelMessages();
    expect(messages.message(4, 3, 1000)).toBe("game.level.down");
    expect(messages.message(3, 2, 1000 + LEVEL_MESSAGE_GAP_MS - 1)).toBeNull();
    expect(messages.message(2, 3, 1000 + LEVEL_MESSAGE_GAP_MS)).toBe("game.level.up");
    expect(messages.message(3, 3, 1000 + 2 * LEVEL_MESSAGE_GAP_MS)).toBeNull();
  });
});
