import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { en } from "@/i18n/en";
import { isMuted, setMuted, setSoundEnabled } from "@/lib/beep";
import { CATEGORICAL, DASHES } from "@/lib/chartPalette";
import {
  applyDisplay,
  DEFAULT_DISPLAY,
  displayAttributes,
  prefersReducedMotion,
  ROOT_FONT_PX,
} from "@/lib/display";

afterEach(() => {
  applyDisplay(DEFAULT_DISPLAY, undefined);
  setSoundEnabled(true);
  setMuted(false);
});

describe("display settings", () => {
  it("become attributes on <html>, nothing for the defaults", () => {
    expect(displayAttributes(DEFAULT_DISPLAY)).toEqual({
      "data-text-size": null,
      "data-contrast": null,
      "data-motion": null,
    });
    expect(
      displayAttributes({ textSize: "xlarge", highContrast: true, reduceMotion: true }),
    ).toEqual({
      "data-text-size": "xlarge",
      "data-contrast": "high",
      "data-motion": "reduce",
    });
  });

  it("are applied and removed again", () => {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    } as unknown as HTMLElement;
    applyDisplay({ textSize: "large", highContrast: true, reduceMotion: false }, root);
    expect(Object.fromEntries(attributes)).toEqual({
      "data-text-size": "large",
      "data-contrast": "high",
    });
    applyDisplay(DEFAULT_DISPLAY, root);
    expect(attributes.size).toBe(0);
  });

  it("scale the root font: 18, 21 and 24 px", () => {
    expect(ROOT_FONT_PX).toEqual({ normal: 18, large: 21, xlarge: 24 });
  });

  it("reduce motion from the patient's setting even when the system does not", () => {
    applyDisplay({ ...DEFAULT_DISPLAY, reduceMotion: true }, undefined);
    expect(prefersReducedMotion()).toBe(true);
    applyDisplay(DEFAULT_DISPLAY, undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("turn sounds off whatever a screen's own mute says", () => {
    expect(isMuted()).toBe(false);
    setSoundEnabled(false);
    expect(isMuted()).toBe(true);
    setSoundEnabled(true);
    setMuted(true);
    expect(isMuted()).toBe(true);
  });
});

describe("charts", () => {
  it("use four colour-blind-safe colours, each with its own dash", () => {
    expect(CATEGORICAL).toHaveLength(4);
    expect(new Set(DASHES).size).toBe(4);
  });

  it("describe themselves to screen readers and offer a table view", () => {
    const html = renderToStaticMarkup(
      <ProgressChart
        points={[
          { label: "10 Nov", value: 3 },
          { label: "12 Nov", value: 5 },
        ]}
        seriesName="Reach area"
        emptyTitle="None"
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Reach area: 2 points, latest 5 (12 Nov)"');
    expect(html).toContain(en["chart.viewTable"]);
    expect(html).toContain('aria-pressed="false"');
  });
});

describe("admin breadcrumbs", () => {
  it("link up to each parent and mark the current page", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PageHeader
          title="Session"
          breadcrumbs={[
            { label: "Patients", to: "/admin/patients" },
            { label: "P001", to: "/admin/patients/1" },
            { label: "14 Nov 2026" },
          ]}
        />
      </MemoryRouter>,
    );
    expect(html).toContain(`aria-label="${en["nav.breadcrumb"]}"`);
    expect(html).toContain('href="/admin/patients/1"');
    expect(html).toContain('aria-current="page">14 Nov 2026');
  });
});
