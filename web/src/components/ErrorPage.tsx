import { HeartHandshake } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { stopSession } from "@/features/session/stopSession";
import { t } from "@/i18n";
import { homeForPath } from "@/lib/homePath";

/**
 * The friendly page shown when something breaks. Saved steps and results are on the server, so
 * the patient loses only what was on screen. "Back to home" reloads the app from scratch.
 */
export function ErrorPage() {
  // A broken page must not leave the camera on or a game loop running.
  useEffect(() => void stopSession(), []);
  const home = homeForPath(window.location.pathname);

  return (
    <main className="bg-background text-ink flex min-h-dvh items-center justify-center p-4">
      <div
        role="alert"
        className="bg-surface flex w-full max-w-lg flex-col items-center gap-4 rounded-xl border border-black/10 p-8 text-center"
      >
        <HeartHandshake size={56} aria-hidden className="text-primary" />
        <h1 className="text-2xl font-bold">{t("errorPage.title")}</h1>
        <p className="text-lg">{t("errorPage.body")}</p>
        {/* A plain link, so the whole app reloads rather than re-rendering the broken part. */}
        <a href={home} className={buttonClasses("primary", "lg")}>
          {t("errorPage.home")}
        </a>
      </div>
    </main>
  );
}

/** Catches errors anywhere below it, including outside the router, and shows ErrorPage. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the browser console for debugging; nothing is sent anywhere.
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? <ErrorPage /> : this.props.children;
  }
}
