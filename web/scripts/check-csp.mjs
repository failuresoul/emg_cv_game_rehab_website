// Checks the Content-Security-Policy in a real browser (Day 18): serves the production build with
// `vite preview` (which sends the same headers as nginx), opens it in headless Chromium, then
// loads what the camera step loads under the policy: MediaPipe's WASM loader script, its WASM
// (compiled), a model file and the Bengali font. Any CSP violation fails. Stops the preview
// server at the end. Run after `npm run build`: npm run check:csp
import { spawn, spawnSync } from "node:child_process";

import { chromium } from "@playwright/test";

const PORT = 4175;
const BASE = `http://localhost:${PORT}`;
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const BENGALI =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap";

const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  shell: true,
  stdio: "ignore",
});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("vite preview did not start");
}

let failed = false;
const browser = await chromium.launch();
try {
  await waitForServer();
  const headers = (await fetch(BASE)).headers;
  console.log(`CSP header: ${headers.get("content-security-policy") ? "present" : "MISSING"}`);
  if (!headers.get("content-security-policy")) failed = true;

  const page = await browser.newPage();
  const violations = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__violations.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });
  for (const path of ["/", "/login", "/about"]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
  }
  const loaded = await page.evaluate(
    async ({ wasm, model, bengali }) => {
      const results = {};
      // The WASM loader script, as MediaPipe adds it.
      results.loaderScript = await new Promise((done) => {
        const script = document.createElement("script");
        script.src = `${wasm}/vision_wasm_internal.js`;
        script.onload = () => done(true);
        script.onerror = () => done(false);
        document.head.appendChild(script);
      });
      try {
        const bytes = await (await fetch(`${wasm}/vision_wasm_internal.wasm`)).arrayBuffer();
        await WebAssembly.compile(bytes);
        results.wasmCompiled = true;
      } catch (error) {
        results.wasmCompiled = String(error);
      }
      try {
        results.modelBytes = (await (await fetch(model)).arrayBuffer()).byteLength;
      } catch (error) {
        results.modelBytes = String(error);
      }
      results.bengaliFont = await new Promise((done) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = bengali;
        link.onload = () => done(true);
        link.onerror = () => done(false);
        document.head.appendChild(link);
      });
      return results;
    },
    { wasm: WASM, model: MODEL, bengali: BENGALI },
  );
  console.log("Loaded under the policy:", JSON.stringify(loaded));
  const caught = [...violations, ...(await page.evaluate(() => window.__violations))];
  console.log(`CSP violations: ${caught.length}`);
  for (const violation of caught) console.log(`  ${violation}`);
  if (caught.length > 0) failed = true;
  if (loaded.loaderScript !== true || loaded.wasmCompiled !== true || !(loaded.modelBytes > 0)) {
    failed = true;
  }
  if (loaded.bengaliFont !== true) failed = true;
} finally {
  await browser.close();
  // Stop the preview server and its child processes before exiting (Windows needs taskkill /t).
  if (process.platform === "win32" && preview.pid) {
    spawnSync("taskkill", ["/pid", String(preview.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    preview.kill();
  }
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
