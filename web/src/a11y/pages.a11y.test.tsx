// @vitest-environment jsdom
/**
 * axe-core (vitest-axe) on the main pages, in English and Bangla, each inside its real layout,
 * with the API answered from ./fixtures.ts. jsdom has no layout, so colour contrast is not
 * measured here (see contrast.test.ts for the theme tokens).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { AdminLayout } from "@/components/layout/AdminLayout";
import { PatientLayout } from "@/components/layout/PatientLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { ToastProvider } from "@/components/ui/Toast";
import { setLanguage } from "@/i18n";
import { AdminAlertsPage } from "@/pages/admin/AdminAlertsPage";
import { AdminOverviewPage } from "@/pages/admin/AdminOverviewPage";
import { AdminPatientDetailPage } from "@/pages/admin/AdminPatientDetailPage";
import { PatientHomePage } from "@/pages/patient/PatientHomePage";
import { PatientProfilePage } from "@/pages/patient/PatientProfilePage";
import { AboutPage } from "@/pages/public/AboutPage";
import { HomePage } from "@/pages/public/HomePage";
import { LoginPage } from "@/pages/public/LoginPage";
import { SessionPlanPage } from "@/pages/session/SessionPlanPage";
import { SessionSummaryPage } from "@/pages/session/SessionSummaryPage";
import type { Language } from "@/types/api";

import { ADMIN_ME, PATIENT_ME, SESSION } from "./fixtures";

const state = vi.hoisted(() => ({ user: null as unknown }));

vi.mock("@/lib/api", async () => {
  const { responseFor } = await import("./fixtures");
  const get = async (url: string) => {
    const data = responseFor(url);
    if (data === undefined)
      throw Object.assign(new Error(`No fixture for ${url}`), { response: { status: 404 } });
    return { data };
  };
  const fail = async () => {
    throw new Error("Not in this test");
  };
  return { api: { get, post: fail, patch: fail, put: fail, delete: fail } };
});

vi.mock("@/features/auth/AuthContext", () => {
  const value = () => ({
    user: state.user,
    token: state.user ? "token" : null,
    isLoading: false,
    login: async () => undefined,
    register: async () => undefined,
    logout: () => undefined,
    language: "en",
    changeLanguage: async () => undefined,
    changeBengaliDigits: async () => undefined,
  });
  return {
    useAuth: value,
    useOptionalAuth: value,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
  };
});

vi.mock("@/features/session/SessionContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/session/SessionContext")>()),
  useSession: () => ({
    sessionId: 7,
    session: SESSION,
    warmupResults: [],
    startGames: () => undefined,
    affectedSide: "left",
    calibration: null,
    latestCalibration: null,
    addWarmupResult: () => undefined,
  }),
  useSessionStep: () => undefined,
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout APIs that the charts and menus use.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  window.scrollTo = () => undefined;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  setLanguage("en");
});

async function render(path: string, routes: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>{routes}</Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  // Let the queries answer and the page draw its content.
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  return container;
}

interface PageCase {
  name: string;
  path: string;
  user: unknown;
  routes: ReactNode;
}

const PAGES: PageCase[] = [
  { name: "landing", path: "/", user: null, routes: <Route path="/" element={<HomePage />} /> },
  {
    name: "about",
    path: "/about",
    user: null,
    routes: (
      <Route element={<PublicLayout />}>
        <Route path="/about" element={<AboutPage />} />
      </Route>
    ),
  },
  {
    name: "login",
    path: "/login",
    user: null,
    routes: (
      <Route
        path="/login"
        element={
          <main>
            <LoginPage />
          </main>
        }
      />
    ),
  },
  {
    name: "patient home",
    path: "/patient",
    user: PATIENT_ME,
    routes: (
      <Route path="/patient" element={<PatientLayout />}>
        <Route index element={<PatientHomePage />} />
      </Route>
    ),
  },
  {
    name: "patient profile (display settings)",
    path: "/patient/profile",
    user: PATIENT_ME,
    routes: (
      <Route path="/patient" element={<PatientLayout />}>
        <Route path="profile" element={<PatientProfilePage />} />
      </Route>
    ),
  },
  {
    name: "plan",
    path: "/session/plan",
    user: PATIENT_ME,
    routes: (
      <Route
        path="/session/plan"
        element={
          <main>
            <SessionPlanPage />
          </main>
        }
      />
    ),
  },
  {
    name: "summary",
    path: "/session/summary",
    user: PATIENT_ME,
    routes: (
      <Route
        path="/session/summary"
        element={
          <main>
            <SessionSummaryPage />
          </main>
        }
      />
    ),
  },
  {
    name: "admin overview",
    path: "/admin",
    user: ADMIN_ME,
    routes: (
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminOverviewPage />} />
      </Route>
    ),
  },
  {
    name: "patient detail",
    path: "/admin/patients/1",
    user: ADMIN_ME,
    routes: (
      <Route path="/admin" element={<AdminLayout />}>
        <Route path="patients/:id" element={<AdminPatientDetailPage />} />
      </Route>
    ),
  },
  {
    name: "alerts",
    path: "/admin/alerts",
    user: ADMIN_ME,
    routes: (
      <Route path="/admin" element={<AdminLayout />}>
        <Route path="alerts" element={<AdminAlertsPage />} />
      </Route>
    ),
  },
];

const LANGUAGES: Language[] = ["en", "bn"];

describe("accessibility of the main pages (axe)", () => {
  for (const language of LANGUAGES) {
    for (const page of PAGES) {
      it(`${page.name} (${language}) has no violations`, async () => {
        state.user = page.user;
        setLanguage(language);
        const container = await render(page.path, page.routes);
        expect(container.textContent?.length ?? 0).toBeGreaterThan(20);
        const results = await axe(document.body, {
          // No layout in jsdom: contrast cannot be computed (checked separately).
          rules: { "color-contrast": { enabled: false } },
        });
        const summary = results.violations.map(
          (violation) =>
            `${violation.id} [${violation.impact}] x${violation.nodes.length}: ${violation.nodes
              .slice(0, 2)
              .map((node) => node.target.join(" "))
              .join(" | ")}`,
        );
        if (summary.length > 0)
          console.log(`AXE ${page.name} (${language})\n  ${summary.join("\n  ")}`);
        expect(summary).toEqual([]);
      });
    }
  }
});
