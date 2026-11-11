import { ArrowRight, Lock, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

import { InstitutionLogo } from "@/components/brand/Identity";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { project } from "@/config/project";
import { t } from "@/i18n";

import { HeroPreview } from "./HeroPreview";
import { ABOUT_HREF, Container } from "./shared";

const BACKGROUND = [
  "radial-gradient(900px 520px at 85% 10%, rgba(242,167,121,0.22), transparent 60%)",
  "radial-gradient(800px 600px at 10% 0%, rgba(20,122,117,0.16), transparent 60%)",
  "linear-gradient(180deg, #E8F2F1 0%, #F4F7F7 55%, #FFFFFF 100%)",
].join(", ");

const DOTS = {
  backgroundImage: "radial-gradient(rgba(15,92,92,0.13) 1px, transparent 1.2px)",
  backgroundSize: "26px 26px",
  maskImage: "linear-gradient(180deg, #000 0%, transparent 85%)",
  WebkitMaskImage: "linear-gradient(180deg, #000 0%, transparent 85%)",
} as const;

function SmallLogo({ which }: { which: "institution" | "collaborator" }) {
  return (
    <span className="border-primary/20 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border bg-white">
      <InstitutionLogo
        institution={project[which]}
        height={24}
        fallback="short"
        fallbackClassName="text-primary text-[0.5rem] font-extrabold"
      />
    </span>
  );
}

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative -mt-20 overflow-hidden pt-20 pb-28 lg:pb-36"
      style={{ backgroundImage: BACKGROUND }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0" style={DOTS} />
      <Container className="relative grid items-center gap-12 pt-8 lg:grid-cols-[1fr_1.02fr] lg:gap-10 lg:pt-12">
        <div>
          <p className="inline-flex max-w-full items-center gap-3 rounded-full border border-black/10 bg-white/90 py-1.5 pr-4 pl-1.5 text-[0.75rem] font-semibold text-[#33474E] shadow-[0_6px_18px_-12px_rgba(0,0,0,0.25)]">
            <span className="flex shrink-0 -space-x-1">
              <SmallLogo which="institution" />
              <SmallLogo which="collaborator" />
            </span>
            <span>
              {t("landing.badge", {
                institution: project.institution.shortName,
                collaborator: project.collaborator.name,
              })}
            </span>
          </p>
          <h1
            id="hero-title"
            className="mt-6 mb-5 text-[2.2rem] leading-[1.06] font-extrabold tracking-[-0.025em] sm:text-[3rem] lg:text-[3.5rem]"
          >
            {t("landing.hero.titleStart")}{" "}
            <span className="text-primary">{t("landing.hero.titleHighlight")}</span>
            {t("landing.hero.titleEnd") && <> {t("landing.hero.titleEnd")}</>}
          </h1>
          <p className="text-muted max-w-xl text-[1.1rem]">{t("landing.hero.lead")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/login"
              className={buttonClasses(
                "primary",
                "lg",
                "rounded-xl shadow-[0_10px_24px_-10px_rgba(15,92,92,0.7)]",
              )}
            >
              {t("landing.login")}
              <ArrowRight size={22} aria-hidden />
            </Link>
            <a href={ABOUT_HREF} className={buttonClasses("secondary", "lg", "rounded-xl")}>
              {t("landing.hero.about")}
            </a>
          </div>
          <ul className="mt-8 flex flex-col gap-3 text-[0.85rem] font-medium text-[#3F5258] sm:flex-row sm:gap-6">
            <li className="flex items-center gap-2">
              <Lock size={20} aria-hidden className="text-primary shrink-0" />
              {t("landing.hero.trustVideo")}
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck size={20} aria-hidden className="text-primary shrink-0" />
              {t("landing.hero.trustSafety")}
            </li>
          </ul>
        </div>
        <HeroPreview />
      </Container>
    </section>
  );
}
