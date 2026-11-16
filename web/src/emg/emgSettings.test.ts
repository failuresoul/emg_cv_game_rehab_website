import { afterEach, describe, expect, it } from "vitest";

import { draftErrors, overridesFrom } from "@/features/emgSettings/EmgSettingsPanel";
import { setLanguage } from "@/i18n";

import { restResult } from "./calibration";
import {
  applyEmgSettings,
  changedKeys,
  cleanOverrides,
  EMG,
  EMG_DEFAULTS,
  EMG_SETTING_KEYS,
  EMG_SETTINGS_SPEC,
  onEmgSettingsChange,
  resetEmgSettings,
} from "./emgSettings";
import { isSaturated, MovingAverage, OnsetDetector } from "./processing";
import { CALIBRATION, READINESS } from "./readinessConfig";

afterEach(() => {
  resetEmgSettings();
  setLanguage("en");
});

describe("the EMG settings", () => {
  it("has a default inside its limits for every threshold, in four groups", () => {
    expect(EMG_SETTING_KEYS.length).toBeGreaterThanOrEqual(29);
    for (const key of EMG_SETTING_KEYS) {
      const rule = EMG_SETTINGS_SPEC[key];
      expect(rule.default).toBeGreaterThanOrEqual(rule.min);
      expect(rule.default).toBeLessThanOrEqual(rule.max);
      expect(["stream", "check", "calibration", "signal"]).toContain(rule.group);
    }
    expect(EMG).toEqual(EMG_DEFAULTS);
    expect(changedKeys()).toEqual([]);
  });

  it("keeps only known keys with usable values, and the rate limits in order", () => {
    expect(
      cleanOverrides({
        minRateHz: 480,
        nothing: 3,
        saturationMv: 9999,
        attempts: 2.5,
        onsetK: "3",
      }),
    ).toEqual({ minRateHz: 480 });
    expect(cleanOverrides({ minRateHz: 600, maxRateHz: 550 })).toEqual({});
    expect(cleanOverrides(null)).toEqual({});
  });

  it("is read live by every rule: the check, calibration, saturation, smoothing and onsets", () => {
    let changes = 0;
    const stop = onEmgSettingsChange(() => (changes += 1));
    applyEmgSettings({
      minRateHz: 400,
      restMs: 5000,
      saturationMv: 2500,
      smoothingMs: 10,
      onsetK: 2,
      minContactSdMv: 5,
    });
    expect(changes).toBe(1);
    stop();
    expect(READINESS.minRateHz).toBe(400);
    expect(CALIBRATION.restMs).toBe(5000);
    expect(isSaturated(2600)).toBe(true);
    // 10 ms at 500 Hz: a five-sample average.
    const average = new MovingAverage(500);
    [0, 0, 0, 0, 0].forEach((value) => average.push(value));
    expect(average.push(100)).toBe(20);
    expect(new OnsetDetector({ restMean: 100, restSd: 10 }).threshold).toBe(120);
    expect(
      restResult(
        Array(500)
          .fill(200)
          .map((v, i) => v + (i % 2) * 6),
      ).problem,
    ).toBe("electrodeOff");
    expect(changedKeys().sort()).toEqual(
      ["minContactSdMv", "minRateHz", "onsetK", "restMs", "saturationMv", "smoothingMs"].sort(),
    );

    resetEmgSettings();
    expect(READINESS.minRateHz).toBe(490);
    expect(isSaturated(2600)).toBe(false);
  });
});

describe("the admin panel's form", () => {
  const drafts = () =>
    Object.fromEntries(EMG_SETTING_KEYS.map((key) => [key, String(EMG_DEFAULTS[key])])) as Record<
      (typeof EMG_SETTING_KEYS)[number],
      string
    >;

  it("sends only the values that differ from their default", () => {
    const values = { ...drafts(), minRateHz: "480", restMs: "10000" };
    expect(draftErrors(values)).toEqual({});
    expect(overridesFrom(values)).toEqual({ minRateHz: 480 });
  });

  it("explains each value it cannot use", () => {
    const errors = draftErrors({
      ...drafts(),
      saturationMv: "4000",
      attempts: "2.5",
      onsetK: "",
      minRateHz: "600",
      maxRateHz: "550",
    });
    expect(errors.saturationMv).toMatch(/500.*3,?600/);
    expect(errors.attempts).toBe("Enter a whole number");
    expect(errors.onsetK).toBe("Enter a number");
    expect(errors.minRateHz).toMatch(/below/);
  });
});
