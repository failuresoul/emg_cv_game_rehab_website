/**
 * Development-only endpoint for the guided recorder (/dev/record-guide, Day 18): saves a landmark
 * recording straight into public/test-fixtures/landmarks/<name>.json.
 *
 * Only the development server has it (apply: "serve"); a build never does. It accepts only:
 * - POST to SAVE_LANDMARKS_PATH with the X-Muvi-Dev header and a JSON body (a page on another
 *   site cannot send that header without the server allowing it, so it cannot write files);
 * - a plain file name (letters, digits, "-", "_"; ".json" optional), resolved inside that
 *   one folder;
 * - a body that is a landmark recording, at most MAX_BYTES.
 * An existing file is kept unless the request asks to overwrite it.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";

import type { Plugin } from "vite";

export const SAVE_LANDMARKS_PATH = "/__dev/save-landmarks";
export const LANDMARKS_FOLDER = "public/test-fixtures/landmarks";
export const DEV_HEADER = "x-muvi-dev";
export const MAX_BYTES = 20 * 1024 * 1024;

// No dots, so no other extension and no "..".
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
// Names Windows keeps for devices, which cannot be files.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export class SaveError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The file a name is saved to, inside `folder`; throws a SaveError (400) for anything that is not
 * a plain .json file name in that folder.
 */
export function landmarkFilePath(folder: string, rawName: string): string {
  const name = rawName.endsWith(".json") ? rawName.slice(0, -".json".length) : rawName;
  if (!NAME.test(name)) {
    throw new SaveError(400, "Use a plain .json file name: letters, digits, '-' or '_'");
  }
  if (RESERVED.test(name)) throw new SaveError(400, "That name is reserved");
  const base = resolve(folder);
  const target = resolve(base, `${name}.json`);
  const inside = relative(base, target);
  if (
    inside.startsWith("..") ||
    isAbsolute(inside) ||
    inside.includes("/") ||
    inside.includes("\\")
  ) {
    throw new SaveError(400, "The file must be in the landmarks folder");
  }
  return target;
}

/** Throws a SaveError (400) unless the text is a landmark recording. */
export function checkRecordingText(text: string): void {
  if (text.length > MAX_BYTES) throw new SaveError(413, "The recording is too big");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SaveError(400, "The body is not JSON");
  }
  const recording = value as { format?: unknown; version?: unknown; frames?: unknown } | null;
  if (
    !recording ||
    recording.format !== "muvi-landmarks" ||
    recording.version !== 1 ||
    !Array.isArray(recording.frames) ||
    recording.frames.length === 0
  ) {
    throw new SaveError(400, "The body is not a landmark recording");
  }
}

export interface SaveRequest {
  method: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  query: URLSearchParams;
  body: string;
}

/** Saves a request's recording; returns the saved path relative to the web folder. */
export function handleSave(root: string, request: SaveRequest): { file: string } {
  if (request.method !== "POST") throw new SaveError(405, "Use POST");
  if (request.headers[DEV_HEADER] !== "1") throw new SaveError(403, "Missing the dev header");
  const type = String(request.headers["content-type"] ?? "");
  if (!type.startsWith("application/json")) throw new SaveError(415, "Send JSON");
  const folder = resolve(root, LANDMARKS_FOLDER);
  const target = landmarkFilePath(folder, request.query.get("name") ?? "");
  checkRecordingText(request.body);
  if (existsSync(target) && request.query.get("overwrite") !== "1") {
    throw new SaveError(409, "A file with that name already exists");
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(target, request.body, "utf8");
  return { file: relative(root, target).replaceAll("\\", "/") };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        fail(new SaveError(413, "The recording is too big"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    request.on("error", fail);
  });
}

function reply(response: ServerResponse, status: number, body: object): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

export function saveLandmarksPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: "muvi-save-landmarks",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(SAVE_LANDMARKS_PATH, (request, response) => {
        const query = new URL(request.url ?? "/", "http://localhost").searchParams;
        readBody(request)
          .then((body) => {
            const saved = handleSave(root, {
              method: request.method,
              headers: request.headers,
              query,
              body,
            });
            reply(response, 200, saved);
          })
          .catch((error: unknown) => {
            const status = error instanceof SaveError ? error.status : 500;
            const message = error instanceof Error ? error.message : "Could not save";
            reply(response, status, { error: message });
          });
      });
    },
  };
}
