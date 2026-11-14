import { Link, Outlet } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { t } from "@/i18n";

import { Logo } from "./Logo";
import { LanguageSwitch } from "@/components/LanguageSwitch";

export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-surface border-b border-black/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Logo />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LanguageSwitch />
            <Link to="/login" className={buttonClasses("ghost")}>
              {t("nav.login")}
            </Link>
            <Link to="/signup" className={buttonClasses("secondary")}>
              {t("signup.action")}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
