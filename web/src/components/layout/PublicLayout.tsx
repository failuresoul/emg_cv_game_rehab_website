import { Link, Outlet, useMatch } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { t } from "@/i18n";

import { Logo } from "./Logo";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { MAIN_ID, SkipLink, useFocusMainOnNavigate } from "@/components/SkipLink";

export function PublicLayout() {
  useFocusMainOnNavigate();
  // On phones only the link to the other form is shown, so the header stays one line.
  const onLogin = useMatch("/login") !== null;
  const onSignup = useMatch("/signup") !== null;
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="bg-surface/95 sticky top-0 z-30 border-b border-black/10 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-3">
          <Logo />
          <div className="flex items-center justify-end gap-1.5 sm:gap-2">
            <LanguageSwitch />
            <Link
              to="/login"
              className={buttonClasses("ghost", "md", onLogin ? "max-sm:hidden" : "max-sm:px-2")}
            >
              {t("nav.login")}
            </Link>
            <Link
              to="/signup"
              className={buttonClasses(
                "secondary",
                "md",
                onSignup || !onLogin ? "max-sm:hidden" : "max-sm:px-2",
              )}
            >
              {t("signup.action")}
            </Link>
          </div>
        </div>
      </header>
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 outline-none sm:py-10"
      >
        <Outlet />
      </main>
    </div>
  );
}
