#!/usr/bin/env node
/**
 * Proves no server secret reaches the browser.
 *
 * Scans everything a browser can download from a production build: the
 * client JavaScript and CSS in .next/static, and the prerendered HTML and RSC
 * payloads in .next/server/app. Fails if it finds
 *   - the value of any secret environment variable present for the build
 *     (from the environment and the .env files Next.js reads), or
 *   - a string shaped like a known provider key.
 *
 * Run it after `next build`, in the same environment as the build. To test
 * the check itself without real keys, build with canary values:
 *
 *   ANTHROPIC_API_KEY=sk-ant-CANARY... ... npm run build && npm run check:bundle
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SECRET_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPGRAM_API_KEY",
  "GROQ_API_KEY",
  "ELEVENLABS_API_KEY",
  "VOYAGE_API_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "ADMIN_API_TOKEN",
];

// Shapes of real keys, in case a key reached the bundle some other way.
const KEY_SHAPES = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{16,}/],
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["Groq key", /gsk_[A-Za-z0-9]{32,}/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{16,}/],
];

function envFiles() {
  const values = {};
  for (const name of [".env", ".env.production", ".env.local", ".env.production.local"]) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return values;
}

const fromFiles = envFiles();
const secrets = SECRET_VARS.map((name) => [name, process.env[name] ?? fromFiles[name]])
  .filter(([, v]) => typeof v === "string" && v.length >= 8);

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const staticDir = join(root, ".next", "static");
if (!existsSync(staticDir)) {
  console.error("[check-bundle] no .next/static: run `next build` first");
  process.exit(2);
}
const files = [
  ...walk(staticDir),
  ...walk(join(root, ".next", "server", "app")).filter((f) => /\.(html|rsc|body|meta)$/.test(f)),
];

let failures = 0;
for (const file of files) {
  const text = readFileSync(file).toString("latin1");
  for (const [name, value] of secrets) {
    if (text.includes(value)) {
      failures++;
      console.error(`  FAIL  ${name} found in ${relative(root, file)}`);
    }
  }
  for (const [label, re] of KEY_SHAPES) {
    const m = re.exec(text);
    if (m) {
      failures++;
      console.error(`  FAIL  ${label} shaped string in ${relative(root, file)}: ${m[0].slice(0, 12)}...`);
    }
  }
}

console.log(
  `[check-bundle] scanned ${files.length} browser facing files for ${secrets.length} secret values and ${KEY_SHAPES.length} key shapes`,
);
if (secrets.length === 0) console.warn("[check-bundle] no secret values were set for this build; only key shapes were checked");
if (failures) {
  console.error(`[check-bundle] ${failures} problem(s)`);
  process.exit(1);
}
console.log("[check-bundle] ok: no secret reaches the browser");
