import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

import { t } from "@/i18n";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const isOnline = () => navigator.onLine;

/** Shown at the top of every page while the browser has no network. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, isOnline, () => true);
  if (online) return null;

  return (
    <div
      role="status"
      className="text-ink fixed inset-x-0 border-b-2 border-amber-600 bg-amber-200 top-0 z-[60] flex items-center justify-center gap-2 px-4 py-2 text-center font-semibold"
    >
      <WifiOff size={22} aria-hidden className="shrink-0" />
      <p>{t("offline.banner")}</p>
    </div>
  );
}
