import { Link } from "react-router";

import { LogoMark } from "@/components/brand/LogoMark";
import { project } from "@/config/project";
import { t } from "@/i18n";

import { ABOUT_HREF, Container, PageLink } from "./shared";
import { countryText, taglineText } from "@/config/projectText";

/** Dark footer. The logos are written as names: the KUET crest loses its lettering when made
 * monochrome with a CSS filter, so neither logo is drawn here. No version number. */
export function LandingFooter() {
  const { institution, collaborator } = project;
  const link =
    "inline-flex min-h-11 items-center rounded text-[#B5CCCA] hover:text-white focus-visible:outline-white";
  return (
    <footer className="mt-20 bg-[#0A1517] pt-16 pb-10 text-[0.9rem] text-[#B5CCCA] lg:mt-28">
      <Container>
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_0.8fr]">
          <div>
            <div className="flex items-center gap-3">
              <LogoMark size={42} />
              <span>
                <span className="block text-[1.2rem] font-extrabold text-white">
                  {project.name}
                </span>
                <span className="block text-[0.8rem]">{taglineText()}</span>
              </span>
            </div>
            <p className="mt-5 flex flex-wrap items-center gap-2 text-[0.8rem] font-semibold tracking-wide text-[#D5E4E2]">
              <span className="rounded-lg border border-[#355257] px-3 py-1.5">
                {institution.shortName}
              </span>
              <span aria-hidden>×</span>
              <span className="rounded-lg border border-[#355257] px-3 py-1.5">
                {collaborator.shortName}
              </span>
            </p>
          </div>
          <div>
            <h2 className="mb-3 text-[0.9rem] font-bold tracking-wide text-white">
              {t("landing.footer.research")}
            </h2>
            <p>
              {institution.department}, {institution.name}, {countryText(institution.country)}
            </p>
            <p className="mt-2">
              {t("landing.research.collaborationText", {
                name: collaborator.name,
                country: countryText(collaborator.country),
              })}
            </p>
          </div>
          <nav aria-label={t("landing.footer.links")}>
            <h2 className="mb-3 text-[0.9rem] font-bold tracking-wide text-white">
              {t("landing.footer.explore")}
            </h2>
            <ul>
              <li>
                <PageLink href={ABOUT_HREF} className={link}>
                  {t("landing.nav.about")}
                </PageLink>
              </li>
              <li>
                <Link to="/login" className={link}>
                  {t("landing.login")}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-[#1D3236] pt-6 text-[0.8rem] text-[#9DB8B5] sm:flex-row sm:justify-between">
          <span>{t("landing.notice.title")}</span>
          <span>{t("landing.footer.video")}</span>
        </div>
      </Container>
    </footer>
  );
}
