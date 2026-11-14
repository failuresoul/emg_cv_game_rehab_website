/**
 * Pseudo-localisation (development builds only): every translated string becomes about 40%
 * longer, and is marked with brackets, so text that overflows a button or a card shows up, and
 * any text without the brackets did not come through t().
 *
 * Turn it on with ?pseudo=1 in the address (it is remembered), off with ?pseudo=0.
 */

const STORAGE_KEY = "muvi-pseudo";
/** How much longer each string gets; Bangla is often 30-40% longer than English. */
export const PSEUDO_GROWTH = 0.4;

let enabled: boolean | null = null;

function readSetting(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  try {
    const query = new URLSearchParams(window.location.search).get("pseudo");
    if (query === "1") window.localStorage.setItem(STORAGE_KEY, "on");
    if (query === "0") window.localStorage.removeItem(STORAGE_KEY);
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function isPseudoEnabled(): boolean {
  if (enabled === null) enabled = readSetting();
  return enabled;
}

/** For tests. */
export function setPseudoEnabled(on: boolean | null): void {
  enabled = on;
}

/** The text, about 40% longer (at least 2 characters more), inside ⟦ ⟧. Empty text stays empty. */
export function pseudoLocalise(text: string): string {
  if (text.trim() === "") return text;
  const extra = Math.max(2, Math.ceil(text.length * PSEUDO_GROWTH) - 2);
  return `⟦${text}${"~".repeat(extra)}⟧`;
}
