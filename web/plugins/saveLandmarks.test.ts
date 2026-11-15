import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkRecordingText,
  handleSave,
  LANDMARKS_FOLDER,
  landmarkFilePath,
  saveLandmarksPlugin,
  SaveError,
  type SaveRequest,
} from "./saveLandmarks.ts";

const FOLDER = resolve("/tmp/web/public/test-fixtures/landmarks");
const RECORDING = JSON.stringify({
  format: "muvi-landmarks",
  version: 1,
  frameWidth: 640,
  frameHeight: 480,
  recordedAt: "2026-11-15T00:00:00Z",
  frames: [{ t: 0, b: 120, h: [], p: null, pw: null }],
});

function status(run: () => unknown): number | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof SaveError) return error.status;
    throw error;
  }
}

describe("the save endpoint's file names", () => {
  it.each(["shadik_full", "shadik_full.json", "Take-2", "a"])("accepts %s", (name) => {
    const path = landmarkFilePath(FOLDER, name);
    expect(path).toBe(join(FOLDER, `${name.replace(/\.json$/, "")}.json`));
  });

  it.each([
    "",
    ".json",
    "../secret",
    "..\\secret",
    "../../src/main",
    "sub/file",
    "sub\\file",
    "/etc/passwd",
    "C:\\Windows\\win",
    "C:file",
    "file.txt",
    "file.json.exe",
    "page.html",
    "..",
    ".hidden",
    "-start",
    "name with space",
    "nul",
    "CON",
    "com1",
    "x".repeat(101),
    "file%2F..",
    "file\u0000.json",
  ])("refuses %j", (name) => {
    expect(status(() => landmarkFilePath(FOLDER, name))).toBe(400);
  });
});

describe("the save endpoint's body check", () => {
  it("accepts a landmark recording", () => {
    expect(() => checkRecordingText(RECORDING)).not.toThrow();
  });

  it.each([
    ["not JSON", "{nope"],
    ["another format", JSON.stringify({ format: "other", version: 1, frames: [{}] })],
    ["another version", JSON.stringify({ format: "muvi-landmarks", version: 2, frames: [{}] })],
    ["no frames", JSON.stringify({ format: "muvi-landmarks", version: 1, frames: [] })],
    ["null", "null"],
  ])("refuses %s", (_label, text) => {
    expect(status(() => checkRecordingText(text))).toBe(400);
  });
});

describe("saving", () => {
  let root: string;
  const request = (overrides: Partial<SaveRequest> = {}): SaveRequest => ({
    method: "POST",
    headers: { "content-type": "application/json", "x-muvi-dev": "1" },
    query: new URLSearchParams({ name: "shadik_full" }),
    body: RECORDING,
    ...overrides,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "muvi-save-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes the file into the landmarks folder only", () => {
    expect(handleSave(root, request())).toEqual({
      file: `${LANDMARKS_FOLDER}/shadik_full.json`,
    });
    expect(readFileSync(join(root, LANDMARKS_FOLDER, "shadik_full.json"), "utf8")).toBe(RECORDING);
  });

  it("keeps an existing file unless asked to overwrite it", () => {
    handleSave(root, request());
    expect(status(() => handleSave(root, request()))).toBe(409);
    const overwrite = new URLSearchParams({ name: "shadik_full", overwrite: "1" });
    expect(handleSave(root, request({ query: overwrite })).file).toContain("shadik_full.json");
  });

  it("refuses other methods, a missing dev header, other content types and bad names", () => {
    expect(status(() => handleSave(root, request({ method: "GET" })))).toBe(405);
    expect(
      status(() => handleSave(root, request({ headers: { "content-type": "application/json" } }))),
    ).toBe(403);
    expect(
      status(() =>
        handleSave(root, request({ headers: { "content-type": "text/plain", "x-muvi-dev": "1" } })),
      ),
    ).toBe(415);
    const escape = new URLSearchParams({ name: "../../../outside" });
    expect(status(() => handleSave(root, request({ query: escape })))).toBe(400);
    expect(existsSync(join(root, "outside.json"))).toBe(false);
    expect(status(() => handleSave(root, request({ body: "{}" })))).toBe(400);
  });

  it("exists only on the development server", () => {
    expect(saveLandmarksPlugin().apply).toBe("serve");
  });
});
