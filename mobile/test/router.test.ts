import { describe, expect, it, vi } from "vitest";
import { failureOf, route } from "../src/bridge/router";
import { NATIVE_CHANNEL, NativeBridgeError, nativeCall } from "../src/shared";
import { handlers } from "./harness";

const call = (id: number, method: string, params?: unknown) => JSON.stringify(nativeCall(id, method, params));

describe("route", () => {
  it("ignores whatever is not a call, and runs nothing for it", async () => {
    const info = vi.fn(() => ({}) as never);
    const h = handlers({ info });
    const junk = [
      undefined,
      null,
      7,
      "",
      "hello",
      "{",
      JSON.stringify({ kind: "call", id: 1, v: 1, method: "info" }),
      JSON.stringify({ channel: NATIVE_CHANNEL, kind: "event", id: 1, v: 1, method: "info" }),
      JSON.stringify({ channel: NATIVE_CHANNEL, kind: "call", id: "1", v: 1, method: "info" }),
      call(1, "info").replace('"v":1', '"v":"1"'),
      call(1, "info", { pad: "x".repeat(70000) }),
    ];
    for (const raw of junk) expect(await route(raw, h)).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it("answers an unknown method, another bridge version and bad params without running anything", async () => {
    const write = vi.fn(() => null);
    const h = handlers({ "ble.write": write });
    expect(await route(call(1, "ble.teleport"), h)).toMatchObject({ id: 1, ok: false, error: { code: "unknown_method" } });
    expect(await route(call(2, "toString"), h)).toMatchObject({ id: 2, ok: false, error: { code: "unknown_method" } });
    expect(await route(call(3, "__proto__"), h)).toMatchObject({ id: 3, ok: false, error: { code: "unknown_method" } });
    const v2 = JSON.stringify({ ...nativeCall(4, "ble.write", {}), v: 2 });
    expect(await route(v2, h)).toMatchObject({ id: 4, ok: false, error: { code: "unsupported" } });
    expect(await route(call(5, "ble.write", { id: "L", bytes: "not base64!" }), h)).toMatchObject({
      id: 5,
      ok: false,
      error: { code: "bad_request", message: expect.stringContaining("ble.write") },
    });
    expect(await route(call(6, "ble.write", "params as a string"), h)).toMatchObject({ id: 6, ok: false, error: { code: "bad_request" } });
    expect(write).not.toHaveBeenCalled();
  });

  it("runs the handler with normalized params and answers with what it returns", async () => {
    const scan = vi.fn(async (p: { timeoutMs: number }) => [{ id: "L", name: null, rssi: -50 + p.timeoutMs * 0 }]);
    const r = await route(call(9, "ble.scan", { timeoutMs: 99 }), handlers({ "ble.scan": scan }));
    expect(scan).toHaveBeenCalledWith({ timeoutMs: 500 });
    expect(r).toEqual({ channel: NATIVE_CHANNEL, v: 1, kind: "result", id: 9, ok: true, value: [{ id: "L", name: null, rssi: -50 }] });
    // Absent params are {}; a method returning nothing answers null.
    const impact = vi.fn(() => null);
    expect(await route(JSON.stringify({ channel: NATIVE_CHANNEL, v: 1, kind: "call", id: 10, method: "haptics.impact" }), handlers({ "haptics.impact": impact }))).toMatchObject({
      id: 10,
      ok: true,
      value: null,
    });
    expect(impact).toHaveBeenCalledWith({ style: "medium" });
  });

  it("answers with the code a handler failed with, or 'failed'", async () => {
    const h = handlers({
      "ble.connect": async () => {
        throw new NativeBridgeError("not_found", "No such earbud");
      },
      "ble.disconnect": () => {
        throw new Error("native crash");
      },
      "location.current": () => {
        throw "plain string";
      },
    });
    expect(await route(call(1, "ble.connect", { id: "X" }), h)).toMatchObject({ ok: false, error: { code: "not_found", message: "No such earbud" } });
    expect(await route(call(2, "ble.disconnect", { id: "X" }), h)).toMatchObject({ ok: false, error: { code: "failed", message: "native crash" } });
    expect(await route(call(3, "location.current"), h)).toMatchObject({ ok: false, error: { code: "failed", message: "plain string" } });
  });
});

describe("failureOf", () => {
  it("keeps known codes, and only those", () => {
    expect(failureOf({ code: "permission_denied", message: "no" })).toEqual({ code: "permission_denied", message: "no" });
    expect(failureOf({ code: "E_SOMETHING", message: "native" })).toEqual({ code: "failed", message: "native" });
    expect(failureOf(undefined)).toEqual({ code: "failed", message: "Something went wrong in the app" });
    expect(failureOf(new Error("x".repeat(2000))).message).toHaveLength(500);
  });
});
