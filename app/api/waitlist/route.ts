import { NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { waitlist } from "@/lib/copy";

/**
 * Waitlist intake.
 *
 * Persistence is pluggable because this repository ships with no credentials.
 * The first adapter whose environment is fully configured wins, and the local
 * file is the last resort so a developer can still submit the form and see the
 * row land somewhere.
 *
 * Error copy comes from lib/copy so the client never has to invent a message
 * for a response it did not expect.
 */

/** The fallback touches the filesystem, so this cannot run on the edge runtime. */
export const runtime = "nodejs";

/** Matches the client check. Permissive on purpose: the confirmation email is the real proof. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** RFC 5321 caps a path at 256 octets including the angle brackets. */
const MAX_EMAIL_LENGTH = 254;

/** A provider that hangs must not hold the request open behind it. */
const PROVIDER_TIMEOUT_MS = 8000;

type Signup = {
  email: string;
  context: string;
  receivedAt: string;
};

type Adapter = {
  name: string;
  send: (signup: Signup) => Promise<void>;
};

/* ==========================================================================
   ADAPTERS
   ========================================================================== */

async function sendToResend(signup: Signup): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) throw new Error("Resend adapter selected without credentials");

  const res = await fetch(
    `https://api.resend.com/audiences/${encodeURIComponent(audienceId)}/contacts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // The contacts endpoint has no free form metadata field, so the answer to
      // the context question is not carried here. If it needs to survive, move
      // to the Supabase adapter or add a second write.
      body: JSON.stringify({ email: signup.email, unsubscribed: false }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    }
  );
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}

async function sendToSupabase(signup: Signup): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase adapter selected without credentials");

  const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/waitlist`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // Nothing downstream reads the inserted row back, and return=minimal keeps
      // table data out of a response made with the service role key.
      Prefer: "return=minimal",
      // Requires a unique index on email. Without one this header is ignored and
      // duplicates simply insert twice, which is survivable.
      "on-conflict": "email",
    },
    body: JSON.stringify({
      email: signup.email,
      context: signup.context,
      created_at: signup.receivedAt,
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Supabase responded ${res.status}`);
}

const FALLBACK_DIR = join(process.cwd(), ".data");
const FALLBACK_FILE = join(FALLBACK_DIR, "waitlist.jsonl");

/**
 * Local development only. Add .data to .gitignore before using this for
 * anything real: the file holds addresses and it is per instance, so it is gone
 * on the next deploy and invisible to any other running container.
 */
async function sendToFile(signup: Signup): Promise<void> {
  console.warn(
    "[waitlist] No provider configured. Set RESEND_API_KEY with RESEND_AUDIENCE_ID, " +
      "or SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY. Falling back to .data/waitlist.jsonl."
  );
  try {
    await mkdir(FALLBACK_DIR, { recursive: true });
    await appendFile(FALLBACK_FILE, `${JSON.stringify(signup)}\n`, "utf8");
  } catch (err) {
    // Most serverless targets mount a read only filesystem. A valid signup must
    // not become a 500 the visitor has to read, so this is logged, not thrown.
    console.error("[waitlist] fallback write failed:", describe(err));
  }
}

function resolveAdapter(): Adapter {
  if (process.env.RESEND_API_KEY && process.env.RESEND_AUDIENCE_ID) {
    return { name: "resend", send: sendToResend };
  }
  if (process.env.RESEND_API_KEY) {
    console.warn(
      "[waitlist] RESEND_API_KEY is set without RESEND_AUDIENCE_ID. Trying the next adapter."
    );
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { name: "supabase", send: sendToSupabase };
  }
  return { name: "file", send: sendToFile };
}

/* ==========================================================================
   HELPERS
   ========================================================================== */

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Production logs are retained and widely readable, so the local part never
 * goes into one. The domain stays because it is what makes a bounce report
 * diagnosable, and it identifies nobody on its own.
 */
function identify(email: string): string {
  if (process.env.NODE_ENV !== "production") return email;
  const at = email.indexOf("@");
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

/* ==========================================================================
   HANDLER
   ========================================================================== */

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest(waitlist.errors.server);
  }
  if (typeof payload !== "object" || payload === null) {
    return badRequest(waitlist.errors.server);
  }

  const { email, context } = payload as { email?: unknown; context?: unknown };

  // Lowercased so the same person cannot join twice under two casings.
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(cleanEmail)) {
    return badRequest(waitlist.errors.email);
  }

  // The select is a closed set, so anything outside it is a malformed client.
  const cleanContext = typeof context === "string" ? context.trim() : "";
  if (!waitlist.contextOptions.includes(cleanContext)) {
    return badRequest(waitlist.errors.context);
  }

  const signup: Signup = {
    email: cleanEmail,
    context: cleanContext,
    receivedAt: new Date().toISOString(),
  };

  const adapter = resolveAdapter();
  try {
    await adapter.send(signup);
  } catch (err) {
    // The provider's own wording is never forwarded: it can leak configuration
    // detail, and the visitor gets one instruction they can act on instead.
    console.error(`[waitlist] ${adapter.name} adapter failed:`, describe(err));
    return NextResponse.json({ error: waitlist.errors.server }, { status: 502 });
  }

  console.log(`[waitlist] stored via ${adapter.name} (${identify(cleanEmail)})`);
  return NextResponse.json({ ok: true });
}
