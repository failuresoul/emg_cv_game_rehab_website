import { afterEach, describe, expect, it, vi } from "vitest";

import { canSpeak, voicesFor } from "@/lib/speech";

import { readStoredLanguage, storeLanguage } from "./preference";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the visitor's and admin's language", () => {
  it("is English until Bangla is chosen, and then remembered", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(readStoredLanguage()).toBe("en");
    storeLanguage("bn");
    expect(readStoredLanguage()).toBe("bn");
  });

  it("falls back to English when storage is refused", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readStoredLanguage()).toBe("en");
    expect(() => storeLanguage("bn")).not.toThrow();
  });
});

describe("spoken Bangla", () => {
  function voices(...langs: string[]) {
    vi.stubGlobal("window", {
      speechSynthesis: { getVoices: () => langs.map((lang) => ({ lang, name: lang })) },
    });
  }

  it("prefers a bn-BD voice, and is off without any Bangla voice", () => {
    voices("en-US", "bn-IN", "bn_BD");
    expect(voicesFor("bn").map((voice) => voice.lang)).toEqual(["bn_BD", "bn-IN"]);
    expect(canSpeak("bn")).toBe(true);
    voices("en-US", "en-GB");
    expect(canSpeak("bn")).toBe(false);
    expect(canSpeak("en")).toBe(true);
  });
});
