import "server-only";

/**
 * The only logger server code uses. It accepts numbers, booleans and short
 * code-like strings (provider ids, error codes), and silently drops anything
 * else, so a transcript, a note or a model reply cannot end up in a log line
 * even by mistake. Free text has no way through.
 */

type Field = number | boolean | string | null | undefined;
const CODE = /^[a-z0-9_.:\-/]{1,64}$/i;

function clean(fields: Record<string, Field>): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && CODE.test(v)) out[k] = v;
  }
  return out;
}

export function logMetric(event: string, fields: Record<string, Field> = {}) {
  console.log(JSON.stringify({ event, ...clean(fields) }));
}

export function logError(event: string, err: unknown, fields: Record<string, Field> = {}) {
  const code =
    err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
      ? (err as { code: string }).code
      : err instanceof Error
        ? err.name
        : "unknown";
  console.error(JSON.stringify({ event, error: CODE.test(code) ? code : "unknown", ...clean(fields) }));
}
