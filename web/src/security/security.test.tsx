// @vitest-environment jsdom
/// <reference types="node" />
/**
 * Day 18 security review, web side: the security headers (and nginx's copy of them), the
 * Content-Security-Policy against what the app really loads, no raw HTML anywhere, model and
 * user text shown as plain text, and the global error page.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/ErrorPage";
import { FeedbackReportView } from "@/features/feedback/FeedbackReportView";
import { en } from "@/i18n/en";
import { BENGALI_FONT_URL } from "@/lib/bengaliFont";
import { HAND_MODEL_URL, POSE_MODEL_URL, WASM_URL } from "@/vision/config";

import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "../../securityHeaders";

const WEB = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((words) => words[0])
      .map(([name, ...values]) => [name, values]),
  );
}

describe("security headers", () => {
  it("nginx sends exactly the headers vite preview sends", () => {
    const lines = read("security-headers.conf")
      .split("\n")
      .filter((line) => line.startsWith("add_header"));
    const fromNginx = Object.fromEntries(
      lines.map((line) => {
        const match = line.match(/^add_header (\S+) "(.*)" always;$/);
        expect(match, line).not.toBeNull();
        return [match![1], match![2]];
      }),
    );
    expect(fromNginx).toEqual(SECURITY_HEADERS);
  });

  it("every nginx location serving the app includes them", () => {
    const conf = read("nginx.conf");
    const locations = conf.split(/\n\s*location /).slice(1);
    for (const location of locations) {
      if (location.startsWith("/api/")) continue; // the API sends its own
      expect(location, location.split("\n")[0]).toContain(
        "include /etc/nginx/snippets/security-headers.conf;",
      );
    }
    expect(read("Dockerfile")).toContain(
      "COPY security-headers.conf /etc/nginx/snippets/security-headers.conf",
    );
  });

  it("the policy allows what the app loads, and nothing it does not", () => {
    const policy = directives(CONTENT_SECURITY_POLICY);
    const host = (url: string) => new URL(url).origin;
    // MediaPipe: the WASM loader is a script, the WASM and the models are fetched.
    expect(policy.get("script-src")).toContain(host(WASM_URL));
    expect(policy.get("script-src")).toContain("'wasm-unsafe-eval'");
    for (const url of [WASM_URL, HAND_MODEL_URL, POSE_MODEL_URL]) {
      expect(policy.get("connect-src")).toContain(host(url));
    }
    // Google Fonts: the Inter stylesheet in index.html and the Bengali one, and their files.
    const fonts = [...read("index.html").matchAll(/href="(https:\/\/fonts[^"]+)"/g)].map(
      (m) => m[1],
    );
    for (const url of [...fonts, BENGALI_FONT_URL]) {
      const origin = host(url);
      if (origin === "https://fonts.gstatic.com") expect(policy.get("font-src")).toContain(origin);
      else expect(policy.get("style-src")).toContain(origin);
    }
    // No inline or eval'd scripts, no plugins, no framing.
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("default-src")).toEqual(["'self'"]);
  });

  it("the page itself has no inline script the policy would block", () => {
    const html = read("index.html");
    for (const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(script[1]).toContain("src=");
      expect(script[2].trim()).toBe("");
    }
  });

  it("only this site may use the camera and the muscle sensor's serial port", () => {
    const permissions = SECURITY_HEADERS["Permissions-Policy"];
    expect(permissions).toContain("camera=(self)");
    expect(permissions).toContain("serial=(self)");
    expect(permissions).toContain("microphone=()");
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("text is always text", () => {
  it("no code writes raw HTML or runs strings as code", () => {
    const risky =
      /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/;
    const found = sourceFiles(join(WEB, "src")).filter((file) =>
      risky.test(readFileSync(file, "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("a report with HTML in it is shown as the text it is", () => {
    const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const html = renderToStaticMarkup(
      <FeedbackReportView
        report={{
          language: "en",
          patient_summary: attack,
          highlights: [{ metric_id: "K6", text: attack }],
          suggestions: [{ id: "REST_BREAKS", text: attack }],
          next_session_text: attack,
          therapist_summary: attack,
        }}
        notices={[attack]}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("the global error page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("replaces a crashed page with a friendly message and a way home, without the error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error("secret stack detail at /src/pages/Hidden.tsx:12");
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>,
      ),
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(en["errorPage.title"]);
    expect(alert?.textContent).toContain(en["errorPage.body"]);
    expect(container.querySelector("a")?.textContent).toBe(en["errorPage.home"]);
    expect(container.textContent).not.toContain("secret stack detail");
    act(() => root.unmount());
  });
});
