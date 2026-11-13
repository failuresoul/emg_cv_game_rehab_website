import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@/i18n/en";
import type { FeedbackReportRead } from "@/types/api";

import type { FeedbackState } from "./feedbackJob";
import { FeedbackReportView, SUGGESTION_ICONS } from "./FeedbackReportView";
import { FeedbackSection, FinishedReport, summaryNotices } from "./FeedbackSection";
import { ReadAloudButton } from "./ReadAloudButton";
import { hasVoice, pickVoice, speechText } from "./readAloud";

const NOTICE = "Please stop practising for today and tell your therapist how you feel.";

function read(overrides: Partial<FeedbackReportRead> = {}): FeedbackReportRead {
  return {
    job_id: 12,
    session_id: 3,
    language: "en",
    status: "done",
    report: {
      language: "en",
      patient_summary: "You reached further today.",
      highlights: [{ metric_id: "K6", text: "You reached each target faster." }],
      suggestions: [
        { id: "REST_BREAKS", text: "Rest between games." },
        { id: "NEXT_FOCUS", text: "Next time, more reaching." },
      ],
      next_session_text: "You will practise reaching up.",
      therapist_summary: "Session 3. K6 improved.",
    },
    safety_notices: [NOTICE],
    meta: {
      model: "qwen3.5:4b",
      prompt_version: "v1",
      latency_ms: 20000,
      retries: 0,
      fallback_used: false,
    },
    created_at: "2026-11-13T10:00:00Z",
    finished_at: "2026-11-13T10:00:21Z",
    ...overrides,
  };
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the report view", () => {
  it("shows the safety notices before everything else", () => {
    const html = render(<FinishedReport read={read()} />);
    const notice = html.indexOf(NOTICE);
    expect(notice).toBeGreaterThan(-1);
    for (const text of [
      "You reached further today.",
      "You reached each target faster.",
      "Rest between games.",
      "You will practise reaching up.",
      en["feedback.disclaimer"],
    ]) {
      expect(html.indexOf(text)).toBeGreaterThan(notice);
    }
    expect(html.indexOf('data-testid="safety-notices"')).toBeLessThan(
      html.indexOf("patient-summary"),
    );
  });

  it("renders the model's text as plain text, never HTML", () => {
    const hostile = read({
      report: {
        ...read().report!,
        patient_summary: '<img src=x onerror="alert(1)">Hello',
        highlights: [{ metric_id: "K6", text: "<b>bold</b>" }],
      },
    });
    const html = render(<FinishedReport read={hostile} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;Hello");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("never shows the therapist summary to the patient", () => {
    expect(render(<FinishedReport read={read()} />)).not.toContain("Session 3. K6 improved.");
  });

  it("shows the template report exactly like the model's, with no error wording", () => {
    const model = render(<FinishedReport read={read()} />);
    const template = render(
      <FinishedReport
        read={read({ status: "fallback", meta: { ...read().meta!, fallback_used: true } })}
      />,
    );
    expect(template).toBe(model);
    expect(template).not.toContain(en["feedback.error"]);
  });

  it("has the disclaimer, the next-time line and an icon for each suggestion", () => {
    const html = render(<FeedbackReportView report={read().report!} notices={[]} />);
    expect(html).toContain(en["feedback.disclaimer"]);
    expect(html).toContain(en["feedback.nextTime"]);
    expect(html).not.toContain('data-testid="safety-notices"');
    expect(Object.keys(SUGGESTION_ICONS)).toHaveLength(13);
  });
});

describe("the summary's feedback section", () => {
  it("shows a calm preparing card that respects reduced motion", () => {
    const html = render(
      <FeedbackSection state={{ status: "preparing", jobId: 4 }} onRetry={() => {}} />,
    );
    expect(html).toContain(en["feedback.preparing"]);
    expect(html).toContain("motion-safe:animate-breathe");
    expect(html).not.toContain("animate-spin");
  });

  it("leaves the notices to the top of the page", () => {
    const html = render(
      <FeedbackSection state={{ status: "ready", jobId: 12, read: read() }} onRetry={() => {}} />,
    );
    expect(html).not.toContain(NOTICE);
    expect(html).toContain("You reached further today.");
  });

  it("offers to try again after an error", () => {
    const html = render(
      <FeedbackSection
        state={{ status: "error", jobId: 4, reason: "timeout" }}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain(en["feedback.errorTimeout"]);
    expect(html).toContain(en["feedback.tryAgain"]);
  });

  it("puts the report's notices first, and the questionnaire's stop notice before it arrives", () => {
    const preparing: FeedbackState = { status: "preparing", jobId: null };
    expect(summaryNotices(preparing, "STOP")).toEqual(["STOP"]);
    expect(summaryNotices(preparing, null)).toEqual([]);
    const ready: FeedbackState = { status: "ready", jobId: 12, read: read() };
    // The report's own notices replace it: never the same notice twice.
    expect(summaryNotices(ready, "STOP")).toEqual([NOTICE]);
    const fallback: FeedbackState = {
      status: "fallback",
      jobId: 12,
      read: read({ status: "fallback", safety_notices: [] }),
    };
    expect(summaryNotices(fallback, null)).toEqual([]);
  });
});

describe("read aloud", () => {
  function voices(list: { lang: string; name: string }[]) {
    vi.stubGlobal("window", { speechSynthesis: { getVoices: () => list } });
  }

  it("is hidden when the browser has no voice for the language", () => {
    voices([]);
    expect(render(<ReadAloudButton text="Hello" language="en" />)).toBe("");
    voices([{ lang: "en-US", name: "English" }]);
    expect(render(<ReadAloudButton text="নমস্কার" language="bn" />)).toBe("");
    vi.unstubAllGlobals();
    // No speech synthesis at all (an old browser, or the server).
    expect(hasVoice("en")).toBe(false);
  });

  it("shows the button when a voice exists", () => {
    voices([{ lang: "bn-BD", name: "Bangla" }]);
    expect(render(<ReadAloudButton text="নমস্কার" language="bn" />)).toContain(
      en["feedback.readAloud"],
    );
  });

  it("picks the exact language's voice first", () => {
    voices([
      { lang: "en-GB", name: "British" },
      { lang: "en-US", name: "American" },
    ]);
    expect(pickVoice("en")?.name).toBe("American");
    voices([{ lang: "en_GB", name: "British" }]);
    expect(pickVoice("en")?.name).toBe("British");
  });

  it("reads the notices first, then the report in order", () => {
    const text = speechText(read().report!, [NOTICE]).split("\n");
    expect(text).toEqual([
      NOTICE,
      "You reached further today.",
      "You reached each target faster.",
      "Rest between games.",
      "Next time, more reaching.",
      `${en["feedback.nextTime"]} You will practise reaching up.`,
    ]);
  });
});

describe("feedback code", () => {
  const sources = import.meta.glob<string>(
    [
      "./*.tsx",
      "../../pages/patient/PatientReport*.tsx",
      "../../pages/session/SessionSummaryPage.tsx",
    ],
    { query: "?raw", import: "default", eager: true },
  );

  it("never renders HTML from the model", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(8);
    for (const [path, source] of Object.entries(sources)) {
      expect(source, path).not.toContain("dangerouslySetInnerHTML");
      expect(source, path).not.toContain("innerHTML");
    }
  });
});
