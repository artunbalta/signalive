import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInjectedScript } from "../src/bridge/injected";
import { toInjection } from "../src/bridge/outbox";
import {
  NATIVE_CALL_TIMEOUT_MS,
  NATIVE_CHANNEL,
  NATIVE_ERROR_NAMES,
  NATIVE_READY_EVENT,
  decodeBase64,
  nativeEvent,
  nativeFailure,
  nativeResult,
  parseCall,
  validateParams,
  type NativeBytesEvent,
  type NativeStateEvent,
} from "../src/shared";
import { APP_ORIGIN, connected, fakePage } from "./harness";

afterEach(() => {
  vi.useRealTimers();
});

describe("the injected bridge", () => {
  it("defines window.SignaliveNative on the app's own pages, once, and says so", () => {
    const page = fakePage();
    expect(page.api).toBeDefined();
    expect(page.api.version).toBe(1);
    expect(page.api.platform).toBe("ios");
    expect(page.readyEvents).toEqual([NATIVE_READY_EVENT]);
    // The second injection (after load) finds it there and leaves it.
    const first = page.api;
    page.run(buildInjectedScript({ origin: APP_ORIGIN, platform: "ios" }));
    expect(page.api).toBe(first);
    expect(page.readyEvents).toHaveLength(1);
    // The page cannot replace it, and the shell's way in is not enumerable.
    expect(() => {
      (page.window as Record<string, unknown>).SignaliveNative = {};
    }).toThrow(TypeError);
    expect(Object.keys(page.api)).not.toContain("__receive");
  });

  it("is not defined on any other origin", () => {
    for (const origin of ["https://evil.example", "http://trial.signalive.com", "https://trial.signalive.com:8443", "null"]) {
      expect(fakePage({ origin }).window.SignaliveNative).toBeUndefined();
    }
  });

  it("posts calls the shell's parser accepts, with params that validate", () => {
    const page = fakePage();
    void page.api.info();
    void page.api.ble.scan(2500);
    void page.api.ble.connect("AA:BB:CC:DD:EE:FF");
    void page.api.ble.write("AA:BB:CC:DD:EE:FF", new Uint8Array([0x53, 0x4c, 0, 5]));
    void page.api.ble.write("AA:BB:CC:DD:EE:FF", "U0wABQ==");
    void page.api.ble.disconnect("AA:BB:CC:DD:EE:FF");
    void page.api.calendar.addEvent({ title: "Dinner", start: "2026-11-06T17:00:00.000Z", end: "2026-11-06T18:00:00.000Z", allDay: false, location: null, notes: null, alarmMinutes: 15 });
    void page.api.calendar.addReminder({ title: "Call back", due: "2026-11-06T09:00:00.000Z", notes: null });
    void page.api.haptics.impact("light");
    void page.api.haptics.impact();
    void page.api.location.current();
    const calls = page.posted.map((raw) => parseCall(raw));
    expect(calls.every((c) => c !== null && c.channel === NATIVE_CHANNEL)).toBe(true);
    expect(calls.map((c) => c!.method)).toEqual([
      "info",
      "ble.scan",
      "ble.connect",
      "ble.write",
      "ble.write",
      "ble.disconnect",
      "calendar.addEvent",
      "calendar.addReminder",
      "haptics.impact",
      "haptics.impact",
      "location.current",
    ]);
    for (const c of calls) {
      const v = validateParams(c!.method as never, c!.params);
      expect(v.ok, `${c!.method}: ${JSON.stringify(v)}`).toBe(true);
    }
    // A Uint8Array is written as base64.
    const write = calls[3]!.params as { bytes: string };
    expect(Array.from(decodeBase64(write.bytes)!)).toEqual([0x53, 0x4c, 0, 5]);
    // Every id is different.
    expect(new Set(calls.map((c) => c!.id)).size).toBe(calls.length);
  });

  it("settles each call with the shell's answer, and turns failures into named errors", async () => {
    const page = fakePage();
    const ok = page.api.info();
    const bad = page.api.ble.connect("nope");
    const [a, b] = page.posted.map((raw) => parseCall(raw)!);
    page.run(toInjection([nativeFailure(b.id, "bluetooth_off", "Bluetooth is off"), nativeResult(a.id, { platform: "ios" })]));
    await expect(ok).resolves.toEqual({ platform: "ios" });
    const err = await bad.catch((e: unknown) => e);
    expect(err).toMatchObject({ name: NATIVE_ERROR_NAMES.bluetooth_off, code: "bluetooth_off", message: "Bluetooth is off" });
  });

  it("ignores answers to calls it never made, and anything malformed", async () => {
    const page = fakePage();
    const pending = page.api.info();
    const id = parseCall(page.posted[0])!.id;
    for (const junk of [null, 42, "x", { channel: "other", kind: "result", id, ok: true, value: 1 }, { channel: NATIVE_CHANNEL, kind: "result", id: id + 1, ok: true, value: 1 }]) {
      (page.api as unknown as { __receive(m: unknown): void }).__receive(junk);
    }
    page.run(toInjection([nativeResult(id, "the real one")]));
    await expect(pending).resolves.toBe("the real one");
  });

  it("hands events to their listeners until they unsubscribe, and drops malformed ones", () => {
    const page = fakePage();
    const bytes: NativeBytesEvent[] = [];
    const states: NativeStateEvent[] = [];
    const offBytes = page.api.ble.onBytes((e) => bytes.push(e));
    page.api.ble.onState((e) => states.push(e));
    page.run(
      toInjection([
        nativeEvent("ble.bytes", { id: "L", bytes: "U0w=" }),
        nativeEvent("ble.state", { id: "L", state: "disconnected", reason: "out of range" }),
        { ...nativeEvent("ble.bytes", { id: "L", bytes: "U0w=" }), data: { id: "L" } } as never,
        { ...nativeEvent("ble.state", { id: "L", state: "connected", reason: null }), data: { id: 7, state: "connected" } } as never,
        { ...nativeEvent("ble.state", { id: "L", state: "connected", reason: null }), event: "ble.other" } as never,
      ]),
    );
    expect(bytes).toEqual([{ id: "L", bytes: "U0w=" }]);
    expect(states).toEqual([{ id: "L", state: "disconnected", reason: "out of range" }]);
    offBytes();
    page.run(toInjection([nativeEvent("ble.bytes", { id: "L", bytes: "AA==" })]));
    expect(bytes).toHaveLength(1);
  });

  it("keeps a throwing listener from stopping the others", () => {
    vi.useFakeTimers();
    const page = fakePage();
    const seen: string[] = [];
    page.api.ble.onBytes(() => {
      throw new Error("a page bug");
    });
    page.api.ble.onBytes((e) => seen.push(e.id));
    page.run(toInjection([nativeEvent("ble.bytes", { id: "R", bytes: "AA==" })]));
    expect(seen).toEqual(["R"]);
    // The error is rethrown on its own, where the page's error reporting sees it.
    expect(() => vi.runAllTimers()).toThrow("a page bug");
  });

  it("gives up on a call that is never answered", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const scan = page.api.ble.scan(1000).catch((e: unknown) => e);
    const info = page.api.info().catch((e: unknown) => e);
    vi.advanceTimersByTime(NATIVE_CALL_TIMEOUT_MS.info + 1);
    expect(await info).toMatchObject({ code: "timeout", name: "TimeoutError" });
    // A scan waits its own length on top.
    vi.advanceTimersByTime(NATIVE_CALL_TIMEOUT_MS["ble.scan"] + 1000 - NATIVE_CALL_TIMEOUT_MS.info);
    expect(await scan).toMatchObject({ code: "timeout" });
  });

  it("refuses at once when the WebView has no message channel", async () => {
    const page = fakePage({ withBridge: false });
    await expect(page.api.info()).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/not available/) });
  });

  it("refuses bytes it cannot send", async () => {
    const page = fakePage();
    await expect(page.api.ble.write("L", null as never)).rejects.toMatchObject({ code: "bad_request" });
    expect(page.posted).toEqual([]);
  });
});

describe("the bridge end to end, page to shell and back", () => {
  it("answers a call through the router and the outbox", async () => {
    const { page, pump } = connected({ info: () => ({ platform: "android", version: "0.1.0", os: "35", bridge: 1, ble: true, methods: ["info"] }) });
    const info = page.api.info();
    await pump();
    await expect(info).resolves.toMatchObject({ platform: "android", ble: true });
  });

  it("hands the handler validated, normalized params", async () => {
    const seen: unknown[] = [];
    const { page, pump } = connected({
      "calendar.addEvent": (p) => {
        seen.push(p);
        return { id: "e1", kind: "event" };
      },
    });
    const added = page.api.calendar.addEvent({ title: " Dinner ", start: "2026-11-06T17:00:00.000Z", end: "2026-11-06T18:00:00.000Z", alarmMinutes: 15 });
    await pump();
    await expect(added).resolves.toEqual({ id: "e1", kind: "event" });
    expect(seen).toEqual([
      { title: "Dinner", start: Date.parse("2026-11-06T17:00:00Z"), end: Date.parse("2026-11-06T18:00:00Z"), allDay: false, location: null, notes: null, alarmMinutes: 15 },
    ]);
  });

  it("rejects bad params before any handler runs", async () => {
    const handler = vi.fn();
    const { page, pump } = connected({ "calendar.addEvent": handler });
    const added = page.api.calendar.addEvent({ title: "", start: "soon", end: "later" }).catch((e: unknown) => e);
    await pump();
    expect(await added).toMatchObject({ code: "bad_request", name: "TypeError" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("carries a handler's coded failure to the page", async () => {
    const { page, pump } = connected();
    const scan = page.api.ble.scan().catch((e: unknown) => e);
    await pump();
    expect(await scan).toMatchObject({ code: "unsupported", message: "not in this test" });
  });

  it("pushes events the shell emits", async () => {
    const { page, host } = connected();
    const got: NativeBytesEvent[] = [];
    page.api.ble.onBytes((e) => got.push(e));
    host.emit("ble.bytes", { id: "L", bytes: "U0w=" });
    host.emit("ble.bytes", { id: "R", bytes: "AA==" });
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([
      { id: "L", bytes: "U0w=" },
      { id: "R", bytes: "AA==" },
    ]);
  });
});
