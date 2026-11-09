import axios from "axios";

import type { TranslationKey } from "@/i18n";

/** A readable message for a failed request, for toasts. Never the server's own text. */
export function apiErrorKey(error: unknown): TranslationKey {
  if (!axios.isAxiosError(error)) return "apiError.unknown";
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return "apiError.timeout";
  const status = error.response?.status;
  if (status === undefined) return "apiError.network";
  if (status === 401) return "apiError.signedOut";
  if (status === 403) return "apiError.forbidden";
  if (status === 404) return "apiError.notFound";
  if (status === 409) return "apiError.conflict";
  if (status === 413 || status === 422 || status === 400) return "apiError.invalid";
  if (status === 429) return "apiError.tooMany";
  if (status >= 500) return "apiError.server";
  return "apiError.unknown";
}

type Listener = (key: TranslationKey) => void;

const listeners = new Set<Listener>();

/** The toast provider listens here, so code outside React (the query client) can show toasts. */
export function onApiError(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows a toast for a failed request. 401s are left out: they go back to the login page. */
export function reportApiError(error: unknown): void {
  if (axios.isAxiosError(error) && error.response?.status === 401) return;
  const key = apiErrorKey(error);
  listeners.forEach((listener) => listener(key));
}

/** Set as `meta` on a query or mutation that handles its own errors, or saves quietly. */
export const SILENT = { silent: true } as const;

export function isSilent(meta: Record<string, unknown> | undefined): boolean {
  return meta?.silent === true;
}
