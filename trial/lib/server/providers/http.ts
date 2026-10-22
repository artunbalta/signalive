import "server-only";
import type { Lang } from "@/lib/shared/types";
import { ProviderError } from "./types";

/**
 * fetch with timeouts, the caller's abort signal, and error codes instead of
 * provider messages. Response bodies of failed calls are never read into an
 * error or a log line: some providers echo request content back.
 *
 * timeoutMs bounds the whole call, body included. headersTimeoutMs, when
 * set, bounds only the wait for the response to start, which is what a
 * streaming caller needs: a stream that has started may run long, a request
 * that has not started after a few seconds will not help a spoken reply.
 */
export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number; headersTimeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 20_000, headersTimeoutMs, signal, ...rest } = init;
  const headers = new AbortController();
  const timer = headersTimeoutMs
    ? setTimeout(() => headers.abort(new DOMException("no response", "TimeoutError")), headersTimeoutMs)
    : null;
  const signals = [AbortSignal.timeout(timeoutMs), headers.signal, ...(signal ? [signal] : [])];
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.any(signals) });
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    const name = err instanceof Error ? err.name : "";
    throw new ProviderError(provider, name === "TimeoutError" ? "timeout" : "network");
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    // Drain without reading the content into anything.
    await res.body?.cancel().catch(() => {});
    const code =
      res.status === 401 || res.status === 403 ? "auth"
      : res.status === 429 ? "rate_limited"
      : res.status === 413 ? "too_large"
      : res.status >= 500 ? "upstream"
      : "bad_request";
    throw new ProviderError(provider, code, res.status);
  }
  return res;
}

/**
 * Streams a response body. A dropped connection, or no bytes for idleMs,
 * becomes a ProviderError, so a stream that stalls halfway fails in seconds
 * instead of holding the turn until the overall timeout.
 */
export async function* readBody(
  res: Response,
  provider: string,
  opts: { signal?: AbortSignal; idleMs?: number } = {},
): AsyncIterable<Uint8Array> {
  if (!res.body) return;
  const reader = res.body.getReader();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = opts.idleMs
          ? await Promise.race([
              reader.read(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new ProviderError(provider, "timeout")), opts.idleMs);
              }),
            ])
          : await reader.read();
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        if (opts.signal?.aborted) throw opts.signal.reason ?? err;
        const name = err instanceof Error ? err.name : "";
        throw new ProviderError(provider, name === "TimeoutError" ? "timeout" : "network");
      } finally {
        clearTimeout(timer);
      }
      if (chunk.done) return;
      if (chunk.value && chunk.value.byteLength) yield chunk.value;
    }
  } finally {
    // Ends the request when the caller stops early or a read timed out.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Maps "tr", "tr-TR", "turkish", "Turkish" and the like to our two languages. */
export function toLang(value: unknown): Lang | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "tr" || v.startsWith("tr-") || v === "turkish" || v === "türkçe") return "tr";
  if (v === "en" || v.startsWith("en-") || v === "english") return "en";
  return null;
}

/** Bridges callback style events (a WebSocket) into an async iterator. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
