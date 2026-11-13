import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedbackState } from "@/features/feedback/feedbackJob";
import { en } from "@/i18n/en";
import type { SessionReport } from "@/types/api";

import { SessionSummaryPage } from "./SessionSummaryPage";

const STOP = en["summary.stopNotice"];
const REPORT_NOTICE = "Please stop practising for today (from the report).";

const feedback: { state: FeedbackState } = { state: { status: "preparing", jobId: 4 } };
const summary: { data: SessionReport } = {
  data: {
    flags: ["pain"],
    active_seconds: 900,
    duration_seconds: 1200,
    warmup: null,
    previous_warmup: null,
    games: [],
    reach: null,
    previous_reach: null,
  } as unknown as SessionReport,
};

vi.mock("@/features/session/SessionContext", () => ({
  useSession: () => ({ sessionId: 42, affectedSide: "left" }),
  useForgetSession: () => () => undefined,
}));
vi.mock("@/features/session/NextFocus", () => ({ NextFocus: () => null }));
vi.mock("@/features/progress/hooks", () => ({
  useSessionReport: () => ({ data: summary.data, isPending: false, isError: false }),
}));
vi.mock("@/features/feedback/hooks", () => ({
  useFeedback: () => ({ state: feedback.state, retry: () => undefined }),
  useRateReport: () => ({ isSuccess: false, isError: false, isPending: false, mutate: () => {} }),
}));

function render(): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SessionSummaryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  feedback.state = { status: "preparing", jobId: 4 };
});

describe("the session summary with its feedback", () => {
  it("shows the whole summary while the report is being prepared", () => {
    const html = render();
    expect(html).toContain(en["summary.wellDone"]);
    expect(html).toContain(en["summary.timeSpent"]);
    expect(html).toContain(en["summary.gamesTitle"]);
    expect(html).toContain(en["feedback.preparing"]);
    expect(html).toContain(en["summary.home"]);
  });

  it("still shows the summary when the report fails", () => {
    feedback.state = { status: "error", jobId: 4, reason: "timeout" };
    const html = render();
    expect(html).toContain(en["summary.timeSpent"]);
    expect(html).toContain(en["feedback.errorTimeout"]);
  });

  it("puts the fixed stop notice first while preparing, then the report's notice instead", () => {
    let html = render();
    expect(html.indexOf(STOP)).toBeGreaterThan(-1);
    expect(html.indexOf(STOP)).toBeLessThan(html.indexOf(en["summary.wellDone"]));

    feedback.state = {
      status: "ready",
      jobId: 4,
      read: {
        job_id: 4,
        session_id: 42,
        language: "en",
        status: "done",
        report: {
          language: "en",
          patient_summary: "Thank you for session 3.",
          highlights: [],
          suggestions: [],
          next_session_text: "More reaching.",
        },
        safety_notices: [REPORT_NOTICE],
        meta: null,
        created_at: "2026-11-13T10:00:00Z",
        finished_at: null,
      },
    };
    html = render();
    // The report's notice, first on the page, shown once; the questionnaire's copy is gone.
    expect(html).not.toContain(STOP);
    expect(html.split(REPORT_NOTICE)).toHaveLength(2);
    expect(html.indexOf(REPORT_NOTICE)).toBeLessThan(html.indexOf(en["summary.wellDone"]));
    expect(html.indexOf(REPORT_NOTICE)).toBeLessThan(html.indexOf("Thank you for session 3."));
  });
});
