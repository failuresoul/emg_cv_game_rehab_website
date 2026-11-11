import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { project } from "@/config/project";
import { AdminSystemPage } from "@/pages/admin/AdminSystemPage";
import { HomePage } from "@/pages/public/HomePage";

import { initialsOf, InstitutionLogo, PersonAvatar } from "./Identity";
import { LOGO_MARK, logoMarkSvg } from "./logoShapes";
import { LogoMark } from "./LogoMark";

const escaped = (text: string) => text.replace(/&/g, "&amp;");

describe("logo mark", () => {
  it("draws the same shapes in the app and the favicon", () => {
    const svg = logoMarkSvg();
    const inline = renderToStaticMarkup(<LogoMark size={40} />);
    for (const markup of [svg, inline]) {
      expect(markup).toContain(LOGO_MARK.pulse);
      expect(markup).toContain(LOGO_MARK.background);
      expect(markup).toContain(LOGO_MARK.accent);
      expect(markup.match(/<circle/g)).toHaveLength(2);
    }
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(inline).toContain('aria-hidden="true"');
    expect(inline).toContain('width="40"');
  });

  it("uses the brand colours", () => {
    expect(LOGO_MARK.background).toBe("#0F5C5C");
    expect(LOGO_MARK.accent).toBe("#D9682B");
  });
});

describe("people and institutions", () => {
  it("takes initials from the first and last names, skipping titles", () => {
    expect(initialsOf("Dr. Md. Abdul Awal")).toBe("AA");
    expect(initialsOf("Dr. Muhammad Aminul Haque Akhand")).toBe("MA");
    expect(initialsOf("Nurul Absar Shadik")).toBe("NS");
    expect(initialsOf("Plato")).toBe("P");
    expect(initialsOf("")).toBe("?");
  });

  it("shows initials and a name, never an image, until the photo is known to exist", () => {
    const markup = renderToStaticMarkup(<PersonAvatar person={project.team[0]} />);
    expect(markup).not.toContain("<img");
    expect(markup).toContain(">NS<");
    expect(markup).toContain('aria-label="Nurul Absar Shadik"');
  });

  it("shows the institution's name until its logo is known to exist", () => {
    const markup = renderToStaticMarkup(<InstitutionLogo institution={project.collaborator} />);
    expect(markup).not.toContain("<img");
    expect(markup).toContain("The University of Queensland");
  });
});

describe("where the identity appears", () => {
  it("the admin System page shows the name, version, institution and collaborator", () => {
    const markup = renderToStaticMarkup(<AdminSystemPage />);
    expect(markup).toContain(project.name);
    expect(markup).toContain(`>${project.version}<`);
    expect(markup).toContain(escaped(project.institution.name));
    expect(markup).toContain(project.collaborator.name);
    expect(markup).toContain(project.researchTitle);
  });

  it("the public home page shows the name but no version", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(markup).toContain(project.name);
    expect(markup).not.toContain(project.version);
    expect(markup).not.toContain("MotionLab");
  });
});
