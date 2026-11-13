import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { en } from "@/i18n/en";
import { BENGALI_FONT_URL, ensureBengaliFont } from "@/lib/bengaliFont";
import type { FeedbackReportRead } from "@/types/api";

import type { FeedbackState } from "./feedbackJob";
import { FeedbackSection, shownLanguage } from "./FeedbackSection";
import { LanguageToggle } from "./LanguageToggle";

const indexHtml = import.meta.glob<string>("/index.html", {
  query: "?raw",
  import: "default",
  eager: true,
})["/index.html"]!;

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>,
  );
}

function read(language: "en" | "bn"): FeedbackReportRead {
  return {
    job_id: language === "en" ? 1 : 2,
    session_id: 3,
    language,
    status: "done",
    report: {
      language,
      patient_summary:
        language === "bn" ? "সেশন ৩ শেষ করার জন্য ধন্যবাদ।" : "Thank you for session 3.",
      highlights: [],
      suggestions: [],
      next_session_text: language === "bn" ? "পরের বার হাত বাড়ানো।" : "More reaching.",
    },
    safety_notices: [],
    meta: null,
    created_at: "2026-11-13T10:00:00Z",
    finished_at: null,
  };
}

/** A tiny stand-in for the browser's document. */
function fakeDocument() {
  const elements = new Map<string, { id: string; rel: string; href: string }>();
  const head: {
    children: { id: string; rel: string; href: string }[];
    appendChild: (e: never) => void;
  } = {
    children: [],
    appendChild(element: { id: string; rel: string; href: string }) {
      head.children.push(element);
      elements.set(element.id, element);
    },
  } as never;
  return {
    head,
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => ({ id: "", rel: "", href: "" }),
  } as unknown as Document & { head: typeof head };
}

describe("the Bengali font", () => {
  it("is not loaded for everyone", () => {
    expect(indexHtml).toContain("family=Inter");
    expect(indexHtml).not.toContain("Bengali");
  });

  it("is added once, when Bangla is shown", () => {
    const doc = fakeDocument();
    expect(ensureBengaliFont(doc)).toBe(true);
    expect(ensureBengaliFont(doc)).toBe(false);
    const head = (doc as unknown as { head: { children: { rel: string; href: string }[] } }).head;
    expect(head.children).toHaveLength(1);
    expect(head.children[0]).toMatchObject({ rel: "stylesheet", href: BENGALI_FONT_URL });
    expect(BENGALI_FONT_URL).toContain("Noto+Sans+Bengali");
    // On the server (no document) nothing happens.
    expect(ensureBengaliFont(undefined)).toBe(false);
  });
});

describe("the language toggle", () => {
  it("offers English and বাংলা, marking the one shown", () => {
    const html = render(<LanguageToggle value="bn" onChange={() => {}} />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>বাংলা</);
    expect(html).toContain('lang="bn"');
  });

  it("shows on the summary card once a report is there, in its language", () => {
    const ready: FeedbackState = { status: "ready", jobId: 2, read: read("bn") };
    const html = render(<FeedbackSection state={ready} onRetry={() => {}} onLanguage={() => {}} />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>বাংলা</);
    expect(html).toContain("সেশন ৩ শেষ করার জন্য ধন্যবাদ।");
    expect(html).toContain('lang="bn"');
  });

  it("is hidden while the first report is prepared, and disabled while another one is", () => {
    const preparing: FeedbackState = { status: "preparing", jobId: null };
    const first = render(
      <FeedbackSection state={preparing} onRetry={() => {}} onLanguage={() => {}} />,
    );
    expect(first).not.toContain(en["feedback.language.en"]);
    const switching = render(
      <FeedbackSection state={preparing} onRetry={() => {}} language="bn" onLanguage={() => {}} />,
    );
    expect(switching).toContain("disabled");
    expect(switching).toContain(en["feedback.preparing"]);
  });

  it("knows which language is shown", () => {
    expect(shownLanguage({ status: "preparing", jobId: null }, undefined)).toBeNull();
    expect(shownLanguage({ status: "preparing", jobId: null }, "bn")).toBe("bn");
    expect(shownLanguage({ status: "fallback", jobId: 1, read: read("en") }, undefined)).toBe("en");
  });
});
