import clsx from "clsx";
import {
  FlaskConical,
  Gamepad2,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { clearAuth, getStoredUser } from "@/features/auth/storage";
import { t, type TranslationKey } from "@/i18n";

import { Logo } from "./Logo";

const NAV_ITEMS: { to: string; labelKey: TranslationKey; icon: LucideIcon; end?: boolean }[] = [
  { to: "/admin", labelKey: "nav.admin.overview", icon: LayoutDashboard, end: true },
  { to: "/admin/patients", labelKey: "nav.admin.patients", icon: Users },
  { to: "/admin/games", labelKey: "nav.admin.games", icon: Gamepad2 },
  { to: "/admin/research", labelKey: "nav.admin.research", icon: FlaskConical },
  { to: "/admin/system", labelKey: "nav.admin.system", icon: Settings },
];

export function AdminLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const user = getStoredUser();

  function logout() {
    clearAuth();
    void navigate("/login");
  }

  return (
    <div className="flex min-h-dvh">
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
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            {user && <span className="font-medium">{user.full_name}</span>}
            <Badge>{t("role.admin")}</Badge>
            <Button variant="ghost" onClick={logout}>
              <LogOut size={20} aria-hidden />
              {t("nav.logout")}
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
