import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/i18n";

import { BoardSimBadge, boardMode } from "./BoardSimBadge";

describe("the Board simulation badge", () => {
  it("is for the real board's SIM ON only, not the browser's simulated sensor", () => {
    expect(boardMode({ connected: true, source: "serial", mode: "SIM" })).toBe("SIM");
    expect(boardMode({ connected: true, source: "serial", mode: "ADC" })).toBe("ADC");
    expect(boardMode({ connected: true, source: "simulated", mode: "SIM" })).toBeNull();
    expect(boardMode({ connected: false, source: "serial", mode: "SIM" })).toBeNull();
  });

  it("shows only in SIM mode", () => {
    expect(renderToStaticMarkup(<BoardSimBadge mode="SIM" />)).toContain(t("emg.boardSimulation"));
    expect(renderToStaticMarkup(<BoardSimBadge mode="ADC" />)).toBe("");
    expect(renderToStaticMarkup(<BoardSimBadge mode={null} />)).toBe("");
  });
});
