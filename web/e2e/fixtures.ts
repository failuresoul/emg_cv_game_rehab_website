/**
 * Shared set-up for the end-to-end tests: test-mode settings in every page, the app's own strings
 * (so the same steps work in English and Bangla), and API helpers for preparing data.
 */

import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";

import { API_PORT, E2E_ADMIN } from "../playwright.config";

export { expect };

export const API_URL = `http://localhost:${API_PORT}`;
export const PATIENT_PASSWORD = "e2e-patient-password";

/** The test server's mock model writes these summaries (server app/feedback/llm.py); the
 * template's text differs, so a test can tell them apart. */
export const MOCK_REPORT = {
  en: "You completed today's session. Well done for practising your movements.",
  bn: "আপনি আজকের সেশন শেষ করেছেন। অনুশীলনের জন্য ধন্যবাদ।",
};

export interface TestSettings {
  warmupReps?: number;
  gameTrials?: number;
}

export type Side = "left" | "right";

export interface TestOptions {
  /** Shorter sessions in the fast project; the full project leaves them as they are. */
  testSettings: TestSettings;
}

export const test = base.extend<TestOptions>({
  testSettings: [{}, { option: true }],
  page: async ({ page, testSettings }, provide) => {
    // Every page of the test, before the app's own code: the short settings and a seated person
    // replayed in place of the camera (tests change the movement through window.__muviTest).
    await page.addInitScript((settings) => {
      localStorage.setItem("muvi-test-settings", JSON.stringify(settings));
      if (!localStorage.getItem("muvi-test-replay")) {
        localStorage.setItem("muvi-test-replay", "synth:still");
      }
    }, testSettings);
    // Browser errors appear in the test's output, to explain a failure.
    page.on("pageerror", (error) => console.log(`[browser error] ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`[browser console] ${message.text()}`);
    });
    await provide(page);
  },
});

// ---------------------------------------------------------------------------------------------
// The app's strings.

export type Strings = Record<string, string>;

/** Waits for the test hooks, then gives every string of the page's language. */
export async function strings(page: Page, language?: "en" | "bn"): Promise<Strings> {
  await page.waitForFunction(() => "__muviTest" in window && window.__muviTest?.i18n);
  return page.evaluate(
    (lang) => window.__muviTest!.i18n.values((lang ?? window.__muviTest!.i18n.language()) as "en"),
    language,
  );
}

/**
 * The strings once the page has loaded the user (whose language may differ from the page's
 * first one): after the network is quiet and the start button or a heading is shown.
 */
export async function settledStrings(page: Page): Promise<Strings> {
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading").first().waitFor();
  return strings(page);
}

/** A string with {placeholders} as a pattern, such as "Trial {n} of {total}". */
export function pattern(text: string): RegExp {
  const parts = text
    .split(/\{[a-zA-Z]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(parts.join(".+"));
}

/** The exact string as a pattern (for names that must not match longer ones). */
export function exactly(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}

// ---------------------------------------------------------------------------------------------
// The API.

export class Api {
  readonly request: APIRequestContext;
  readonly token: string;

  constructor(request: APIRequestContext, token: string) {
    this.request = request;
    this.token = token;
  }

  static async login(request: APIRequestContext, email: string, password: string): Promise<Api> {
    const response = await request.post(`${API_URL}/api/auth/login`, {
      form: { username: email, password },
    });
    expect(response.status(), await response.text()).toBe(200);
    return new Api(request, (await response.json()).access_token);
  }

  static admin(request: APIRequestContext): Promise<Api> {
    return Api.login(request, E2E_ADMIN.email, E2E_ADMIN.password);
  }

  private async call<T>(method: string, path: string, data?: unknown, expected = [200, 201, 204]) {
    const response = await this.request.fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}` },
      data,
    });
    expect(expected, `${method} ${path}: ${response.status()} ${await response.text()}`).toContain(
      response.status(),
    );
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.call<T>("GET", path);
  }
  post<T = unknown>(path: string, data?: unknown): Promise<T> {
    return this.call<T>("POST", path, data ?? {});
  }
  put<T = unknown>(path: string, data: unknown): Promise<T> {
    return this.call<T>("PUT", path, data);
  }
  patch<T = unknown>(path: string, data: unknown): Promise<T> {
    return this.call<T>("PATCH", path, data);
  }
}

/** A fresh database with only the admin (and the mock model working again). */
export async function resetDatabase(
  request: APIRequestContext,
  options: { demoPatients?: boolean } = {},
): Promise<{ patients: { email: string; password: string; patient_id: number }[] }> {
  const response = await request.post(`${API_URL}/api/test/reset`, {
    data: { demo_patients: options.demoPatients ?? false },
    timeout: 180_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

export interface TestPatient {
  id: number;
  email: string;
  password: string;
  code: string;
  side: Side;
}

let patientCounter = 0;

/** Creates a patient through the admin API. */
export async function createPatient(
  admin: Api,
  options: { side?: Side; language?: "en" | "bn"; name?: string } = {},
): Promise<TestPatient> {
  patientCounter++;
  const side = options.side ?? "left";
  const email = `e2e.patient${Date.now()}${patientCounter}@example.com`;
  const created = await admin.post<{ id: number; patient_code: string }>("/api/admin/patients", {
    email,
    full_name: options.name ?? `Test Patient ${patientCounter}`,
    password: PATIENT_PASSWORD,
    affected_side: side,
    dominant_side: "right",
    age_band: "60-69",
    months_since_stroke: 6,
  });
  if (options.language)
    await admin.patch(`/api/admin/patients/${created.id}`, { language: options.language });
  return { id: created.id, email, password: PATIENT_PASSWORD, code: created.patient_code, side };
}

/** The patient's programme with some fields changed. */
export async function setProgramme(
  admin: Api,
  patientId: number,
  changes: Record<string, unknown>,
): Promise<void> {
  const current = await admin.get<Record<string, unknown>>(
    `/api/admin/patients/${patientId}/programme`,
  );
  const {
    patient_id: _id,
    library_disabled_games: _disabled,
    updated_at: _at,
    ...fields
  } = current;
  void _id;
  void _disabled;
  void _at;
  await admin.put(`/api/admin/patients/${patientId}/programme`, {
    ...fields,
    ...changes,
    reason: "End-to-end test",
  });
}

/** Logs the browser in with a token from the API (faster than the form; auth.spec uses the form). */
export async function loginWithToken(page: Page, email: string, password: string): Promise<Api> {
  const api = await Api.login(page.request, email, password);
  await page.addInitScript((token) => localStorage.setItem("muvi_token", token), api.token);
  return api;
}

/** Plays the person with the affected arm on `side` (before the camera starts). */
export async function setReplaySide(page: Page, side: Side): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem("muvi-test-replay-side", value), side);
}
