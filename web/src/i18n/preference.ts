import type { Language } from "@/types/api";

/** The language of visitors and admins, kept in this browser. Patients keep theirs in their
 * profile instead, so their feedback reports follow it. */
const STORAGE_KEY = "muvi-language";

export function readStoredLanguage(): Language {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "bn" ? "bn" : "en";
  } catch {
    return "en";
  }
}

export function storeLanguage(language: Language): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, language);
  } catch {
    // Private windows may refuse; the choice then lasts until the page is closed.
  }
}
