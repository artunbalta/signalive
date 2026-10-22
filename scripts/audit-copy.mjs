#!/usr/bin/env node
/**
 * Pre-ship copy audit. Spec Part 7.
 *
 *  1. Zero em dash (U+2014) and en dash (U+2013) in any source file.
 *  2. "mind", "thought", "telepath", "brainwave" appear only in lib/copy.ts
 *     inside the notMind block, where they are being denied.
 *  3. The 83% figure always carries its laboratory qualifier.
 *
 * Run: npm run audit:copy
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", ".assetgen", "public", "out", "test-results", "playwright-report"]);
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".json", ".html", ".md"]);
// The two source briefs are the client's own documents, not output we author,
// and they legitimately discuss the words this audit forbids.
const SOURCE_DOCS = new Set([
  "WEBSITE_BUILD_SPEC.md",
  "AGENT_BRIEF_ear-attention-interface.md",
  // Written by `next dev` in the trial app, in Next.js's own words.
  "trial/AGENTS.md",
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (EXT.has(extname(p))) acc.push(p);
  }
  return acc;
}

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

const files = walk(ROOT);
let failures = 0;
const fail = (msg) => { failures++; console.error("  FAIL  " + msg); };
const pass = (msg) => console.log("  ok    " + msg);

/* ---- 1. Dashes ---------------------------------------------------------- */
console.log("\n[1] em dash and en dash");
let dashHits = 0;
for (const f of files) {
  if (SOURCE_DOCS.has(relative(ROOT, f))) continue;
  const text = readFileSync(f, "utf8");
  text.split("\n").forEach((line, i) => {
    if (line.includes(EM) || line.includes(EN)) {
      dashHits++;
      fail(`${relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
  });
}
if (!dashHits) pass("no em dash or en dash in any source file");

/* ---- 2. Forbidden claims ------------------------------------------------ */
console.log("\n[2] mind / thought / telepathy / brainwave");
const FORBIDDEN = /\b(mind|minds|thought|thoughts|telepath\w*|brainwave\w*)\b/gi;
let claimHits = 0;
for (const f of files) {
  const rel = relative(ROOT, f);
  if (rel === "scripts/audit-copy.mjs" || SOURCE_DOCS.has(rel)) continue;
  const text = readFileSync(f, "utf8");
  text.split("\n").forEach((line, i) => {
    const m = line.match(FORBIDDEN);
    if (!m) return;
    // Permitted only in the denial block of the copy module.
    // Permitted only on the two lines of lib/copy.ts where the claim is denied.
    const permitted =
      rel === "lib/copy.ts" &&
      (line.includes("does not read your mind") ||
        line.includes("Nothing you think is measured"));
    if (!permitted) {
      claimHits++;
      fail(`${rel}:${i + 1}  [${m.join(", ")}]  ${line.trim().slice(0, 80)}`);
    }
  });
}
if (!claimHits) pass("no forbidden claim outside the denial block");

/* ---- 3. The 83% figure -------------------------------------------------- */
console.log("\n[3] the 83% laboratory reference");
const copy = readFileSync(join(ROOT, "lib/copy.ts"), "utf8");
if (!copy.includes("~83%")) fail("the 83% figure is missing from lib/copy.ts");
else {
  const idx = copy.indexOf("~83%");
  const window = copy.slice(idx, idx + 500);
  const hasLab = /laboratory conditions using full scalp sensors/.test(window);
  const hasQualifier = /Published laboratory reference, not a .* product measurement/.test(window);
  if (hasLab && hasQualifier) pass("83% carries both its laboratory framing and its non-product qualifier");
  else fail("the 83% figure has lost its laboratory qualifier and could read as a product claim");
}

console.log(
  failures === 0
    ? "\nCOPY AUDIT PASSED\n"
    : `\nCOPY AUDIT FAILED with ${failures} problem(s)\n`
);
process.exit(failures === 0 ? 1 && 0 : 1);
