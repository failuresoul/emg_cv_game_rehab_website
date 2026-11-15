// Scans the production build (dist/) for anything secret (Day 18): private keys, API keys and
// tokens, the server's setting names (whose values must never reach the browser), the test
// passwords, and test-mode code. Run after `npm run build`: npm run scan:bundle
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

const PATTERNS = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["JWT (signed token)", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["AWS key", /AKIA[0-9A-Z]{16}/],
  ["API key", /\b(sk|pk|rk)-[A-Za-z0-9]{20,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["server setting", /\b(JWT_SECRET|ADMIN_PASSWORD|DATABASE_URL|OLLAMA_URL|LLM_MODEL)\b/],
  ["password value", /password["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i],
  ["test password", /e2e-admin-password|e2e-patient-password|test-password/],
  ["test-mode code", /__muviTest|muvi-test-settings|muvi-landmarks|startTestReplay/],
  [
    "developer pages and test routes",
    /dev\/exercise-lab|dev\/emg-lab|dev\/record-guide|__dev\/save-landmarks|\/api\/test\/|Guided landmark recording|Exercise Lab/,
  ],
  ["source map", /sourceMappingURL=/],
];

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let found = 0;
let scanned = 0;
for (const file of files(DIST)) {
  if (!/\.(js|css|html|json|svg|txt|map)$/.test(file)) continue;
  scanned++;
  const text = readFileSync(file, "utf8");
  for (const [label, pattern] of PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      found++;
      console.log(`${label}: ${file.slice(DIST.length + 1)}: ${match[0].slice(0, 60)}`);
    }
  }
}
if (files(DIST).some((file) => file.endsWith(".map"))) {
  found++;
  console.log("source maps are in the build");
}
console.log(`${scanned} files scanned, ${found} finding(s): ${found ? "FAIL" : "PASS"}`);
process.exit(found ? 1 : 0);
