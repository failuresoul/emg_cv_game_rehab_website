import clsx from "clsx";
import {
  BellRing,
  FlaskConical,
  Gamepad2,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";

import { CreditLine } from "@/components/brand/CreditLine";
import { Button } from "@/components/ui/Button";
import { t, type TranslationKey } from "@/i18n";

import { useStats } from "@/features/admin/hooks";

import { Logo } from "./Logo";

/** The number of open alerts beside "Alerts"; nothing when there are none. */
function OpenAlertsBadge() {
  const stats = useStats();
  const open = stats.data?.open_alerts ?? 0;
  if (open === 0) return null;
  return (
    <span className="bg-danger ml-auto rounded-full px-2 py-0.5 text-sm font-bold text-white tabular-nums">
      <span aria-hidden>{open}</span>
      <span className="sr-only">{t("nav.admin.openAlerts", { n: open })}</span>
    </span>
  );
}
import { UserMenu } from "./UserMenu";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { MAIN_ID, SkipLink, useFocusMainOnNavigate } from "@/components/SkipLink";

const NAV_ITEMS: { to: string; labelKey: TranslationKey; icon: LucideIcon; end?: boolean }[] = [
  { to: "/admin", labelKey: "nav.admin.overview", icon: LayoutDashboard, end: true },
  { to: "/admin/patients", labelKey: "nav.admin.patients", icon: Users },
  { to: "/admin/alerts", labelKey: "nav.admin.alerts", icon: BellRing },
  { to: "/admin/games", labelKey: "nav.admin.games", icon: Gamepad2 },
  { to: "/admin/research", labelKey: "nav.admin.research", icon: FlaskConical },
  { to: "/admin/system", labelKey: "nav.admin.system", icon: Settings },
];

export function AdminLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  useFocusMainOnNavigate();

  return (
    <div className="flex min-h-dvh">
      <SkipLink />
      {menuOpen && (
        <button
          type="button"
          aria-label={t("nav.closeMenu")}
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
        />
      )}

      <aside
        className={clsx(
          "bg-surface fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-black/10 p-4",
          "lg:static lg:flex lg:shrink-0",
          menuOpen ? "flex" : "hidden",
        )}
      >
        <div className="mb-6 flex items-center justify-between gap-2">
          <Logo to="/admin" />
          <Button
            variant="ghost"
            aria-label={t("nav.closeMenu")}
            onClick={() => setMenuOpen(false)}
            className="lg:hidden"
          >
            <X size={24} aria-hidden />
          </Button>
        </div>
        <nav aria-label={t("nav.main")} className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                clsx(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium",
                  isActive ? "bg-primary text-white" : "text-ink hover:bg-primary-light",
                )
              }
            >
              <Icon size={22} aria-hidden />
              {t(labelKey)}
              {to === "/admin/alerts" && <OpenAlertsBadge />}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-surface flex items-center justify-between gap-3 border-b border-black/10 px-4 py-2">
          <Button
            variant="ghost"
            aria-label={t("nav.openMenu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="lg:hidden"
          >
            <Menu size={24} aria-hidden />
          </Button>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitch />
            <UserMenu />
          </div>
        </header>
        <main id={MAIN_ID} tabIndex={-1} className="flex-1 p-4 outline-none lg:p-8">
          <Outlet />
        </main>
        <footer className="border-t border-black/10 px-4 py-4 lg:px-8">
          <CreditLine />
        </footer>
      </div>
    </div>
  );
}
