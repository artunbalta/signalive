import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/**
 * Recorded NDJSON streams for POST /api/moments and POST /api/agent
 * (tests/fixtures/moments), answered through page.route, so these specs need
 * neither keys nor the server routes. __AUDIO__ in a stream becomes a short
 * quiet tone (the spoken part), __MOMENT__ the id of the first moment the
 * page sent as context.
 */

const DIR = join(__dirname, "..", "fixtures", "moments");

/** A quiet 440 Hz tone, 24 kHz PCM16 as base64, faded in and out. */
export function toneBase64(seconds = 0.35, sr = 24000): string {
  const n = Math.round(seconds * sr);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 480, (n - i) / 480);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 900 * fade), i * 2);
  }
  return buf.toString("base64");
}

export function recorded(name: string, vars: Record<string, string> = {}): string {
  let text = readFileSync(join(DIR, `${name}.ndjson`), "utf8").replace(/__AUDIO__/g, toneBase64());
  for (const [k, v] of Object.entries(vars)) text = text.split(`__${k}__`).join(v);
  return text;
}

const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" };

/**
 * Keeps a copy of every multipart body the page sends to /api/moments,
 * /api/rewind and /api/stt, before it leaves (Playwright cannot read multipart bodies
 * built from Blobs). Runs in the page, as an init script.
 */
export const recordUploads = () => {
  const w = window as unknown as { __uploads: { path: string; meta: string; audio: string }[] };
  w.__uploads = [];
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (["/api/moments", "/api/rewind", "/api/stt"].some((p) => url.includes(p)) && init?.body instanceof FormData) {
      const bytes = new Uint8Array(await (init.body.get("audio") as Blob).arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      w.__uploads.push({ path: new URL(url, location.href).pathname, meta: String(init.body.get("meta")), audio: btoa(bin) });
    }
    return orig(input, init);
  };
};

export async function uploads(page: Page, path: string): Promise<{ meta: Record<string, unknown>; audio: Buffer }[]> {
  const all = await page.evaluate(() => (window as unknown as { __uploads: { path: string; meta: string; audio: string }[] }).__uploads);
  return all.filter((u) => u.path === path).map((u) => ({ meta: JSON.parse(u.meta) as Record<string, unknown>, audio: Buffer.from(u.audio, "base64") }));
}

/** Answers each POST /api/moments with the next of these recorded streams, after a short wait (the server's work). */
export async function mockMoments(page: Page, streams: string[], delayMs = 700) {
  let i = 0;
  await page.route("**/api/moments", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const name = streams[Math.min(i++, streams.length - 1)]!;
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, headers: NDJSON, body: recorded(name) });
  });
}

/** Answers POST /api/agent with recorded streams in turn, and keeps every request body. */
export async function mockAgent(page: Page, streams: string[], delayMs = 400) {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  await page.route("**/api/agent", async (route) => {
    const body = route.request().postDataJSON() as { moments?: { id: string }[] };
    bodies.push(body as Record<string, unknown>);
    const name = streams[Math.min(i++, streams.length - 1)]!;
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, headers: NDJSON, body: recorded(name, { MOMENT: body.moments?.[0]?.id ?? "none" }) });
  });
  return bodies;
}

/** Recognition for spoken questions where the browser cannot stream: POST /api/stt's answer. */
export async function mockRecognition(page: Page, text = "What did Ayşe promise me?") {
  await page.route("**/api/stt", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 200, json: { text, language: "en", provider: "openai", model: "gpt-transcribe", ms: 530 } });
  });
}
