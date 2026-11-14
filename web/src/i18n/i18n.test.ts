/**
 * `npm run i18n:check`: every English key has Bangla, with the same placeholders; no Bangla value
 * is left in English; and no user-visible text in JSX skips t(). Also the locale, digits and
 * pseudo-localisation rules.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { untranslatedProjectWords } from "@/config/projectText";

import { bn } from "./bn";
import { en } from "./en";
import { format, getLocale, localeFor, setBengaliDigits, setLanguage, t } from "./index";
import { findLiterals } from "./literals";
import { PSEUDO_GROWTH, pseudoLocalise, setPseudoEnabled } from "./pseudo";

/** Every component, as text (Vite reads them; no Node API needed). */
const SOURCES = import.meta.glob<string>("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const BN_SOURCE = import.meta.glob<string>("./bn.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Developer-only pages (/dev/*, left out of production builds) are in English on purpose. */
const EXEMPT = [/^\.\.\/dev\//, /\.test\.tsx$/];

/** Bangla values that rightly have no Bangla letters: names of languages in themselves, units
 * and technical labels. */
const LATIN_IN_BANGLA = new Set<string>([
  "language.en",
  "feedback.language.en",
  "languageSwitch.en",
  "setup.performance",
  "adminSession.fps",
  "landing.preview.mvcUnit",
]);

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the Bangla translation", () => {
  it("has every English key, and nothing else", () => {
    const english = Object.keys(en).sort();
    const bangla = Object.keys(bn).sort();
    expect(english.filter((key) => !(key in bn))).toEqual([]);
    expect(bangla.filter((key) => !(key in en))).toEqual([]);
    expect(bangla.length).toBe(english.length);
  });

  it("keeps every placeholder of the English text", () => {
    const wrong = Object.keys(en).filter(
      (key) =>
        JSON.stringify(placeholders(en[key as keyof typeof en])) !==
        JSON.stringify(placeholders(bn[key as keyof typeof bn])),
    );
    expect(wrong).toEqual([]);
  });

  it("has no value left in English", () => {
    const untranslated = Object.entries(bn).filter(([key, value]) => {
      if (LATIN_IN_BANGLA.has(key)) return false;
      const words = value
        .replace(/\{\w+\}/g, "")
        .replace(
          /MuVi Rehab|KUET|CSE|EMG|MVC|SPARC|SW|mV|Ollama|LLM|CSV|ESP32|USB|L[012]|AI|ID/g,
          "",
        );
      return !/[ঀ-৿]/.test(value) && /[A-Za-z]{3,}/.test(words);
    });
    expect(untranslated.map(([key]) => key)).toEqual([]);
  });

  it("is marked for a native speaker's review", () => {
    expect(Object.values(BN_SOURCE)[0]).toMatch(/^\/\/ Needs review by a native speaker/);
  });

  it("keeps the product name in Latin letters", () => {
    for (const [key, value] of Object.entries(en)) {
      if (value.includes("MuVi Rehab"))
        expect(bn[key as keyof typeof bn], key).toContain("MuVi Rehab");
    }
  });

  it("translates every country and role project.ts describes", () => {
    expect(untranslatedProjectWords()).toEqual([]);
  });
});

describe("text in JSX", () => {
  it("always goes through t(), outside the developer pages", () => {
    const found = Object.entries(SOURCES)
      .filter(([path]) => !EXEMPT.some((pattern) => pattern.test(path)))
      .flatMap(([path, code]) =>
        findLiterals(path, code).map(
          (item) => `${path}:${item.line} ${item.prop ?? "text"}: ${item.text}`,
        ),
      );
    expect(found).toEqual([]);
  });

  it("is found by the checker: text, visible props and string expressions", () => {
    const code = `
      export const A = () => (
        <div title="Hello there" data-x="ignored words">
          Untranslated words
          {"More words"}
          {t("ok")} · 42 –
          <img alt={cond ? "A picture" : t("x")} />
        </div>
      );`;
    expect(findLiterals("x.tsx", code).map((item) => item.text)).toEqual([
      "Hello there",
      "Untranslated words",
      "More words",
      "A picture",
    ]);
  });
});

describe("locale and digits", () => {
  afterEach(() => {
    setLanguage("en");
    setBengaliDigits(false);
  });

  it("uses en-GB, and Bangla with Latin digits unless the patient chose Bengali digits", () => {
    expect(localeFor("en")).toBe("en-GB");
    expect(localeFor("bn")).toBe("bn-BD-u-nu-latn");
    expect(localeFor("bn", true)).toBe("bn-BD");
    setLanguage("bn");
    expect(format("{n}", { n: 123 })).toBe("123");
    setBengaliDigits(true);
    expect(getLocale()).toBe("bn-BD");
    expect(format("{n}", { n: 123 })).toBe("১২৩");
    // English never uses Bengali digits.
    setLanguage("en");
    expect(format("{n}", { n: 1234.5 })).toBe("1,234.5");
  });

  it("sets the page's language", () => {
    // A minimal page: the tests run without a DOM. The font link "exists", so none is added.
    const page = { documentElement: { lang: "en" }, getElementById: () => ({}) };
    vi.stubGlobal("document", page);
    try {
      setLanguage("bn");
      expect(page.documentElement.lang).toBe("bn");
      expect(t("languageSwitch.label")).toBe(bn["languageSwitch.label"]);
      setLanguage("en");
      expect(page.documentElement.lang).toBe("en");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("pseudo-localisation", () => {
  afterEach(() => setPseudoEnabled(null));

  it("makes strings about 40% longer and marks them", () => {
    const text = "Start the session";
    const pseudo = pseudoLocalise(text);
    expect(pseudo.startsWith("⟦Start the session")).toBe(true);
    expect(pseudo.length).toBeGreaterThanOrEqual(Math.round(text.length * (1 + PSEUDO_GROWTH)));
    expect(pseudoLocalise("   ")).toBe("   ");
  });

  it("applies to t() only while on, after filling placeholders", () => {
    setPseudoEnabled(true);
    expect(t("languageSwitch.label")).toMatch(/^⟦Language~+⟧$/);
    setPseudoEnabled(false);
    expect(t("languageSwitch.label")).toBe("Language");
  });
});
