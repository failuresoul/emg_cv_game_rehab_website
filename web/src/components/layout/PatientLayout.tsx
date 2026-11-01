import clsx from "clsx";
import { FileText, History, House, type LucideIcon, TrendingUp, User } from "lucide-react";
import { NavLink, Outlet, useMatch } from "react-router";

import { StartSessionButton } from "@/features/session/StartSessionButton";
import { t, type TranslationKey } from "@/i18n";

import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";

const NAV_ITEMS: { to: string; labelKey: TranslationKey; icon: LucideIcon; end?: boolean }[] = [
  { to: "/patient", labelKey: "nav.patient.home", icon: House, end: true },
  { to: "/patient/progress", labelKey: "nav.patient.progress", icon: TrendingUp },
  { to: "/patient/history", labelKey: "nav.patient.history", icon: History },
  { to: "/patient/reports", labelKey: "nav.patient.reports", icon: FileText },
  { to: "/patient/profile", labelKey: "nav.patient.profile", icon: User },
];

export function PatientLayout() {
  // The home page has its own Start session button: one main action per screen.
  const isHome = useMatch("/patient") !== null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-surface border-b border-black/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Logo to="/patient" />
          <nav
            aria-label={t("nav.main")}
            className="order-last flex w-full flex-wrap gap-1 lg:order-0 lg:w-auto"
          >
            {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  clsx(
                    "flex min-h-11 items-center gap-2 rounded-lg px-3 font-medium",
                    isActive ? "bg-primary-light text-primary" : "text-ink hover:bg-primary-light",
                  )
                }
              >
                <Icon size={20} aria-hidden />
                {t(labelKey)}
              </NavLink>
            ))}
          </nav>
          {!isHome && <StartSessionButton />}
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
