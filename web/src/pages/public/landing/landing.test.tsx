import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { project } from "@/config/project";
import { GAME_IDS, GAMES } from "@/games/shared/registry";
import { t } from "@/i18n";

import { HomePage } from "../HomePage";

const html = renderToStaticMarkup(
  <MemoryRouter>
    <HomePage />
  </MemoryRouter>,
);
/** The page's visible text, without tags, with entities decoded. */
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/\s+/g, " ");

describe("landing page", () => {
  it("uses semantic landmarks with one main heading", () => {
    for (const tag of ["<header", "<nav", "<main", "<footer"]) expect(html).toContain(tag);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('href="#main"');
  });

  it("has the sections in order", () => {
    const order = [
      'id="hero-title"',
      "landing.stats",
      'id="how-it-works"',
      'id="games"',
      'id="research"',
      'id="team"',
      'id="collab-title"',
      'id="privacy-title"',
      'id="cta-title"',
      "<footer",
    ].map((marker) =>
      marker === "landing.stats" ? html.indexOf(t("landing.stats.label")) : html.indexOf(marker),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leads with the headline, the highlight and both ways in", () => {
    expect(text).toContain(t("landing.hero.titleHighlight"));
    expect(html).toMatch(/<span class="text-primary">home rehabilitation<\/span>/);
    expect(html).toContain('href="/login"');
    expect(text).toContain(t("landing.hero.about"));
    expect(text).toContain(
      t("landing.badge", {
        institution: project.institution.shortName,
        collaborator: project.collaborator.name,
      }),
    );
  });

  it("shows the four figures", () => {
    for (const label of [
      "landing.stats.games",
      "landing.stats.warmup",
      "landing.stats.modalities",
      "landing.stats.video",
    ] as const) {
      expect(text).toContain(t(label));
    }
    expect(text).toMatch(/9 adaptive games/);
    expect(text).toMatch(/6 guided warm-up exercises/);
    expect(text).toMatch(/0 video frames uploaded/);
  });

  it("lists every game with its movement", () => {
    for (const id of GAME_IDS) expect(text).toContain(t(GAMES[id].nameKey));
    expect(html.match(/class="grid h-40 place-items-center"/g)).toHaveLength(GAME_IDS.length);
  });

  it("names the research, institutions and every person from project.ts", () => {
    expect(text).toContain(project.researchTitle);
    expect(text).toContain(project.institution.name);
    expect(text).toContain(project.institution.department);
    expect(text).toContain(`In collaboration with ${project.collaborator.name}, Australia`);
    for (const person of [...project.supervisors, ...project.team]) {
      expect(text).toContain(person.name);
      expect(text).toContain(person.affiliation);
    }
  });

  it("shows initials and names, never a broken image, until photos and logos are found", () => {
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-label="Photo of Dr. Md. Abdul Awal"');
    expect(html).toContain(">AA<");
  });

  it("carries the safety notice and no version, code name or AI wording", () => {
    expect(text).toContain(`${t("landing.notice.title")} ${t("landing.notice.text")}`);
    expect(text).not.toContain(project.version);
    expect(text).not.toMatch(/MotionLab/);
    expect(text).not.toMatch(/\bAI\b/);
  });

  it("has a closed, labelled mobile menu", () => {
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="landing-menu"/);
    expect(html).toContain('aria-label="Open the menu"');
    expect(html).toMatch(/id="landing-menu" hidden=""/);
  });

  it("animates only the EMG trace, through a class that index.css limits to no-preference", () => {
    expect(html.match(/class="landing-emg-flow"/g)).toHaveLength(1);
  });
});
