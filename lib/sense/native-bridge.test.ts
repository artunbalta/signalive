import { describe, expect, it } from "vitest";
import type { ClenchEvent } from "./clench";
import {
  NativeBridgeTransport,
  hasNativeBridge,
  inNativeShell,
  nativeBridge,
  waitForNativeBridge,
  type NativeScope,
} from "./native-bridge";
import {
  MAX_WRITE_BYTES,
  NATIVE_CHANNEL,
  NATIVE_PROTOCOL_VERSION,
  NativeBridgeError,
  SCAN_MS,
  base64Length,
  decodeBase64,
  encodeBase64,
  nativeBatch,
  nativeCall,
  nativeEvent,
  nativeFailure,
  nativeResult,
  parseCall,
  parseNativeTime,
  parseOutgoing,
  validateParams,
  type NativeBleDevice,
  type NativeBytesEvent,
  type NativeStateEvent,
  type SignaliveNativeApi,
} from "./native-protocol";
import { decodeCommand, encodeFrame, type HostCommand, type Side, type SspFrame } from "./protocol";
import { PhoneSession } from "./session";
import { DigitalTwin, manualClock, type TwinRecording } from "./twin";

/* ---- A stand-in for the shell's Bluetooth ------------------------------------- */

/** window.SignaliveNative.ble as the shell provides it, over earbuds the test plays. */
class FakeBle {
  devices: NativeBleDevice[] = [];
  readonly connected = new Set<string>();
  readonly writes: { id: string; bytes: Uint8Array }[] = [];
  readonly connects: string[] = [];
  readonly disconnects: string[] = [];
  readonly scans: (number | undefined)[] = [];
  /** Ids whose connect fails (until removed). */
  readonly refuse = new Set<string>();
  scanError: Error | null = null;
  onWrite: ((id: string, bytes: Uint8Array) => void) | null = null;
  onConnect: ((id: string) => void) | null = null;
  private readonly bytesListeners = new Set<(e: NativeBytesEvent) => void>();
  private readonly stateListeners = new Set<(e: NativeStateEvent) => void>();

  async scan(timeoutMs?: number): Promise<NativeBleDevice[]> {
    this.scans.push(timeoutMs);
    if (this.scanError) throw this.scanError;
    return this.devices.map((d) => ({ ...d }));
  }

  async connect(id: string) {
    this.connects.push(id);
    if (this.refuse.has(id)) throw new NativeBridgeError("not_found", `no device ${id}`);
    this.connected.add(id);
    this.state({ id, state: "connected", reason: null });
    this.onConnect?.(id);
    return { id, name: this.devices.find((d) => d.id === id)?.name ?? null, mtu: 247 };
  }

  async disconnect(id: string) {
    this.disconnects.push(id);
    if (this.connected.delete(id)) this.state({ id, state: "disconnected", reason: null });
  }

  async write(id: string, bytes: Uint8Array | string) {
    if (!this.connected.has(id)) throw new NativeBridgeError("not_connected", `${id} is not connected`);
    const b = typeof bytes === "string" ? decodeBase64(bytes) : bytes;
    if (!b) throw new NativeBridgeError("bad_request", "bytes must be base64");
    this.writes.push({ id, bytes: b });
    this.onWrite?.(id, b);
  }

  onBytes(listener: (e: NativeBytesEvent) => void) {
    this.bytesListeners.add(listener);
    return () => {
      this.bytesListeners.delete(listener);
    };
  }

  onState(listener: (e: NativeStateEvent) => void) {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  get listening() {
    return this.bytesListeners.size + this.stateListeners.size;
  }

  /** A notification from an earbud, as the shell forwards it: base64. */
  notify(id: string, bytes: Uint8Array) {
    if (!this.connected.has(id)) return;
    for (const l of this.bytesListeners) l({ id, bytes: encodeBase64(bytes) });
  }

  /** Raw event data, malformed or not. */
  push(event: unknown) {
    for (const l of this.bytesListeners) l(event as NativeBytesEvent);
  }

  /** The earbud goes out of range. */
  drop(id: string) {
    if (this.connected.delete(id)) this.state({ id, state: "disconnected", reason: "out of range" });
  }

  /** Commands written to one earbud, decoded. */
  commands(id: string): HostCommand[] {
    return this.writes.filter((w) => w.id === id).map((w) => decodeCommand(w.bytes)!.command);
  }

  private state(e: NativeStateEvent) {
    for (const l of this.stateListeners) l(e);
  }
}

function api(ble: FakeBle): SignaliveNativeApi {
  const none = () => Promise.reject(new NativeBridgeError("unsupported", "not in this test"));
  return {
    version: NATIVE_PROTOCOL_VERSION,
    platform: "ios",
    info: none,
    ble,
    calendar: { addEvent: none, addReminder: none },
    haptics: { impact: none },
    location: { current: none },
  };
}

const frame = (f: Partial<SspFrame> & Pick<SspFrame, "type" | "side">): Uint8Array =>
  encodeFrame({ seq: 0, timestamp: 0, flags: 0, ...f } as SspFrame);

const hello = (side: Side) =>
  frame({ type: "hello", side, firmware: [0, 1, 0], deviceId: "0011223344556677", labels: ["E1", "E2", "E3", "E4"], eegRate: 250, nvPerLsb: 22.35, imuRate: 100, battery: 80 });

const eeg = (side: Side, seq = 1) => frame({ type: "eeg", side, seq, channels: 1, samples: 2, counts: Int32Array.from([1, 2]) });

const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---- The bridge's own rules ---------------------------------------------------- */

describe("native protocol", () => {
  it("round trips base64 like the platform does, and refuses what is not base64", () => {
    let seed = 7;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) & 0xff;
    for (let n = 0; n < 300; n++) {
      const bytes = Uint8Array.from({ length: n }, rand);
      const b64 = encodeBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString("base64"));
      expect(base64Length(b64)).toBe(n);
      expect(Array.from(decodeBase64(b64)!)).toEqual(Array.from(bytes));
      // Unpadded is read too.
      expect(Array.from(decodeBase64(b64.replace(/=+$/, ""))!)).toEqual(Array.from(bytes));
    }
    for (const bad of ["A", "A===", "AB=C", "ab cd", "ab-_", "QQ==QQ==", "é"]) expect(decodeBase64(bad)).toBeNull();
  });

  it("parses calls and ignores everything else", () => {
    const call = JSON.stringify(nativeCall(3, "ble.scan", { timeoutMs: 1000 }));
    expect(parseCall(call)).toMatchObject({ id: 3, method: "ble.scan", params: { timeoutMs: 1000 } });
    const ignored = [
      undefined,
      42,
      "not json",
      "null",
      "[]",
      JSON.stringify({ channel: "someone-else", kind: "call", id: 1, v: 1, method: "info" }),
      JSON.stringify({ channel: NATIVE_CHANNEL, kind: "result", id: 1, v: 1, method: "info" }),
      JSON.stringify({ channel: NATIVE_CHANNEL, kind: "call", id: -1, v: 1, method: "info" }),
      JSON.stringify({ channel: NATIVE_CHANNEL, kind: "call", id: 1.5, v: 1, method: "info" }),
      JSON.stringify({ channel: NATIVE_CHANNEL, kind: "call", id: 1, method: "info" }),
      JSON.stringify({ channel: NATIVE_CHANNEL, kind: "call", id: 1, v: 1, method: "" }),
      JSON.stringify({ channel: NATIVE_CHANNEL, kind: "call", id: 1, v: 1, method: 7 }),
      JSON.stringify(nativeCall(1, "info", { pad: "x".repeat(70000) })),
    ];
    for (const raw of ignored) expect(parseCall(raw)).toBeNull();
  });

  it("validates and normalizes every method's params", () => {
    expect(validateParams("info", undefined)).toEqual({ ok: true, value: {} });
    expect(validateParams("ble.scan", {})).toEqual({ ok: true, value: { timeoutMs: SCAN_MS.default } });
    expect(validateParams("ble.scan", { timeoutMs: 10 })).toEqual({ ok: true, value: { timeoutMs: SCAN_MS.min } });
    expect(validateParams("ble.scan", { timeoutMs: 1e9 })).toEqual({ ok: true, value: { timeoutMs: SCAN_MS.max } });
    expect(validateParams("ble.scan", { timeoutMs: "soon" }).ok).toBe(false);
    expect(validateParams("ble.connect", { id: "AA:BB:CC:DD:EE:FF" }).ok).toBe(true);
    expect(validateParams("ble.connect", { id: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E" }).ok).toBe(true);
    for (const id of [undefined, "", "a b", "<script>", "x".repeat(129), 5]) expect(validateParams("ble.connect", { id }).ok).toBe(false);
    expect(validateParams("ble.write", { id: "d1", bytes: encodeBase64(new Uint8Array(21)) }).ok).toBe(true);
    expect(validateParams("ble.write", { id: "d1", bytes: "" }).ok).toBe(false);
    expect(validateParams("ble.write", { id: "d1", bytes: "%%%" }).ok).toBe(false);
    expect(validateParams("ble.write", { id: "d1", bytes: encodeBase64(new Uint8Array(MAX_WRITE_BYTES + 1)) }).ok).toBe(false);
    expect(validateParams("ble.write", { id: "d1", bytes: [1, 2] }).ok).toBe(false);

    const event = validateParams("calendar.addEvent", { title: "  Standup ", start: "2026-11-03T09:00:00Z", end: Date.parse("2026-11-03T09:15:00Z") });
    expect(event).toEqual({
      ok: true,
      value: {
        title: "Standup",
        start: Date.parse("2026-11-03T09:00:00Z"),
        end: Date.parse("2026-11-03T09:15:00Z"),
        allDay: false,
        location: null,
        notes: null,
        alarmMinutes: null,
      },
    });
    // Exactly what the trial's moments hand over (trial/lib/client/moments-ics.ts).
    const fromMoments = validateParams("calendar.addEvent", {
      title: "Dinner",
      start: new Date("2026-11-06T17:00:00Z").toISOString(),
      end: new Date("2026-11-06T18:00:00Z").toISOString(),
      allDay: false,
      location: null,
      notes: "From a moment",
      alarmMinutes: 15,
    });
    expect(fromMoments).toMatchObject({ ok: true, value: { allDay: false, alarmMinutes: 15, notes: "From a moment", location: null } });
    expect(validateParams("calendar.addEvent", { title: "x", start: 0, end: 0, allDay: true })).toMatchObject({ value: { allDay: true } });
    expect(validateParams("calendar.addEvent", { title: "x", start: 0, end: 0, allDay: "yes" }).ok).toBe(false);
    expect(validateParams("calendar.addEvent", { title: "x", start: 0, end: 0, alarmMinutes: -5 }).ok).toBe(false);
    expect(validateParams("calendar.addEvent", { title: "x", start: 0, end: 0, alarmMinutes: 1e6 }).ok).toBe(false);
    expect(validateParams("calendar.addReminder", { title: "Call back", due: null, notes: null })).toEqual({
      ok: true,
      value: { title: "Call back", due: null, notes: null },
    });
    expect(validateParams("calendar.addEvent", { title: "x", start: "2026-11-03T10:00:00Z", end: "2026-11-03T09:00:00Z" }).ok).toBe(false);
    expect(validateParams("calendar.addEvent", { title: "", start: 0, end: 0 }).ok).toBe(false);
    expect(validateParams("calendar.addEvent", { title: "x", start: "tomorrow", end: 0 }).ok).toBe(false);
    expect(validateParams("calendar.addEvent", { title: "x", start: 0, end: 0, notes: 3 }).ok).toBe(false);
    expect(validateParams("calendar.addEvent", "x").ok).toBe(false);
    expect(validateParams("calendar.addReminder", { title: "Call back" })).toEqual({ ok: true, value: { title: "Call back", due: null, notes: null } });
    expect(validateParams("calendar.addReminder", { title: "Call back", due: "2026-11-03" }).ok).toBe(true);
    expect(validateParams("haptics.impact", {})).toEqual({ ok: true, value: { style: "medium" } });
    expect(validateParams("haptics.impact", { style: "rigid" })).toEqual({ ok: true, value: { style: "rigid" } });
    expect(validateParams("haptics.impact", { style: "loud" }).ok).toBe(false);
    expect(validateParams("location.current", null)).toEqual({ ok: true, value: { accuracy: "balanced" } });
    expect(validateParams("location.current", { accuracy: "exact" }).ok).toBe(false);
  });

  it("reads times as epoch ms or ISO dates only", () => {
    expect(parseNativeTime(0)).toBe(0);
    expect(parseNativeTime("2026-11-03T09:00:00.000+03:00")).toBe(Date.parse("2026-11-03T06:00:00Z"));
    for (const bad of [NaN, Infinity, "", "2026-13-45", "next tuesday", "1730000000000", null, {}]) expect(parseNativeTime(bad)).toBeNull();
  });

  it("reads what the shell sends and nothing else", () => {
    const ok = nativeResult(1, { id: "e1", kind: "event" });
    const failed = nativeFailure(2, "permission_denied", "no");
    const bytes = nativeEvent("ble.bytes", { id: "d1", bytes: "U0w=" });
    const state = nativeEvent("ble.state", { id: "d1", state: "disconnected", reason: null });
    for (const m of [ok, failed, bytes, state, nativeBatch([ok, bytes, state])]) expect(parseOutgoing(JSON.parse(JSON.stringify(m)))).toEqual(m);
    const bad = [
      null,
      { ...ok, channel: "x" },
      { ...failed, error: { code: "teapot", message: "" } },
      { ...bytes, data: { id: "d1" } },
      { ...state, data: { id: "d1", state: "melted" } },
      { ...bytes, event: "ble.other" },
      nativeBatch([ok, { nope: 1 } as never]),
    ];
    for (const m of bad) expect(parseOutgoing(m)).toBeNull();
  });
});

/* ---- Finding the bridge ------------------------------------------------------- */

describe("finding the bridge", () => {
  it("sees a well formed bridge and nothing else", () => {
    const ble = new FakeBle();
    expect(hasNativeBridge({})).toBe(false);
    expect(hasNativeBridge({ SignaliveNative: { ble: {} } })).toBe(false);
    expect(hasNativeBridge({ SignaliveNative: api(ble) })).toBe(true);
    expect(nativeBridge({ SignaliveNative: api(ble) })?.ble).toBe(ble);
    expect(inNativeShell({ navigator: { userAgent: "Mozilla/5.0 (iPhone) Mobile/15E148 SignaliveApp/0.1.0" } })).toBe(true);
    expect(inNativeShell({ navigator: { userAgent: "Mozilla/5.0 (iPhone) Mobile/15E148 Safari/604.1" } })).toBe(false);
  });

  it("waits for a bridge that arrives late, and gives up on one that never does", async () => {
    const listeners = new Set<() => void>();
    const scope: NativeScope = {
      addEventListener: (_t, l) => listeners.add(l),
      removeEventListener: (_t, l) => listeners.delete(l),
    };
    const waiting = waitForNativeBridge(1000, scope);
    setTimeout(() => {
      scope.SignaliveNative = api(new FakeBle());
      for (const l of listeners) l();
    }, 20);
    expect(await waiting).toBe(scope.SignaliveNative);
    expect(listeners.size).toBe(0);
    expect(await waitForNativeBridge(60, {})).toBeNull();
  });
});

/* ---- The transport -------------------------------------------------------------- */

function setup(devices: NativeBleDevice[] = [
  { id: "far", name: "Signalive", rssi: -80 },
  { id: "L", name: "Signalive L", rssi: -50 },
  { id: "R", name: "Signalive R", rssi: -55 },
]) {
  const ble = new FakeBle();
  ble.devices = devices;
  const received: { side: Side; type: number }[] = [];
  const named: Side[] = [];
  const lost: (Side | null)[] = [];
  const transport = new NativeBridgeTransport({
    bridge: api(ble),
    onSide: (s) => named.push(s),
    onLost: (s) => lost.push(s),
    sleep: () => flush().then(() => undefined),
  });
  const onBytes = (bytes: Uint8Array, side: Side) => received.push({ side, type: bytes[3] });
  return { ble, transport, received, named, lost, onBytes };
}

describe("NativeBridgeTransport", () => {
  it("connects the two strongest earbuds, asks each who it is and starts it", async () => {
    const { ble, transport, onBytes } = setup();
    await transport.connect(onBytes);
    expect(ble.scans).toEqual([SCAN_MS.default]);
    expect(ble.connects).toEqual(["L", "R"]);
    for (const id of ["L", "R"]) {
      expect(ble.commands(id)).toEqual([{ op: "hello" }, { op: "start" }]);
      // Until its HELLO it is addressed as either side.
      expect(ble.writes.filter((w) => w.id === id).map((w) => decodeCommand(w.bytes)!.side)).toEqual(["single", "single"]);
    }
    expect(transport.devices.map((d) => d.id)).toEqual(["L", "R"]);
  });

  it("learns each earbud's side from its HELLO and delivers bytes with it", async () => {
    const { ble, transport, received, named, onBytes } = setup();
    await transport.connect(onBytes);
    // Before its HELLO an earbud's bytes go out with the side in their header.
    ble.notify("L", eeg("left"));
    ble.notify("L", hello("left"));
    ble.notify("R", hello("right"));
    ble.notify("R", eeg("right"));
    ble.notify("far", hello("left"));
    expect(received).toEqual([
      { side: "left", type: 2 },
      { side: "left", type: 1 },
      { side: "right", type: 1 },
      { side: "right", type: 2 },
    ]);
    expect(named).toEqual(["left", "right"]);
    expect(transport.sides).toEqual(["left", "right"]);
    // The HELLO wins over a header that disagrees.
    ble.notify("R", eeg("left"));
    expect(received.at(-1)).toEqual({ side: "right", type: 2 });
  });

  it("ignores malformed bytes events", async () => {
    const { ble, transport, received, onBytes } = setup();
    await transport.connect(onBytes);
    for (const e of [null, {}, { id: 5, bytes: "U0w=" }, { id: "L" }, { id: "L", bytes: "%%%" }, { id: "L", bytes: "" }, { id: "nobody", bytes: "U0w=" }]) ble.push(e);
    expect(received).toEqual([]);
  });

  it("sends a command to the earbud of a side, or to both", async () => {
    const { ble, transport, onBytes } = setup();
    await transport.connect(onBytes);
    ble.notify("L", hello("left"));
    ble.notify("R", hello("right"));
    ble.writes.length = 0;
    const steer = new Uint8Array([1, 2, 3]);
    await transport.send("left", steer);
    expect(ble.writes.map((w) => w.id)).toEqual(["L"]);
    await transport.send("single", steer);
    expect(ble.writes.map((w) => w.id)).toEqual(["L", "L", "R"]);
    await transport.send("right", steer);
    expect(ble.writes.map((w) => w.id)).toEqual(["L", "L", "R", "R"]);
  });

  it("refuses to send to a side nobody has named", async () => {
    const { transport, onBytes } = setup([{ id: "L", name: null, rssi: -40 }]);
    await transport.connect(onBytes);
    await expect(transport.send("right", new Uint8Array([1]))).rejects.toThrow("no right earbud connected");
  });

  it("stops and lets go of every earbud on disconnect, and takes no bytes after", async () => {
    const { ble, transport, received, onBytes } = setup();
    await transport.connect(onBytes);
    ble.notify("L", hello("left"));
    await transport.disconnect();
    expect(ble.commands("L").at(-1)).toEqual({ op: "stop" });
    expect(ble.commands("R").at(-1)).toEqual({ op: "stop" });
    expect(ble.disconnects.sort()).toEqual(["L", "R"]);
    expect(ble.listening).toBe(0);
    const before = received.length;
    ble.notify("L", eeg("left"));
    expect(received.length).toBe(before);
    expect(transport.devices).toEqual([]);
  });

  it("connects the ids it is given without scanning", async () => {
    const ble = new FakeBle();
    const transport = new NativeBridgeTransport({ bridge: api(ble), ids: ["R", "L", "X"], maxEarbuds: 2 });
    await transport.connect(() => {});
    expect(ble.scans).toEqual([]);
    expect(ble.connects).toEqual(["R", "L"]);
  });

  it("lets the page choose among the finds", async () => {
    const { ble } = setup();
    ble.devices = [
      { id: "A", name: "Signalive", rssi: -40 },
      { id: "B", name: "Someone else's", rssi: -30 },
    ];
    const transport = new NativeBridgeTransport({ bridge: api(ble), choose: (found) => found.filter((d) => d.name === "Signalive") });
    await transport.connect(() => {});
    expect(ble.connects).toEqual(["A"]);
  });

  it("says NotFoundError when no earbud is near", async () => {
    const { transport, ble, onBytes } = setup([]);
    const err = await transport.connect(onBytes).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NativeBridgeError);
    expect(err).toMatchObject({ name: "NotFoundError", code: "not_found" });
    expect(ble.listening).toBe(0);
  });

  it("passes the bridge's own error on when scanning fails", async () => {
    const { transport, ble, onBytes } = setup();
    ble.scanError = new NativeBridgeError("bluetooth_off", "Bluetooth is off");
    await expect(transport.connect(onBytes)).rejects.toMatchObject({ name: "InvalidStateError", code: "bluetooth_off", message: "Bluetooth is off" });
    expect(ble.listening).toBe(0);
  });

  it("keeps the earbud that connected when the other one does not", async () => {
    const { transport, ble, onBytes } = setup();
    ble.refuse.add("R");
    await transport.connect(onBytes);
    expect(transport.devices.map((d) => d.id)).toEqual(["L"]);
    expect(ble.disconnects).toEqual(["R"]);
  });

  it("rejects with the first error when no earbud connects", async () => {
    const { transport, ble, onBytes } = setup();
    ble.refuse.add("L");
    ble.refuse.add("R");
    await expect(transport.connect(onBytes)).rejects.toMatchObject({ code: "not_found", message: "no device L" });
    expect(transport.devices).toEqual([]);
  });

  it("finds one more earbud with addDevice, never one it has", async () => {
    const { transport, ble, onBytes } = setup([{ id: "L", name: null, rssi: -40 }]);
    await transport.connect(onBytes);
    ble.devices.push({ id: "R", name: null, rssi: -90 });
    await transport.addDevice();
    expect(ble.connects).toEqual(["L", "R"]);
    await expect(transport.addDevice()).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("reconnects an earbud that drops, and asks it who it is again", async () => {
    const { transport, ble, lost, onBytes } = setup();
    await transport.connect(onBytes);
    ble.notify("L", hello("left"));
    ble.writes.length = 0;
    ble.refuse.add("L");
    ble.drop("L");
    await flush();
    await flush();
    ble.refuse.delete("L");
    for (let i = 0; i < 10; i++) await flush();
    expect(ble.connected.has("L")).toBe(true);
    // Addressed by the side it named before the drop.
    expect(ble.writes.filter((w) => w.id === "L").map((w) => decodeCommand(w.bytes)!.side)).toEqual(["left", "left"]);
    expect(ble.commands("L")).toEqual([{ op: "hello" }, { op: "start" }]);
    expect(lost).toEqual([]);
  });

  it("gives an earbud up after the last try, and says which side went", async () => {
    const { transport, ble, lost, onBytes } = setup();
    await transport.connect(onBytes);
    ble.notify("R", hello("right"));
    ble.refuse.add("R");
    ble.drop("R");
    for (let i = 0; i < 30; i++) await flush();
    expect(ble.connects.filter((id) => id === "R")).toHaveLength(1 + 5);
    expect(lost).toEqual(["right"]);
    expect(transport.devices.map((d) => d.id)).toEqual(["L"]);
  });

  it("does not take its own disconnect for a loss", async () => {
    const { transport, ble, lost, onBytes } = setup();
    await transport.connect(onBytes);
    await transport.disconnect();
    for (let i = 0; i < 10; i++) await flush();
    expect(lost).toEqual([]);
    expect(ble.connects).toEqual(["L", "R"]);
  });

  it("says the bridge is not available when there is none", async () => {
    const transport = new NativeBridgeTransport({ waitMs: 10 });
    await expect(transport.connect(() => {})).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/not available/) });
  });
});

/* ---- End to end: twin earbuds behind the bridge, into the phone session ------- */

const FS = 500;

function recording(seconds = 20): TwinRecording {
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const n = seconds * FS;
  return {
    fs: FS,
    labels: ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4"],
    data: Array.from({ length: 8 }, (_, c) => Float32Array.from({ length: n }, (_, i) => 5 * gauss() + 10 * Math.sin((2 * Math.PI * 10 * i) / FS + c))),
  };
}

describe("the bridge end to end", () => {
  it("carries the twin's two earbuds through base64 into the session, which finds a clench", async () => {
    const twin = new DigitalTwin({ recording: recording(), sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] }, clock: manualClock, seed: 3 });
    // Each earbud is its own device; the phone only learns which is which from the HELLOs.
    const ids: Record<string, Side> = { "bud-a": "right", "bud-b": "left" };
    const ble = new FakeBle();
    ble.devices = [
      { id: "bud-a", name: "Signalive", rssi: -60 },
      { id: "bud-b", name: "Signalive", rssi: -61 },
    ];
    ble.onConnect = () => {
      if (ble.connected.size === 1) {
        twin.start((bytes, side) => {
          const id = Object.keys(ids).find((k) => ids[k] === side)!;
          ble.notify(id, bytes);
        });
      }
    };
    ble.onWrite = (id, bytes) => twin.command(ids[id], bytes);

    const session = new PhoneSession({ fs: FS, perEar: 4, now: () => twin.time });
    const clenches: ClenchEvent[] = [];
    session.onClench((e) => clenches.push(e));
    const transport = new NativeBridgeTransport({ bridge: api(ble) });
    await transport.connect((bytes, side) => session.bytes(bytes, side));
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 20) twin.tick(20);
    };

    run(3000);
    expect(transport.sides.sort()).toEqual(["left", "right"]);
    expect(Object.keys(session.earbuds).sort()).toEqual(["left", "right"]);
    const { ears } = session.snapshot();
    expect(ears.left.frames).toBeGreaterThan(50);
    expect(ears.right.frames).toBeGreaterThan(50);
    expect(ears.left.lost + ears.right.lost).toBe(0);

    twin.clench("single");
    run(1500);
    expect(clenches.map((e) => e.kind)).toEqual(["single"]);

    // A STEER from the session reaches both earbuds through the bridge.
    const steer = session.steer([0.2, 0.8]);
    const sent = decodeCommand(steer)!.command;
    expect(sent).toMatchObject({ op: "steer", gainDb: 5.4 });
    await transport.send("single", steer);
    const { op: _op, ...obeyed } = sent as Extract<HostCommand, { op: "steer" }>;
    expect(twin.steering("left")).toEqual(obeyed);
    expect(twin.steering("right")).toEqual(obeyed);

    await transport.disconnect();
    twin.stop();
  });
});
