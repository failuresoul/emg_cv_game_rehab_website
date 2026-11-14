import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

import { t } from "@/i18n";

/** The id of every page's main content, the target of the skip link. */
export const MAIN_ID = "main";

/** "Skip to content": the first stop of the Tab key, shown only when focused. */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="bg-primary sr-only z-50 rounded-lg px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      {t("landing.skip")}
    </a>
  );
}

/**
 * After moving to another page or session step, keyboard and screen-reader users continue from
 * the new content instead of the top of the page: focus moves to <main> (not on first load).
 */
export function useFocusMainOnNavigate(): void {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById(MAIN_ID)?.focus();
  }, [pathname]);
}
