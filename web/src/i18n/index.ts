import type { Language } from "@/types/api";

import { bn } from "./bn";
import { en } from "./en";

export type TranslationKey = keyof typeof en;

const TRANSLATIONS: Record<Language, Record<TranslationKey, string>> = { en, bn };
const LOCALES: Record<Language, string> = { en: "en", bn: "bn-BD" };

let currentLanguage: Language = "en";

/** AuthProvider calls this with the patient's language, and remounts the app when it changes. */
export function setLanguage(language: Language): void {
  currentLanguage = language;
  document.documentElement.lang = language;
}

export function getLocale(): string {
  return LOCALES[currentLanguage];
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const text = TRANSLATIONS[currentLanguage][key];
  if (!params) return text;
  const numbers = new Intl.NumberFormat(getLocale());
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? numbers.format(value) : value;
  });
}
