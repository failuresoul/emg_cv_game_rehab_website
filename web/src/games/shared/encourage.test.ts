import { describe, expect, it } from "vitest";

import { Encourager, MISS_KEYS, STREAK_KEYS, SUCCESS_KEYS } from "./encourage";
import { createRng } from "./rng";

describe("Encourager", () => {
  it("gives a positive message after a success and a calm one after a miss", () => {
    const encourager = new Encourager(createRng(1).next);
    const success = encourager.success();
    expect(SUCCESS_KEYS).toContain(success.key);
    expect(success.tone).toBe("positive");
    const miss = encourager.miss();
    expect(MISS_KEYS).toContain(miss.key);
    expect(miss.tone).toBe("gentle");
  });

  it("celebrates every third success in a row, with the count", () => {
    const encourager = new Encourager(createRng(2).next);
    const messages = Array.from({ length: 6 }, () => encourager.success());
    expect(STREAK_KEYS).toContain(messages[2].key);
    expect(messages[2].params).toEqual({ n: 3 });
    expect(STREAK_KEYS).toContain(messages[5].key);
    expect(messages[5].params).toEqual({ n: 6 });
    for (const index of [0, 1, 3, 4]) expect(SUCCESS_KEYS).toContain(messages[index].key);
  });

  it("starts counting the streak again after a miss", () => {
    const encourager = new Encourager(createRng(3).next);
    encourager.success();
    encourager.success();
    encourager.miss();
    expect(encourager.currentStreak).toBe(0);
    // Two before the miss do not count: the streak message comes at the third after it.
    expect(STREAK_KEYS).not.toContain(encourager.success().key);
    expect(STREAK_KEYS).not.toContain(encourager.success().key);
    const third = encourager.success();
    expect(STREAK_KEYS).toContain(third.key);
    expect(third.params).toEqual({ n: 3 });
    expect(encourager.currentStreak).toBe(3);
  });

  it("never gives the same message twice in a row", () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = createRng(seed);
      const encourager = new Encourager(rng.next);
      let last = "";
      for (let trial = 0; trial < 40; trial++) {
        const message = rng.next() < 0.6 ? encourager.success() : encourager.miss();
        expect(message.key).not.toBe(last);
        last = message.key;
      }
    }
  });

  it("does not repeat even when the random numbers always pick the same place", () => {
    const encourager = new Encourager(() => 0);
    expect(encourager.miss().key).not.toBe(encourager.miss().key);
    const always = new Encourager(() => 0.999);
    expect(always.success().key).not.toBe(always.success().key);
  });
});
