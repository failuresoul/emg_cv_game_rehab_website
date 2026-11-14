/**
 * Colour contrast of the theme tokens (styles/index.css), which axe cannot measure in jsdom:
 * the normal theme meets WCAG AA (4.5:1 for text), the high-contrast theme AAA (7:1).
 */
/// <reference types="node" />
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";

// Vitest does not load CSS files as text, so the stylesheet is read from disk.
const CSS = readFileSync(new URL("../styles/index.css", import.meta.url), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
  );
}

const normal = tokens(CSS.slice(CSS.indexOf("@theme"), CSS.indexOf("@layer base")));
const highBlock = CSS.slice(CSS.indexOf('html[data-contrast="high"] {'));
const high = { ...normal, ...tokens(highBlock.slice(0, highBlock.indexOf("}"))) };

/** Text colour on background, as the app uses them. */
const TEXT_PAIRS: [string, string][] = [
  ["ink", "background"],
  ["ink", "surface"],
  ["muted", "surface"],
  ["muted", "background"],
  ["primary", "surface"],
  ["primary", "primary-light"],
  ["danger", "surface"],
  ["success", "surface"],
  ["info", "surface"],
];
const WHITE = "#ffffff";

describe("theme contrast", () => {
  it("reads both themes from the stylesheet", () => {
    expect(Object.keys(normal).length).toBeGreaterThanOrEqual(12);
    expect(high.ink).toBe("#000000");
  });

  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("meets AA in the normal theme", () => {
    for (const [text, background] of TEXT_PAIRS) {
      expect(
        contrastRatio(normal[text]!, normal[background]!),
        `${text} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // White on the primary and danger buttons.
    expect(contrastRatio(WHITE, normal.primary!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(WHITE, normal.danger!)).toBeGreaterThanOrEqual(4.5);
    // The focus ring stands out from the page (non-text, 3:1).
    expect(contrastRatio(normal.accent!, normal.background!)).toBeGreaterThanOrEqual(3);
  });

  it("meets AAA (7:1) in the high-contrast theme", () => {
    for (const [text, background] of TEXT_PAIRS) {
      expect(
        contrastRatio(high[text]!, high[background]!),
        `${text} on ${background}`,
      ).toBeGreaterThanOrEqual(7);
    }
    expect(contrastRatio(WHITE, high.primary!)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(WHITE, high.danger!)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(high.accent!, high.background!)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(WHITE, high["session-bg"]!)).toBeGreaterThanOrEqual(7);
  });
});
