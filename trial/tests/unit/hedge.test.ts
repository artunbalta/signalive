import { describe, expect, it } from "vitest";
import { hedgePromise, hedgeStream } from "@/lib/server/hedge";
import { ProviderError } from "@/lib/server/providers/types";

const retryable = (e: unknown) => e instanceof ProviderError && e.code !== "auth";

/** Resolves after ms, or rejects when the signal aborts: a request that never answers. */
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

async function collect<T>(it: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const opts = (over: Partial<Parameters<typeof hedgeStream>[1]> = {}) => ({
  afterMs: 30,
  retryDelayMs: 5,
  signal: new AbortController().signal,
  retryable,
  ...over,
});

describe("hedgeStream", () => {
  it("keeps a fast first attempt and starts no other", async () => {
    let starts = 0;
    const out = await collect(
      hedgeStream(async function* () {
        starts++;
        yield 1;
        yield 2;
      }, opts()),
    );
    expect(out).toEqual([1, 2]);
    expect(starts).toBe(1);
  });

  it("sends a second attempt when the first is silent, keeps it, and aborts the first", async () => {
    let n = 0;
    const aborted: boolean[] = [];
    const hedges: unknown[] = [];
    const out = await collect(
      hedgeStream(
        async function* (signal) {
          const me = n++;
          signal.addEventListener("abort", () => (aborted[me] = true));
          if (me === 0) await pause(10_000, signal);
          yield `from ${me}`;
        },
        opts({ onHedge: (c) => hedges.push(c) }),
      ),
    );
    expect(out).toEqual(["from 1"]);
    expect(hedges).toEqual([null]);
    expect(aborted[0]).toBe(true);
    expect(aborted[1]).toBeUndefined();
  });

  it("keeps a slow first attempt that answers before the second", async () => {
    let n = 0;
    const out = await collect(
      hedgeStream(async function* (signal) {
        const me = n++;
        await pause(me === 0 ? 50 : 10_000, signal);
        yield `from ${me}`;
      }, opts()),
    );
    expect(out).toEqual(["from 0"]);
    expect(n).toBe(2);
  });

  it("replaces an attempt that failed before producing anything", async () => {
    let n = 0;
    const hedges: unknown[] = [];
    const out = await collect(
      hedgeStream(
        async function* () {
          if (n++ === 0) throw new ProviderError("x", "upstream", 503);
          yield "ok";
        },
        opts({ onHedge: (c) => hedges.push(c) }),
      ),
    );
    expect(out).toEqual(["ok"]);
    expect(hedges).toHaveLength(1);
    expect((hedges[0] as ProviderError).code).toBe("upstream");
  });

  it("throws at once on a failure not worth repeating", async () => {
    let n = 0;
    // eslint-disable-next-line require-yield
    const run = collect(hedgeStream(async function* () {
      n++;
      throw new ProviderError("x", "auth", 401);
    }, opts()));
    await expect(run).rejects.toMatchObject({ code: "auth" });
    expect(n).toBe(1);
  });

  it("gives up after maxAttempts failures", async () => {
    let n = 0;
    // eslint-disable-next-line require-yield
    const run = collect(hedgeStream(async function* () {
      n++;
      throw new ProviderError("x", "upstream", 503);
    }, opts({ maxAttempts: 3 })));
    await expect(run).rejects.toMatchObject({ code: "upstream" });
    expect(n).toBe(3);
  });

  it("never repeats a stream that has already produced something", async () => {
    let n = 0;
    const seen: number[] = [];
    const run = (async () => {
      for await (const x of hedgeStream(async function* () {
        n++;
        yield 1;
        throw new ProviderError("x", "network");
      }, opts())) seen.push(x);
    })();
    await expect(run).rejects.toMatchObject({ code: "network" });
    expect(seen).toEqual([1]);
    expect(n).toBe(1);
  });

  it("aborts every attempt when the caller aborts", async () => {
    const ac = new AbortController();
    const aborted: boolean[] = [];
    let n = 0;
    const run = collect(
      hedgeStream(async function* (signal) {
        const me = n++;
        signal.addEventListener("abort", () => (aborted[me] = true));
        await pause(10_000, signal);
        yield me;
      }, opts({ signal: ac.signal })),
    );
    setTimeout(() => ac.abort(), 80);
    await expect(run).rejects.toBeDefined();
    expect(n).toBe(3);
    expect(aborted).toEqual([true, true, true]);
  });

  it("closes the stream it kept when the caller stops early", async () => {
    let closed = false;
    for await (const x of hedgeStream(async function* () {
      try {
        yield 1;
        yield 2;
      } finally {
        closed = true;
      }
    }, opts())) {
      expect(x).toBe(1);
      break;
    }
    expect(closed).toBe(true);
  });
});

describe("hedgePromise", () => {
  it("returns whichever attempt answers first", async () => {
    let n = 0;
    const value = await hedgePromise(async (signal) => {
      if (n++ === 0) await pause(10_000, signal);
      return `answer ${n}`;
    }, opts());
    expect(value).toBe("answer 2");
  });
});
