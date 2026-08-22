#!/usr/bin/env node
/**
 * Browser verification against the ship checklist (spec part 7).
 *
 * Usage: node scripts/verify.mjs [baseUrl] [--engine=chromium|webkit]
 */
import { chromium, webkit } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const engineArg = process.argv.find((a) => a.startsWith("--engine="));
const engineName = engineArg ? engineArg.split("=")[1] : "chromium";
const engine = engineName === "webkit" ? webkit : chromium;

const OUT = ".verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (m) => console.log("  ok    " + m);
const bad = (m) => { failures++; console.error("  FAIL  " + m); };

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const browser = await engine.launch();
console.log(`\n=== ${engineName} against ${BASE} ===`);

/* ---- 1. Console errors + horizontal overflow + landmarks at each width ---- */
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2600); // let the intro sequence finish

  console.log(`\n[${vp.name} ${vp.width}px]`);

  const realErrors = errors.filter(
    (e) => !/favicon|Failed to load resource.*404.*favicon/i.test(e)
  );
  realErrors.length ? bad(`console errors: ${realErrors.slice(0, 4).join(" | ")}`)
                    : ok("no console errors");

  // Horizontal overflow: the body must never scroll sideways.
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return { scrollW: de.scrollWidth, clientW: de.clientWidth };
  });
  overflow.scrollW > overflow.clientW + 1
    ? bad(`horizontal overflow: scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`)
    : ok("no horizontal overflow");

  // Find the widest offender if there is one, it makes the fix obvious.
  if (overflow.scrollW > overflow.clientW + 1) {
    const culprits = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      return [...document.querySelectorAll("*")]
        .map((el) => { const r = el.getBoundingClientRect();
          return { sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0,2).join(".") : ""), right: Math.round(r.right) }; })
        .filter((x) => x.right > w + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 5);
    });
    culprits.forEach((c) => console.error(`         overflows to ${c.right}px: ${c.sel}`));
  }

  const h1 = await page.locator("h1").count();
  h1 === 1 ? ok("exactly one h1") : bad(`expected 1 h1, found ${h1}`);

  const landmarks = await page.evaluate(() => ({
    main: !!document.querySelector("main"),
    nav: !!document.querySelector("nav"),
    footer: !!document.querySelector("footer"),
  }));
  landmarks.main && landmarks.nav && landmarks.footer
    ? ok("main, nav and footer landmarks present")
    : bad(`missing landmarks: ${JSON.stringify(landmarks)}`);

  const imgsNoAlt = await page.locator("img:not([alt])").count();
  imgsNoAlt === 0 ? ok("every img has an alt attribute") : bad(`${imgsNoAlt} img without alt`);

  await page.screenshot({ path: `${OUT}/${engineName}-${vp.name}-top.png` });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${engineName}-${vp.name}-bottom.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${engineName}-${vp.name}-full.png`, fullPage: true });
  await ctx.close();
}

/* ---- 2. Keyboard focus visibility ---------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  console.log("\n[keyboard]");

  const seen = [];
  let invisible = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 32),
        outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        visible: r.width > 0 && r.height > 0,
      };
    });
    if (!info) break;
    seen.push(info);
    if (info.visible && !info.outline) invisible++;
  }
  // WebKit ships with "Tab highlights each item" off, so Tab visits form
  // controls and anything with an explicit tabindex, but skips links and
  // buttons. That is a Safari preference, not a page defect: every control
  // here is a native <a> or <button> and is reachable once it is enabled.
  // Chromium is the meaningful check for tab coverage.
  const MIN_STOPS = engineName === "webkit" ? 3 : 7;
  seen.length >= MIN_STOPS
    ? ok(
        `${seen.length} focusable stops reached by Tab` +
          (engineName === "webkit"
            ? " (Safari tabs to form controls only by default)"
            : "")
      )
    : bad(`only ${seen.length} focusable stops reached`);
  invisible === 0 ? ok("every focused element shows a focus ring")
                  : bad(`${invisible} focused element(s) had no visible outline`);
  await ctx.close();
}

/* ---- 3. Reduced motion --------------------------------------------------- */
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  console.log("\n[prefers-reduced-motion: reduce]");

  errors.length ? bad(`page errors: ${errors.slice(0,3).join(" | ")}`) : ok("no page errors");

  // Nothing should still be sitting at its hidden start state.
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll("[data-reveal]")].filter(
      (el) => parseFloat(getComputedStyle(el).opacity) < 0.9
    ).length
  );
  hidden === 0 ? ok("all revealed content is visible")
               : bad(`${hidden} element(s) still hidden under reduced motion`);

  const playing = await page.evaluate(() =>
    [...document.querySelectorAll("video")].filter((v) => !v.paused).length
  );
  playing === 0 ? ok("no video autoplays") : bad(`${playing} video(s) autoplaying`);

  await page.screenshot({ path: `${OUT}/${engineName}-reduced-motion.png`, fullPage: true });
  await ctx.close();
}

/* ---- 4. No audio without a gesture --------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  console.log("\n[audio]");
  const audioState = await page.evaluate(() =>
    [...document.querySelectorAll("audio")].map((a) => ({ paused: a.paused, muted: a.muted }))
  );
  const anyPlaying = audioState.some((a) => !a.paused);
  anyPlaying ? bad("audio is playing before any user gesture")
             : ok(`audio present (${audioState.length} tracks) and silent on load`);
  await ctx.close();
}

await browser.close();
console.log(
  failures === 0
    ? `\nVERIFY PASSED (${engineName})\n`
    : `\nVERIFY FAILED (${engineName}) with ${failures} problem(s)\n`
);
process.exit(failures ? 1 : 0);
