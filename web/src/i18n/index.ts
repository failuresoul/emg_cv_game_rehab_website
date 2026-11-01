import { en } from "./en";

export type TranslationKey = keyof typeof en;

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const text: string = en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}
