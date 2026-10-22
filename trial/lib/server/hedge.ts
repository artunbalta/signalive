import "server-only";
import { ProviderError } from "./providers/types";

/**
 * Hedged requests for the voice path.
 *
 * Some provider requests are accepted and then not answered for many
 * seconds. Measured on 2026-10-21 from a fast connection: 3 of 48 OpenAI
 * speech requests waited over 3 s for their first byte, one the full 25 s,
 * while the rest started in about half a second, and an identical request
 * sent a moment later was answered at the usual speed. So when no attempt
 * has produced anything after `afterMs`, another identical attempt starts,
 * and the first one to produce an item is kept; the others are aborted. An
 * attempt that fails before producing anything is replaced the same way,
 * after a short pause.
 *
 * Only for requests that are cheap and safe to repeat: synthesizing one
 * sentence, transcribing a few seconds of audio.
 */

/** Provider failures worth another attempt: slow, unreachable, overloaded. */
export function retryableProviderError(err: unknown): boolean {
  return err instanceof ProviderError && ["timeout", "network", "upstream", "rate_limited"].includes(err.code);
}

export interface HedgeOptions {
  /** Start another attempt when none has produced anything for this long. */
  afterMs: number;
  /** Attempts in total, the first included. */
  maxAttempts?: number;
  /** Pause before replacing an attempt that failed. */
  retryDelayMs?: number;
  signal: AbortSignal;
  /** Failures worth another attempt; any other failure is thrown at once. */
  retryable: (err: unknown) => boolean;
  /** Another attempt is starting: cause is the failure it replaces, or null when the others were only slow. */
  onHedge?: (cause: unknown) => void;
}

interface Attempt<T> {
  controller: AbortController;
  iterator: AsyncIterator<T>;
}

type First<T> = { attempt: Attempt<T>; result: IteratorResult<T> } | { attempt: Attempt<T>; error: unknown };

export async function* hedgeStream<T>(
  start: (signal: AbortSignal) => AsyncIterable<T>,
  opts: HedgeOptions,
): AsyncGenerator<T, void, undefined> {
  const { afterMs, maxAttempts = 3, retryDelayMs = 300, signal, retryable, onHedge } = opts;
  const live = new Map<Attempt<T>, Promise<First<T>>>();
  let launched = 0;
  let nextAt = 0;
  let cause: unknown = null;
  let lastError: unknown = null;

  const launch = () => {
    const controller = new AbortController();
    const iterator = start(AbortSignal.any([signal, controller.signal]))[Symbol.asyncIterator]();
    const attempt = { controller, iterator };
    live.set(
      attempt,
      iterator.next().then(
        (result) => ({ attempt, result }),
        (error: unknown) => ({ attempt, error }),
      ),
    );
    launched++;
    nextAt = performance.now() + afterMs;
  };
  const close = (attempt: Attempt<T>) => {
    attempt.controller.abort();
    void attempt.iterator.return?.(undefined)?.catch(() => undefined);
  };
  let onAbort = () => {};
  const aborted = new Promise<"abort">((resolve) => {
    onAbort = () => resolve("abort");
    signal.addEventListener("abort", onAbort, { once: true });
  });

  let winner: { attempt: Attempt<T>; result: IteratorResult<T> } | null = null;
  launch();
  try {
    while (!winner) {
      if (signal.aborted) throw signal.reason;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const racers: Promise<First<T> | "hedge" | "abort">[] = [...live.values(), aborted];
      if (launched < maxAttempts) {
        racers.push(new Promise((resolve) => (timer = setTimeout(() => resolve("hedge"), Math.max(0, nextAt - performance.now())))));
      } else if (live.size === 0) {
        throw lastError;
      }
      const first = await Promise.race(racers).finally(() => clearTimeout(timer));
      if (first === "abort") throw signal.reason;
      if (first === "hedge") {
        onHedge?.(cause);
        cause = null;
        launch();
        continue;
      }
      live.delete(first.attempt);
      if ("result" in first) {
        winner = first;
        break;
      }
      close(first.attempt);
      if (signal.aborted) throw signal.reason ?? first.error;
      if (!retryable(first.error)) throw first.error;
      lastError = first.error;
      cause = first.error;
      nextAt = Math.min(nextAt, performance.now() + retryDelayMs);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    for (const attempt of live.keys()) close(attempt);
    live.clear();
  }

  const { attempt, result } = winner;
  let finished = false;
  try {
    if (result.done) {
      finished = true;
      return;
    }
    yield result.value;
    for (;;) {
      const next = await attempt.iterator.next();
      if (next.done) {
        finished = true;
        return;
      }
      yield next.value;
    }
  } finally {
    // The caller stopped early, or the stream failed halfway.
    if (!finished) close(attempt);
  }
}

/** hedgeStream for a call with a single result. */
export async function hedgePromise<T>(start: (signal: AbortSignal) => Promise<T>, opts: HedgeOptions): Promise<T> {
  for await (const value of hedgeStream(async function* (signal) {
    yield await start(signal);
  }, opts)) {
    return value;
  }
  throw new Error("hedge: no result");
}
