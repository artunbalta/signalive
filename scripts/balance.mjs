#!/usr/bin/env node
/**
 * The balance check from the rebalance patch, item 8.
 *
 *  1. Total vertical pixel height devoted to each channel. The gesture channel
 *     must be at least equal to the attention channel.
 *  2. A visitor who scrolls only the first two viewports must have seen the jaw
 *     clench moment.
 *  3. The word "clench" appears above the fold.
 *  4. Reading only the headlines should give two capabilities, not one.
 *
 * Height is measured as laid out height, plus the scroll distance a pinned
 * section consumes, because a pinned section occupies far more of the visitor's
 * scrolling than its own box suggests.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3111";
const VP = { width: 1440, height: 900 };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: VP })).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

let failures = 0;
const ok = (m) => console.log("  ok    " + m);
const bad = (m) => { failures++; console.error("  FAIL  " + m); };

/* ---- 1. Channel weight --------------------------------------------------- */
// Which section belongs to which channel. Sections that argue for both, or for
// neither, are listed as shared and excluded from the comparison.
const CHANNEL = {
  "one-clench": "gesture",
  "the-point": "gesture",
  problem: "attention",
  science: "attention",
  "how-it-works": "split",   // steps 01 and 02 listen, step 03 acts
  "use-cases": "split",      // two listening cards, two acting cards
  hero: "shared",
  scrub: "shared",
  plainly: "shared",
  waitlist: "shared",
};

const measured = await page.evaluate((map) => {
  const out = {};
  for (const id of Object.keys(map)) {
    const el = document.getElementById(id);
    if (!el) { out[id] = null; continue; }
    const r = el.getBoundingClientRect();
    // A pinned section's ScrollTrigger inserts a spacer as its parent, so the
    // scroll cost is the spacer's height, not the section's own.
    const parent = el.parentElement;
    const pinned = parent && parent.className && String(parent.className).includes("pin-spacer");
    out[id] = {
      own: Math.round(r.height),
      scrollCost: Math.round(pinned ? parent.getBoundingClientRect().height : r.height),
      pinned: !!pinned,
    };
  }
  out.__page = document.body.scrollHeight;
  return out;
}, CHANNEL);

console.log("\n[1] vertical weight per channel (scroll cost at 1440x900)\n");
const totals = { gesture: 0, attention: 0, shared: 0 };
for (const [id, kind] of Object.entries(CHANNEL)) {
  const m = measured[id];
  if (!m) { bad(`section #${id} is missing from the page`); continue; }
  const label = `#${id}`.padEnd(16);
  const pin = m.pinned ? "  (pinned)" : "";
  console.log(`    ${label} ${String(m.scrollCost).padStart(6)} px  ${kind}${pin}`);
  if (kind === "split") { totals.gesture += m.scrollCost / 2; totals.attention += m.scrollCost / 2; }
  else if (kind in totals) totals[kind] += m.scrollCost;
}
console.log();
console.log(`    gesture channel   ${Math.round(totals.gesture).toString().padStart(6)} px`);
console.log(`    attention channel ${Math.round(totals.attention).toString().padStart(6)} px`);
console.log(`    shared            ${Math.round(totals.shared).toString().padStart(6)} px`);
const ratio = totals.attention ? totals.gesture / totals.attention : Infinity;
console.log(`    ratio gesture:attention = ${ratio.toFixed(2)}\n`);
ratio >= 1
  ? ok(`gesture channel is at least equal to attention (${ratio.toFixed(2)}x)`)
  : bad(`gesture channel is only ${ratio.toFixed(2)}x the attention channel, it must be >= 1`);

/* ---- 2. The clench inside the first two viewports ------------------------ */
console.log("\n[2] the clench moment within the first two viewports");
await page.mouse.move(720, 450);
const LIMIT = VP.height * 2;
// Small steps: Lenis smooths the scroll, so a coarse wheel overshoots and the
// first sample showing beat 3 can be well past where the beat actually flipped.
let reached = null;
let finalY = 0;
for (let i = 0; i < 120; i++) {
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(70);
  const state = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    beat: document.querySelector("[data-beat-active]")?.getAttribute("data-beat-active") ?? null,
  }));
  finalY = state.y;
  if (reached === null && state.beat !== null && Number(state.beat) >= 2) reached = state;
  if (reached || state.y > LIMIT + 400) break;
}
if (!reached) {
  bad(`beat 3 was never reached (stopped at scrollY ${finalY})`);
} else if (reached.y <= LIMIT) {
  ok(`beat 3 (the clench) active by scrollY ${reached.y}, within the ${LIMIT}px two viewport budget`);
} else {
  bad(`beat 3 only becomes active at scrollY ${reached.y}, past the ${LIMIT}px two viewport budget`);
}

/* ---- 3. "clench" above the fold ----------------------------------------- */
console.log("\n[3] the word clench above the fold");
// Lenis owns the scroll position and ignores window.scrollTo, so the only
// reliable way back to the top is a fresh load. Without this the check reads
// whatever was on screen at the end of check 2 and passes for the wrong reason.
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const atTop = await page.evaluate(() => Math.round(window.scrollY));
if (atTop > 4) bad(`expected to be at the top of the page, scrollY is ${atTop}`);
const aboveFold = await page.evaluate((h) => {
  const hits = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const t = n.textContent || "";
    if (!/clench/i.test(t)) continue;
    const el = n.parentElement;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.top < h && r.bottom > 0 && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.05) {
      hits.push({ text: t.trim().slice(0, 48), top: Math.round(r.top) });
    }
  }
  return hits;
}, VP.height);
aboveFold.length
  ? ok(`"clench" visible in the first viewport: ${aboveFold.map((h) => `"${h.text}" at y=${h.top}`).join(", ")}`)
  : bad('the word "clench" does not appear in the first viewport');

/* ---- 4. Headlines alone give two capabilities ---------------------------- */
console.log("\n[4] headlines alone");
const heads = await page.evaluate(() =>
  [...document.querySelectorAll("h1, h2")]
    .map((h) => h.textContent.replace(/\s+/g, " ").trim())
    .filter(Boolean)
);
heads.forEach((h) => console.log(`    ${h}`));
const listens = heads.some((h) => /listening|voice|follow|hear/i.test(h));
const acts = heads.some((h) => /clench|capture|act on|stop what you are doing|gestures/i.test(h));
listens && acts
  ? ok("headlines alone convey both a listening capability and an acting capability")
  : bad(`headlines convey listening=${listens} acting=${acts}`);

await browser.close();
console.log(failures === 0 ? "\nBALANCE CHECK PASSED\n" : `\nBALANCE CHECK FAILED with ${failures} problem(s)\n`);
process.exit(failures ? 1 : 0);
