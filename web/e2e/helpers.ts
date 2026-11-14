import { type APIRequestContext, expect, type Page } from "@playwright/test";

import { API_PORT } from "../playwright.config";

export const API_URL = `http://localhost:${API_PORT}`;

export interface TestLogin {
  email: string;
  password: string;
  patient_id: number;
  patient_code: string;
}

/** A fresh database with the admin and (by default) the two demo patients. */
export async function resetDatabase(
  request: APIRequestContext,
  options: { demoPatients?: boolean } = {},
): Promise<{ admin_email: string; patients: TestLogin[] }> {
  const response = await request.post(`${API_URL}/api/test/reset`, {
    data: { demo_patients: options.demoPatients ?? true },
    timeout: 120_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

/** A completed session with data for a patient. */
export async function seedSession(
  request: APIRequestContext,
  patientId: number,
  options: { progress?: number; pain?: boolean; daysAgo?: number } = {},
): Promise<number> {
  const response = await request.post(`${API_URL}/api/test/seed-session`, {
    data: {
      patient_id: patientId,
      progress: options.progress ?? 0.5,
      pain: options.pain ?? false,
      days_ago: options.daysAgo ?? 0,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).session_id;
}

/** Waits for the test hooks (window.__muviTest) of a page in test mode. */
export async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => "__muviTest" in window);
}

/** Records every camera request, to prove none is made. Call before page.goto. */
export async function countCameraRequests(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counter = window as unknown as { cameraRequests: number };
    counter.cameraRequests = 0;
    const devices = navigator.mediaDevices;
    if (devices) {
      devices.getUserMedia = () => {
        counter.cameraRequests++;
        return Promise.reject(new DOMException("No camera in tests", "NotFoundError"));
      };
    }
  });
  return () =>
    page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests);
}
