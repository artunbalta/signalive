import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync(".verify", { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3111", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);

// Walk the whole page first so every scroll reveal has fired. Element
// screenshots capture off-screen nodes in whatever state they are in, so
// without this the lower half of each section photographs as opacity 0.
const h = await p.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < h; y += 500) {
  await p.evaluate((v) => window.scrollTo(0, v), y);
  await p.waitForTimeout(160);
}
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(900);

const ids = ["hero", "problem", "how-it-works", "scrub", "gesture", "use-cases", "plainly", "science", "waitlist"];
for (const id of ids) {
  const el = p.locator(`#${id}`);
  if (!(await el.count())) { console.log("MISSING #" + id); continue; }
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(1000);
  await el.screenshot({ path: `.verify/sec-${id}.png` }).catch((e) => console.log(id, e.message));
  console.log("shot", id);
}
await p.locator("footer").scrollIntoViewIfNeeded();
await p.waitForTimeout(800);
await p.locator("footer").screenshot({ path: ".verify/sec-footer.png" });
console.log("shot footer");
await b.close();
