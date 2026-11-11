import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { project } from "@/config/project";
import { t } from "@/i18n";

import { AboutPage } from "./AboutPage";

const html = renderToStaticMarkup(
  <MemoryRouter initialEntries={["/about"]}>
    <AboutPage />
  </MemoryRouter>,
);
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/\s+/g, " ");

describe("about page", () => {
  it("leads with the research title as its only main heading", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${project.researchTitle}</h1>`));
  });

  it("covers background, the system, team, collaboration and data handling", () => {
    for (const key of [
      "about.background.home.title",
      "about.background.multimodal.title",
      "about.system.title",
      "about.system.adaptation.title",
      "about.system.metrics.title",
      "about.system.reports.title",
      "about.privacy.title",
      "about.privacy.video.title",
    ] as const) {
      expect(text).toContain(t(key));
    }
    expect(text).toContain(t("about.system.games.title", { n: 9 }));
    expect(text).toContain(
      t("landing.collab.title", {
        institution: project.institution.shortName,
        collaborator: project.collaborator.name,
      }),
    );
  });

  it("marks feedback reports as coming soon", () => {
    const reports = text.slice(text.indexOf(t("about.system.metrics.text")));
    expect(reports).toContain(t("common.comingSoon"));
  });

  it("shows every supervisor and team member from project.ts, with their cards", () => {
    for (const person of [...project.supervisors, ...project.team]) {
      expect(text).toContain(person.name);
      expect(text).toContain(person.affiliation);
      expect(html).toContain(`aria-label="Photo of ${person.name}"`);
    }
    expect(text).toContain("Professor, Dept. of CSE, KUET");
    expect(text).toContain(t("landing.team.supervisors"));
    expect(text).toContain(t("landing.team.researchers"));
  });

  it("falls back to the institutions' names while the logos are not known to exist", () => {
    expect(html).not.toContain("<img");
    expect(text).toContain(project.institution.name);
    expect(text).toContain(project.collaborator.name);
  });

  it("says it is a research prototype, with no version, contact line or code name", () => {
    expect(text).toContain(`${t("landing.notice.title")} ${t("landing.notice.text")}`);
    expect(text).not.toContain(project.version);
    expect(project.contactEmail).toBeNull();
    expect(html).not.toContain("mailto:");
    expect(text).not.toMatch(/MotionLab/);
    expect(text).not.toMatch(/\bAI\b/);
  });
});
