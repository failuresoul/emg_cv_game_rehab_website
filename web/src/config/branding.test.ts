import { describe, expect, it } from "vitest";

/**
 * "MotionLab" is the internal code name. It may stay in identifiers (lower case, such as the
 * storage key motionlab_token) but never in anything a user sees.
 */
const VISIBLE = /MotionLab/;

const i18nFiles = import.meta.glob<string>("/src/i18n/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const sources = import.meta.glob<string>(["/src/**/*.tsx", "!/src/**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const code = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const html = import.meta.glob<string>("/index.html", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Text between JSX tags and string literals in JSX attributes. */
function jsxText(source: string): string[] {
  const between = [...source.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]!);
  const attributes = [...source.matchAll(/\s[\w-]+="([^"]*)"/g)].map((match) => match[1]!);
  return [...between, ...attributes];
}

const visibleIn = (source: string) => jsxText(source).some((text) => VISIBLE.test(text));

describe("no visible MotionLab", () => {
  it("finds the files to scan", () => {
    expect(Object.keys(i18nFiles)).toEqual(
      expect.arrayContaining(["/src/i18n/en.ts", "/src/i18n/bn.ts"]),
    );
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(html)).toEqual(["/index.html"]);
  });

  it("is not in the translations", () => {
    const found = Object.entries(i18nFiles).filter(([, text]) => VISIBLE.test(text));
    expect(found.map(([path]) => path)).toEqual([]);
  });

  it("is not in JSX text or attributes", () => {
    const found = Object.entries(sources).flatMap(([path, source]) =>
      jsxText(source)
        .filter((text) => VISIBLE.test(text))
        .map((text) => `${path}: ${text.trim()}`),
    );
    expect(found).toEqual([]);
  });

  it("is not in the page shell", () => {
    expect(html["/index.html"]).not.toMatch(VISIBLE);
  });

  it("would catch a visible name but not an identifier", () => {
    expect(visibleIn('<h1 className="x">Welcome to MotionLab</h1>')).toBe(true);
    expect(visibleIn('<img alt="MotionLab logo" />')).toBe(true);
    expect(visibleIn('const KEY = "motionlab_token";')).toBe(false);
  });
});

/** Names, institutions and image paths that belong only in src/config/project.ts. */
const IDENTITY =
  /MuVi|Muscle \+ Vision|KUET|Khulna|Queensland|Akhand|Awal|Shadik|Nafis|\/team\/|\/logos\//;

/** The source without its comments, so a comment may still name things. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("identity comes only from project.ts", () => {
  it("is written nowhere else in the code", () => {
    const found = Object.entries(code)
      .filter(([path]) => path !== "/src/config/project.ts")
      .flatMap(([path, source]) =>
        withoutComments(source)
          .split("\n")
          .filter((line) => IDENTITY.test(line))
          .map((line) => `${path}: ${line.trim()}`),
      );
    expect(found).toEqual([]);
  });

  it("would catch a hard-coded name but not one in a comment", () => {
    expect(IDENTITY.test(withoutComments('const who = "Nafis Ahammad";'))).toBe(true);
    expect(IDENTITY.test(withoutComments("/** The KUET logo. */\n// From Queensland."))).toBe(
      false,
    );
  });
});
