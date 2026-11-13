import { useEffect } from "react";

/** Noto Sans Bengali from Google Fonts. It is in the font stack (index.css) but only downloaded
 * once Bangla is shown: the Bangla interface, or a Bangla report. */
export const BENGALI_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap";
const LINK_ID = "font-noto-sans-bengali";

/** Adds the font's stylesheet once; true when it was added now. */
export function ensureBengaliFont(doc: Document | undefined = globalThis.document): boolean {
  if (!doc || doc.getElementById(LINK_ID)) return false;
  const link = doc.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = BENGALI_FONT_URL;
  doc.head.appendChild(link);
  return true;
}

/** Loads the Bengali font while `active` (for example, when the text shown is Bangla). */
export function useBengaliFont(active: boolean): void {
  useEffect(() => {
    if (active) ensureBengaliFont();
  }, [active]);
}
