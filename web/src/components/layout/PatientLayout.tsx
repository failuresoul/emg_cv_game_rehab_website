import clsx from "clsx";
import { FileText, History, House, type LucideIcon, TrendingUp, User } from "lucide-react";
import { NavLink, Outlet, useMatch } from "react-router";

import { CreditLine } from "@/components/brand/CreditLine";
import { StartSessionButton } from "@/features/session/StartSessionButton";
import { t, type TranslationKey } from "@/i18n";

import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { MAIN_ID, SkipLink, useFocusMainOnNavigate } from "@/components/SkipLink";

const NAV_ITEMS: { to: string; labelKey: TranslationKey; icon: LucideIcon; end?: boolean }[] = [
  { to: "/patient", labelKey: "nav.patient.home", icon: House, end: true },
  { to: "/patient/progress", labelKey: "nav.patient.progress", icon: TrendingUp },
  { to: "/patient/history", labelKey: "nav.patient.history", icon: History },
  { to: "/patient/reports", labelKey: "nav.patient.reports", icon: FileText },
  { to: "/patient/profile", labelKey: "nav.patient.profile", icon: User },
];

/**
 * One menu: a row of tabs under the header on tablets and computers, and a bar of large icon tabs
 * fixed to the bottom of the screen on phones, within reach of the thumb.
 */
export function PatientLayout() {
  // The home page has its own Start session button: one main action per screen.
  const isHome = useMatch("/patient") !== null;
  useFocusMainOnNavigate();

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      {/* No backdrop blur: it would make the phone tab bar fixed to the header, not the screen. */}
      <header className="bg-surface sticky top-0 z-30 border-b border-black/10">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:gap-3">
          <Logo to="/patient" />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LanguageSwitch />
            <UserMenu />
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl items-center gap-3 md:px-4 md:pb-2">
          <nav
            aria-label={t("nav.main")}
            className={clsx(
              "bg-surface fixed inset-x-0 bottom-0 z-30 border-t border-black/10 pb-[env(safe-area-inset-bottom)]",
              "md:static md:min-w-0 md:overflow-x-auto md:border-0 md:bg-transparent md:pb-0",
            )}
          >
            <ul className="grid grid-cols-5 md:flex md:gap-1">
              {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => (
                <li key={to} className="min-w-0 md:shrink-0">
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      clsx(
                        "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold",
                        "md:min-h-11 md:flex-row md:gap-2 md:rounded-lg md:px-3 md:text-base md:font-medium md:whitespace-nowrap",
                        isActive
                          ? "text-primary md:bg-primary-light"
                          : "text-muted hover:text-ink md:text-ink md:hover:bg-primary-light",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={clsx(
                            "flex h-8 w-14 items-center justify-center rounded-full transition-colors md:h-auto md:w-auto",
                            isActive && "bg-primary-light md:bg-transparent",
                          )}
                        >
                          <Icon size={22} aria-hidden />
                        </span>
                        <span className="max-w-full truncate md:max-w-none">{t(labelKey)}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          {!isHome && (
            <span className="ml-auto hidden shrink-0 md:inline-flex">
              <StartSessionButton compact />
            </span>
          )}
        </div>
      </header>
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:py-8"
      >
        {!isHome && (
          <div className="mb-6 md:hidden">
            <StartSessionButton compact className="w-full" />
          </div>
        )}
        <Outlet />
      </main>
      {/* On phones the footer leaves room for the tab bar. */}
      <footer className="border-t border-black/10 pb-20 md:pb-0">
        <CreditLine className="mx-auto max-w-6xl px-4 py-4" />
      </footer>
    </div>
  );
}
