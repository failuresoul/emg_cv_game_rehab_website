import { Link, Outlet } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { t } from "@/i18n";

import { Logo } from "./Logo";

export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-surface border-b border-black/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Logo />
          <Link to="/login" className={buttonClasses("secondary")}>
            {t("nav.login")}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
