import { ensureBengaliFont } from "@/lib/bengaliFont";
import type { Language } from "@/types/api";

import { bn } from "./bn";
import { en } from "./en";
import { isPseudoEnabled, pseudoLocalise } from "./pseudo";

export type TranslationKey = keyof typeof en;

const TRANSLATIONS: Record<Language, Record<TranslationKey, string>> = { en, bn };

let currentLanguage: Language = "en";
let bengaliDigits = false;

/**
 * The Intl locale of a language. English is British English; Bangla is Bangladeshi Bangla with
 * Latin digits (0-9), or Bengali digits (০-৯) when the patient chose them.
 */
export function localeFor(language: Language, withBengaliDigits = false): string {
  if (language === "en") return "en-GB";
  return withBengaliDigits ? "bn-BD" : "bn-BD-u-nu-latn";
}

/** AuthProvider calls this with the chosen language, and remounts the app when it changes. */
export function setLanguage(language: Language): void {
  currentLanguage = language;
  if (typeof document !== "undefined") document.documentElement.lang = language;
  if (language === "bn") ensureBengaliFont();
}

/** The patient's "Show numbers in Bengali digits" setting (only used in Bangla). */
export function setBengaliDigits(on: boolean): void {
  bengaliDigits = on;
}

export function getLocale(): string {
  return localeFor(currentLanguage, bengaliDigits);
}

export function getLanguage(): Language {
  return currentLanguage;
}

/** Fills {name} placeholders; numbers are formatted for the locale (digits included). */
export function format(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  const numbers = new Intl.NumberFormat(getLocale());
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? numbers.format(value) : value;
  });
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const text = format(TRANSLATIONS[currentLanguage][key], params);
  // Development only: every string 40% longer, to find text that overflows.
  return isPseudoEnabled() ? pseudoLocalise(text) : text;
}
