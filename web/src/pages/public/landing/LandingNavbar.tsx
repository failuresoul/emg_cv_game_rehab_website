import clsx from "clsx";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { LogoMark } from "@/components/brand/LogoMark";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { project } from "@/config/project";
import { t, type TranslationKey } from "@/i18n";

import { ABOUT_HREF, Container, PageLink, SECTION_IDS } from "./shared";

const LINKS: { href: string; labelKey: TranslationKey }[] = [
  { href: `#${SECTION_IDS.how}`, labelKey: "landing.nav.how" },
  { href: `#${SECTION_IDS.games}`, labelKey: "landing.nav.games" },
  { href: `#${SECTION_IDS.research}`, labelKey: "landing.nav.research" },
  { href: `#${SECTION_IDS.team}`, labelKey: "landing.nav.team" },
  { href: ABOUT_HREF, labelKey: "landing.nav.about" },
];

const MENU_ID = "landing-menu";

/** Sticky: transparent over the hero, white with a soft blur once the page scrolls. */
export function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const solid = scrolled || open;

  return (
    <header
      className={clsx(
        "sticky top-0 z-40 border-b transition-[background-color,box-shadow,border-color] duration-200",
        solid
          ? "border-black/10 bg-white/85 shadow-[0_8px_24px_-18px_rgba(10,40,45,0.45)] backdrop-blur-md"
          : "border-transparent bg-transparent",
      )}
    >
      <Container>
        <nav aria-label={t("landing.nav.label")} className="flex h-20 items-center gap-4">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-3 rounded-lg"
            aria-label={project.name}
          >
            <LogoMark size={44} />
            <span className="leading-tight" aria-hidden>
              <span className="text-ink block text-[1.3rem] font-extrabold tracking-tight">
                {project.name}
              </span>
              <span className="text-muted hidden text-[0.65rem] font-semibold tracking-[0.08em] uppercase sm:block">
                {project.expansion}
              </span>
            </span>
          </Link>

          <ul className="ml-auto hidden items-center gap-1 lg:flex">
            {LINKS.map((link) => (
              <li key={link.labelKey}>
                <PageLink
                  href={link.href}
                  className="text-ink/80 hover:text-primary hover:bg-primary-light inline-flex min-h-11 items-center rounded-lg px-3 text-[0.9rem] font-medium transition-colors"
                >
                  {t(link.labelKey)}
                </PageLink>
              </li>
            ))}
          </ul>
          <Link
            to="/login"
            className={buttonClasses(
              "primary",
              "md",
              "ml-auto hidden rounded-xl sm:inline-flex lg:ml-4",
            )}
          >
            {t("landing.login")}
            <ArrowRight size={20} aria-hidden />
          </Link>

          <button
            type="button"
            aria-expanded={open}
            aria-controls={MENU_ID}
            aria-label={t(open ? "landing.nav.close" : "landing.nav.menu")}
            onClick={() => setOpen((value) => !value)}
            className="text-ink hover:bg-primary-light ml-auto inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg sm:ml-2 lg:hidden"
          >
            {open ? <X size={26} aria-hidden /> : <Menu size={26} aria-hidden />}
          </button>
        </nav>

        <div id={MENU_ID} hidden={!open} className="pb-5 lg:hidden">
          <ul className="flex flex-col gap-1 border-t border-black/10 pt-3">
            {LINKS.map((link) => (
              <li key={link.labelKey}>
                <PageLink
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="text-ink hover:bg-primary-light flex min-h-12 items-center rounded-lg px-3 font-medium"
                >
                  {t(link.labelKey)}
                </PageLink>
              </li>
            ))}
          </ul>
          <Link
            to="/login"
            className={buttonClasses("primary", "lg", "mt-3 w-full rounded-xl sm:hidden")}
          >
            {t("landing.login")}
            <ArrowRight size={20} aria-hidden />
          </Link>
        </div>
      </Container>
    </header>
  );
}
