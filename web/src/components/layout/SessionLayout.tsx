import { X } from "lucide-react";
import { Link, Outlet, useMatches } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { t, type TranslationKey } from "@/i18n";

/** Set as `handle` on each session route to name the step in the top bar. */
export interface SessionRouteHandle {
  stepKey: TranslationKey;
}

export function SessionLayout() {
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as SessionRouteHandle | undefined;

  return (
    <div className="bg-session-bg flex min-h-dvh flex-col text-white">
      <header className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="text-xl font-semibold">{handle && t(handle.stepKey)}</p>
        <Link to="/patient" className={buttonClasses("secondary")}>
          <X size={20} aria-hidden />
          {t("session.exit")}
        </Link>
      </header>
      <main className="flex flex-1 flex-col p-4">
        <Outlet />
      </main>
    </div>
  );
}
