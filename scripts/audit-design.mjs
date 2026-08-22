#!/usr/bin/env node
/**
 * Design system audit. Spec part 7.
 *
 *  A. Contrast: every foreground/background pair in the palette, against WCAG AA.
 *  B. Amber inventory: every use of the signal colour, so each one can be
 *     justified as marking an attended or active element.
 *
 * Run: node scripts/audit-design.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();

/* ---- A. Contrast --------------------------------------------------------- */
const P = {
  ink: "#0B0B0C",
  paper: "#FFFFF9",
  fog: "#8A8A8F",
  slate: "#2A2D33",
  signal: "#FFC24B",
  mist: "#B4B4B9",
  // Surface relative rebinds applied inside .surface-paper (see globals.css).
  "fog/paper": "#6E6E73",
  "mist/paper": "#3A3A3F",
};

const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

console.log("\n[A] Contrast against WCAG AA");
console.log("    normal text needs 4.5, large text (18px+ or 14px bold) needs 3.0\n");
const pairs = [
  ["paper", "ink", "body copy on dark sections"],
  ["mist", "ink", "body copy on dark sections"],
  ["fog", "ink", "labels and fine print on dark"],
  ["signal", "ink", "amber marks and the announcement bar"],
  ["ink", "paper", "body copy on light sections"],
  ["fog/paper", "paper", "labels on light sections (rebound)"],
  ["mist/paper", "paper", "secondary copy on light sections (rebound)"],
  ["ink", "signal", "ink text on the amber announcement bar"],
];
let contrastWarnings = 0;
for (const [fg, bg, use] of pairs) {
  const r = ratio(P[fg], P[bg]);
  const normal = r >= 4.5 ? "AA" : "fail";
  const large = r >= 3.0 ? "AA-large" : "fail";
  const flag = normal === "fail" && large === "fail" ? "  <-- UNUSABLE" :
               normal === "fail" ? "  <-- large text only" : "";
  if (normal === "fail") contrastWarnings++;
  console.log(
    `    ${fg.padEnd(7)} on ${bg.padEnd(7)} ${r.toFixed(2).padStart(6)}  ` +
    `${normal.padEnd(5)} ${large.padEnd(9)} ${use}${flag}`
  );
}

/* ---- B. Amber inventory -------------------------------------------------- */
const SKIP = new Set(["node_modules", ".next", ".git", ".assetgen", "public", "out", "docs"]);
const EXT = new Set([".ts", ".tsx", ".css"]);
const walk = (dir, acc = []) => {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (EXT.has(extname(p))) acc.push(p);
  }
  return acc;
};

// Match the token, not the brand name: "Signalive" contains "signal".
const AMBER = /(--color-signal|\b(?:bg|text|border|outline|fill|stroke|from|via|to|ring|shadow|decoration|accent)-signal\b|#FFC24B|#ffc24b)/i;
console.log("\n[B] Amber inventory");
console.log("    every line below must mark something ATTENDED or ACTIVE\n");
let count = 0;
const byFile = new Map();
for (const f of walk(ROOT)) {
  const rel = relative(ROOT, f);
  if (rel.startsWith("scripts/")) continue;
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (!AMBER.test(line)) return;
    // The token definitions themselves are not usages.
    if (rel === "app/globals.css" && /--color-signal:/.test(line)) return;
    count++;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(`${String(i + 1).padStart(4)}  ${line.trim().slice(0, 96)}`);
  });
}
for (const [file, lines] of [...byFile].sort()) {
  console.log(`    ${file}  (${lines.length})`);
  lines.forEach((l) => console.log(`      ${l}`));
}
console.log(`\n    total amber usages: ${count}`);
console.log(
  contrastWarnings
    ? `\nWARNING: ${contrastWarnings} pair(s) fail AA for normal text.\n`
    : "\nAll pairs in use clear AA for normal text.\n"
);
