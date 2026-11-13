import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { EmgEngine } from "@/emg/engine";
import { EmgProvider } from "@/emg/EmgProvider";
import { en } from "@/i18n/en";
import { SessionEmgPage } from "@/pages/session/SessionEmgPage";

import { dotState } from "./EmgStatusDot";

vi.mock("@/features/session/SessionContext", () => ({
  useSession: () => ({ sessionId: 7 }),
  useSessionStep: () => undefined,
}));

describe("the muscle sensor dot", () => {
  it("is green streaming, amber connected or just lost, grey off", () => {
    expect(dotState({ connected: true, streaming: true, error: null })).toBe("on");
    expect(dotState({ connected: true, streaming: false, error: null })).toBe("paused");
    expect(dotState({ connected: false, streaming: false, error: "lost" })).toBe("paused");
    expect(dotState({ connected: false, streaming: false, error: null })).toBe("off");
  });
});

describe("the muscle sensor step", () => {
  it("starts with the safety rule, the three required answers, the site and a way to skip", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <EmgProvider engine={new EmgEngine()}>
            <SessionEmgPage />
          </EmgProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const key of [
      "emgStep.safety.rule",
      "emgStep.safety.charger",
      "emgStep.safety.batteries",
      "emgStep.safety.electrodes",
      "emgStep.site.flexors",
      "emgStep.site.extensors",
      "emgStep.skip",
      "emgStep.stage.safety",
      "emgStep.stage.summary",
    ] as const) {
      expect(html).toContain(en[key]);
    }
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    // Continue stays off until a site is chosen and all three are ticked.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Continue/);
  });
});
