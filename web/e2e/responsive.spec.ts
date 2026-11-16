/**
 * Responsive layout: every page at a phone, a tablet and a desktop width has no horizontal page
 * scroll (wide tables scroll inside their own box). RESPONSIVE_SHOTS=<folder> also saves a
 * full-page screenshot of each, for looking at the layout.
 */

import type { Page } from "@playwright/test";

import { E2E_ADMIN } from "../playwright.config";

import { Api, expect, loginWithToken, resetDatabase, test } from "./fixtures";

const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

const SHOTS = process.env.RESPONSIVE_SHOTS;

interface Overflow {
  page: number;
  offenders: string[];
}

/** How far the page scrolls sideways, and the elements that stick out (outside scroll boxes). */
async function overflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrolls = (element: Element | null): boolean => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right <= width + 1 && box.left >= -1) continue;
      if (scrolls(element.parentElement)) continue;
      const label =
        element.tagName.toLowerCase() +
        (element.id ? `#${element.id}` : "") +
        (typeof element.className === "string" && element.className
          ? `.${element.className.trim().split(/\s+/).slice(0, 4).join(".")}`
          : "");
      offenders.push(`${label} [${Math.round(box.left)}..${Math.round(box.right)}]`);
      if (offenders.length >= 8) break;
    }
    return { page: document.documentElement.scrollWidth - width, offenders };
  });
}

async function check(page: Page, path: string, label: string): Promise<void> {
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading").first().waitFor();
    // Charts and lazy panels settle after the data arrives.
    await page.waitForTimeout(400);
    const result = await overflow(page);
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/${label}-${size.name}.png`, fullPage: true });
    }
    expect
      .soft(result.page, `${path} at ${size.width}px sticks out: ${result.offenders.join(", ")}`)
      .toBeLessThanOrEqual(1);
  }
}

test.describe("responsive layout", () => {
  let patient: { email: string; password: string; patient_id: number };
  let sessionId: number;

  test.beforeAll(async ({ request }) => {
    const reset = await resetDatabase(request, { demoPatients: true });
    patient = reset.patients[0]!;
    const admin = await Api.admin(request);
    const sessions = await admin.get<{ id: number }[]>(
      `/api/admin/patients/${patient.patient_id}/sessions`,
    );
    sessionId = sessions[0]!.id;
  });

  test("public pages", async ({ page }) => {
    for (const [path, label] of [
      ["/", "home"],
      ["/about", "about"],
      ["/login", "login"],
      ["/signup", "signup"],
      ["/no-such-page", "not-found"],
    ] as const) {
      await check(page, path, label);
    }
  });

  test("patient pages", async ({ page }) => {
    await loginWithToken(page, patient.email, patient.password);
    for (const [path, label] of [
      ["/patient", "patient-home"],
      ["/patient/progress", "patient-progress"],
      ["/patient/history", "patient-history"],
      [`/patient/history/${sessionId}`, "patient-session"],
      ["/patient/reports", "patient-reports"],
      ["/patient/profile", "patient-profile"],
    ] as const) {
      await check(page, path, label);
    }
  });

  test("admin pages", async ({ page }) => {
    await loginWithToken(page, E2E_ADMIN.email, E2E_ADMIN.password);
    for (const [path, label] of [
      ["/admin", "admin-overview"],
      ["/admin/patients", "admin-patients"],
      [`/admin/patients/${patient.patient_id}`, "admin-patient"],
      [`/admin/sessions/${sessionId}`, "admin-session"],
      ["/admin/games", "admin-games"],
      ["/admin/alerts", "admin-alerts"],
      ["/admin/research", "admin-research"],
      ["/admin/system", "admin-system"],
    ] as const) {
      await check(page, path, label);
    }
  });
});
