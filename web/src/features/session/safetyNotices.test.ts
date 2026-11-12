import { describe, expect, it } from "vitest";

// The file as it is on disk, through Vite, so the test needs no Node types.
import fileText from "../../../../shared/safety-notices.json?raw";

import { bn } from "@/i18n/bn";
import { en } from "@/i18n/en";

interface Notice {
  web_key: string | null;
  en: string;
  bn: string;
}

const { notices } = JSON.parse(fileText) as { notices: Record<string, Notice> };

describe("shared/safety-notices.json", () => {
  it("is the wording the app shows (the server's feedback uses the same file)", () => {
    const shown = Object.values(notices).filter((notice) => notice.web_key !== null);
    expect(shown.length).toBeGreaterThan(0);
    for (const notice of shown) {
      const key = notice.web_key as keyof typeof en;
      expect(en[key]).toBe(notice.en);
      expect(bn[key]).toBe(notice.bn);
    }
  });

  it("keeps the stop notice for pain and new symptoms", () => {
    expect(notices.stop?.web_key).toBe("summary.stopNotice");
  });
});
