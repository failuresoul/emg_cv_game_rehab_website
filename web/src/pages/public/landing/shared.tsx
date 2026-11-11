import clsx from "clsx";
import type { ReactNode } from "react";

/** Where "About" and "About the project" lead. A section of this page until /about exists. */
export const ABOUT_HREF = "#research";

/** The page's sections, for the navbar's links. */
export const SECTION_IDS = {
  how: "how-it-works",
  games: "games",
  research: "research",
  team: "team",
} as const;

/** The page's content width, with the side gutters. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx("mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-12", className)}>
      {children}
    </div>
  );
}

/** Text in the accent colour, darkened to pass WCAG AA on white and light backgrounds. */
export const ACCENT_TEXT = "text-[#A84B18]";

interface SectionHeaderProps {
  /** The heading's id, for the section's aria-labelledby. */
  id: string;
  kicker: string;
  title: string;
  sub?: string;
  center?: boolean;
}

export function SectionHeader({ id, kicker, title, sub, center = false }: SectionHeaderProps) {
  return (
    <div className={clsx("mb-12 max-w-3xl lg:mb-14", center && "mx-auto text-center")}>
      <p className={clsx("mb-3 text-[0.75rem] font-bold tracking-[0.12em] uppercase", ACCENT_TEXT)}>
        {kicker}
      </p>
      <h2
        id={id}
        className="text-[1.75rem] leading-tight font-extrabold tracking-tight sm:text-[2.25rem] lg:text-[2.45rem]"
      >
        {title}
      </h2>
      {sub && <p className="text-muted mt-4 text-[1.05rem]">{sub}</p>}
    </div>
  );
}
