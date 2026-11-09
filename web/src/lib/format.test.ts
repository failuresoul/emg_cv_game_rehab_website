import { describe, expect, it } from "vitest";

import { formatClock, formatDifference, formatDuration, formatNumber } from "./format";

describe("formatDuration", () => {
  it("shows seconds under a minute", () => {
    expect(formatDuration(45)).toBe("45 sec");
  });

  it("shows whole minutes without seconds", () => {
    expect(formatDuration(120)).toBe("2 min");
  });

  it("shows minutes and seconds, rounding to the nearest second", () => {
    expect(formatDuration(1560.4)).toBe("26 min");
    expect(formatDuration(95.6)).toBe("1 min 36 sec");
  });

  it("carries 59.6 seconds over to a full minute", () => {
    expect(formatDuration(59.6)).toBe("1 min");
  });
});

describe("number formats", () => {
  it("keeps two decimals", () => {
    expect(formatNumber(1.5)).toBe("1.50");
  });

  it("shows the sign of a difference", () => {
    expect(formatDifference(0.25)).toBe("+0.25");
    expect(formatDifference(-0.25)).toBe("-0.25");
    expect(formatDifference(0)).toBe("0.00");
  });
});

describe("formatClock", () => {
  it("shows minutes and two-digit seconds", () => {
    expect(formatClock(0, "en")).toBe("0:00");
    expect(formatClock(65_900, "en")).toBe("1:05");
    expect(formatClock(600_000, "en")).toBe("10:00");
  });

  it("never shows a negative time", () => {
    expect(formatClock(-500, "en")).toBe("0:00");
  });

  it("uses the language's own digits", () => {
    expect(formatClock(65_000, "bn-BD")).toBe("১:০৫");
  });
});
