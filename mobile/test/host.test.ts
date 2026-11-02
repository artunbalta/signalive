import { describe, expect, it, vi } from "vitest";
import { BridgeHost } from "../src/bridge/host";
import { Outbox, toInjection } from "../src/bridge/outbox";
import { nativeCall, nativeEvent, nativeResult, parseOutgoing, type NativeOutgoing } from "../src/shared";
import { APP_ORIGIN, APP_URL, handlers } from "./harness";

/** The messages an injection carries, read back as the page would. */
function carried(js: string): NativeOutgoing[] {
  let got: unknown = null;
  new Function("window", js)({ SignaliveNative: { __receive: (m: unknown) => (got = m) } });
  const m = parseOutgoing(got);
  if (!m) throw new Error(`not a message: ${js}`);
  return m.kind === "batch" ? m.messages : [m];
}

function manualOutbox() {
  const injected: string[] = [];
  let due: (() => void) | null = null;
  const outbox = new Outbox((js) => injected.push(js), {
    delayMs: 16,
    maxQueue: 4,
    schedule: (fn) => {
      due = fn;
      return 1;
    },
    cancel: () => {
      due = null;
    },
  });
  return { outbox, injected, tick: () => due?.() };
}

describe("Outbox", () => {
  it("batches events, and sends an answer at once with what waited before it", () => {
    const { outbox, injected, tick } = manualOutbox();
    const a = nativeEvent("ble.bytes", { id: "L", bytes: "AA==" });
    const b = nativeEvent("ble.bytes", { id: "R", bytes: "AQ==" });
    outbox.push(a);
    outbox.push(b);
    expect(injected).toHaveLength(0);
    tick();
    expect(injected).toHaveLength(1);
    expect(carried(injected[0])).toEqual([a, b]);
    const c = nativeEvent("ble.state", { id: "L", state: "disconnected", reason: null });
    const r = nativeResult(5, null);
    outbox.push(c);
    outbox.push(r);
    expect(injected).toHaveLength(2);
    expect(carried(injected[1])).toEqual([c, r]);
    // Nothing left for the timer.
    tick();
    expect(injected).toHaveLength(2);
  });

  it("drops the oldest when the page stops taking them, and everything on clear", () => {
    const { outbox, injected, tick } = manualOutbox();
    for (let i = 0; i < 6; i++) outbox.push(nativeEvent("ble.bytes", { id: `d${i}`, bytes: "AA==" }));
    expect(outbox.size).toBe(4);
    tick();
    expect(carried(injected[0]).map((m) => (m.kind === "event" ? m.data.id : null))).toEqual(["d2", "d3", "d4", "d5"]);
    outbox.push(nativeEvent("ble.bytes", { id: "late", bytes: "AA==" }));
    outbox.clear();
    tick();
    expect(injected).toHaveLength(1);
  });

  it("escapes the two line separators JSON allows and older JavaScript does not", () => {
    const name = `odd${String.fromCharCode(0x2028)}name${String.fromCharCode(0x2029)}`;
    const js = toInjection([nativeResult(1, { name })]);
    expect(js).not.toContain(String.fromCharCode(0x2028));
    expect(js).not.toContain(String.fromCharCode(0x2029));
    expect(carried(js)).toEqual([nativeResult(1, { name })]);
  });

  it("cannot be broken out of by what a device advertises", () => {
    const name = '"});window.pwned=true;({"';
    const page: Record<string, unknown> = { SignaliveNative: { __receive: () => undefined } };
    new Function("window", toInjection([nativeResult(1, { name })]))(page);
    expect(page.pwned).toBeUndefined();
  });
});

describe("BridgeHost", () => {
  function host(overrides = {}) {
    const injected: string[] = [];
    const h = new BridgeHost({
      inject: (js) => injected.push(js),
      appOrigin: APP_ORIGIN,
      handlers: handlers(overrides),
      outbox: { delayMs: 0, schedule: (fn) => queueMicrotask(fn), cancel: () => undefined },
    });
    return { h, injected };
  }

  it("answers the app's own pages only", async () => {
    const info = vi.fn(() => ({}) as never);
    const { h, injected } = host({ info });
    const raw = JSON.stringify(nativeCall(1, "info", {}));
    for (const from of [undefined, "", "https://evil.example/", "https://trial.signalive.com.evil.example/", "http://trial.signalive.com/", "about:blank"]) {
      await h.receive(raw, from);
    }
    expect(info).not.toHaveBeenCalled();
    expect(injected).toEqual([]);
    // Android reports the sender's origin, iOS its full URL: both are the app.
    await h.receive(raw, APP_ORIGIN);
    await h.receive(raw, APP_URL);
    expect(info).toHaveBeenCalledTimes(2);
    expect(injected).toHaveLength(2);
  });

  it("drops an answer owed to a page that has gone", async () => {
    let finish: (v: null) => void = () => undefined;
    const { h, injected } = host({ "haptics.impact": () => new Promise<null>((r) => (finish = r)) });
    const answered = h.receive(JSON.stringify(nativeCall(1, "haptics.impact", {})), APP_URL);
    h.pageChanged();
    finish(null);
    await answered;
    expect(injected).toEqual([]);
  });

  it("sends events through the outbox", async () => {
    const { h, injected } = host();
    h.emit("ble.state", { id: "L", state: "connected", reason: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(carried(injected[0])).toEqual([nativeEvent("ble.state", { id: "L", state: "connected", reason: null })]);
  });
});
