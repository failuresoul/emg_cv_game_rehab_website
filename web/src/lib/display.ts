/**
 * The patient's display settings (stored on their profile) applied to the page: text size (the
 * root font size, so every rem-based size follows), a high-contrast theme, and less motion. The
 * CSS for each lives in styles/index.css under the matching data attribute on <html>.
 */
import type { TextSize } from "@/types/api";

export interface DisplaySettings {
  textSize: TextSize;
  highContrast: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  textSize: "normal",
  highContrast: false,
  reduceMotion: false,
};

/** The root font size for each text size, in px (Normal is the app's own 18 px). */
export const ROOT_FONT_PX: Record<TextSize, number> = { normal: 18, large: 21, xlarge: 24 };

/** The attributes on <html> for the settings. */
export function displayAttributes(settings: DisplaySettings): Record<string, string | null> {
  return {
    "data-text-size": settings.textSize === "normal" ? null : settings.textSize,
    "data-contrast": settings.highContrast ? "high" : null,
    "data-motion": settings.reduceMotion ? "reduce" : null,
  };
}

let reduceMotionSetting = false;

export function applyDisplay(
  settings: DisplaySettings,
  root: HTMLElement | undefined = globalThis.document?.documentElement,
): void {
  reduceMotionSetting = settings.reduceMotion;
  if (!root) return;
  for (const [name, value] of Object.entries(displayAttributes(settings))) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
}

/** Less motion: the patient's setting, or the system's "reduce motion". For code that animates
 * itself (canvas games, scrolling). */
export function prefersReducedMotion(): boolean {
  if (reduceMotionSetting) return true;
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}
