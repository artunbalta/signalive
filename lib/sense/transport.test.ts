import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EegStream,
  Flag,
  SSP_COMMANDS_UUID,
  SSP_FRAMES_UUID,
  SSP_SERVICE_UUID,
  SspDecoder,
  decodeCommand,
  encodeCommand,
  type EegFrame,
  type HelloFrame,
  type Side,
  type SspFrame,
} from "./protocol";
import {
  CYTON_UV_PER_COUNT,
  CytonBridge,
  CytonParser,
  CytonSerialTransport,
  TwinTransport,
  WebBluetoothTransport,
  parseCytonPacket,
  type BleCharacteristic,
  type BleDevice,
  type BleServer,
  type BluetoothLike,
  type SerialPortLike,
} from "./transport";
import { DigitalTwin, manualClock, type TwinRecording } from "./twin";

/** A Cyton packet as the board sends it: big endian int24 channels. */
function cytonPacket(sample: number, counts: number[], footer = 0xc0) {
  const p = new Uint8Array(33);
  p[0] = 0xa0;
  p[1] = sample & 0xff;
  counts.forEach((c, i) => {
    const u = c & 0xffffff;
    p[2 + 3 * i] = u >> 16;
    p[3 + 3 * i] = (u >> 8) & 0xff;
    p[4 + 3 * i] = u & 0xff;
  });
  p.set([1, 2, 3, 4, 5, 6], 26);
  p[32] = footer;
  return p;
}

const countsAt = (s: number) => Array.from({ length: 8 }, (_, c) => (s * 1000 + c) * (c % 2 ? -1 : 1));

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function recording(): TwinRecording {
  const fs = 250;
  return {
    fs,
    labels: ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4"],
    data: Array.from({ length: 8 }, (_, c) => Float32Array.from({ length: 2 * fs }, (_, i) => 10 * Math.sin(i / (4 + c)))),
  };
}

describe("Cyton packets", () => {
  it("parses a packet: counter, eight big endian int24 channels, aux, footer", () => {
    const counts = [0, 1, -1, 8388607, -8388608, 0x123456, -0x123456, 42];
    const p = parseCytonPacket(cytonPacket(201, counts, 0xc3))!;
    expect(p.sample).toBe(201);
    expect(Array.from(p.counts)).toEqual(counts);
    expect(p.microvolts[3]).toBeCloseTo(8388607 * CYTON_UV_PER_COUNT, 3);
    expect(p.microvolts[3]).toBeCloseTo(187500, 0);
    expect(Array.from(p.aux)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(p.footer).toBe(0xc3);
    expect(parseCytonPacket(cytonPacket(1, counts, 0xc7))).toBeNull();
    const bad = cytonPacket(1, counts);
    bad[0] = 0xa1;
    expect(parseCytonPacket(bad)).toBeNull();
  });

  it("resyncs after garbage, including a chance header and footer", () => {
    const banner = new TextEncoder().encode("OpenBCI V3 8-16 channel\nOn Board ADS1299 Device ID: 0x3E\n$$$");
    const trap = new Uint8Array(40);
    trap[3] = 0xa0;
    trap[3 + 32] = 0xc0; // a header and footer 33 bytes apart, not followed by a packet
    const packets = Array.from({ length: 12 }, (_, s) => cytonPacket(s, countsAt(s)));
    const stream = concat([banner, trap, ...packets.slice(0, 6), Uint8Array.from([0xa0, 0x55]), ...packets.slice(6)]);
    for (const size of [1, 5, 33, 64, 1000]) {
      const parser = new CytonParser();
      const out: number[] = [];
      for (let i = 0; i < stream.length; i += size) out.push(...parser.push(stream.subarray(i, i + size)).map((p) => p.sample));
      expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(parser.stats.skipped).toBe(banner.length + trap.length + 2);
    }
  });
});

describe("CytonBridge", () => {
  it("re-encodes the board's stream as SSP, a HELLO first, and keeps a radio gap in place", () => {
    const frames: SspFrame[] = [];
    const decoder = new SspDecoder();
    const bridge = new CytonBridge((bytes, side) => {
      expect(side).toBe("single");
      frames.push(...decoder.push(bytes));
    });
    bridge.start();
    const sent = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
    bridge.push(concat(sent.map((s) => cytonPacket(s, countsAt(s)))));

    const hello = frames[0] as HelloFrame;
    expect(hello).toMatchObject({ type: "hello", side: "single", eegRate: 250, imuRate: 0, labels: ["1", "2", "3", "4", "5", "6", "7", "8"] });
    expect(hello.flags & Flag.streamStart).toBeTruthy();
    expect(hello.nvPerLsb).toBe(Math.fround(CYTON_UV_PER_COUNT * 1000));

    const eeg = frames.filter((f): f is EegFrame => f.type === "eeg");
    expect(eeg.map((f) => [f.samples, f.timestamp])).toEqual([
      [9, 0],
      [9, 36_000],
      [2, 72_000],
      [9, 100_000],
    ]);
    expect(eeg[3].flags & Flag.deviceDrop).toBeTruthy();
    expect(decoder.stats).toMatchObject({ gaps: 1, crcErrors: 0 });

    // The phone's stream puts five NaN where the five packets were lost, and every count where it was.
    const stream = new EegStream(250, 8, hello.nvPerLsb);
    const chunks = eeg.map((f) => stream.push(f)!);
    expect(chunks[3]).toMatchObject({ index: 20, missing: 5 });
    const k = hello.nvPerLsb / 1000;
    expect(chunks[3].data[1][5]).toBeCloseTo(countsAt(25)[1] * k, 3);
    expect(chunks[0].data[0][8]).toBeCloseTo(countsAt(8)[0] * k, 3);
  });

  /** A bridge on a clock the test moves, decoding what it sends. */
  function bridged() {
    const clock = { t: 0 };
    const frames: SspFrame[] = [];
    const decoder = new SspDecoder();
    const bridge = new CytonBridge((bytes) => frames.push(...decoder.push(bytes)), undefined, () => clock.t);
    const eeg = () => frames.filter((f): f is EegFrame => f.type === "eeg");
    /** Packets for these counter values, arriving at 4 ms a sample from now. */
    const feed = (samples: number[]) => {
      for (const s of samples) {
        bridge.push(cytonPacket(s & 0xff, countsAt(s)));
        clock.t += 4;
      }
    };
    return { clock, frames, decoder, bridge, eeg, feed };
  }

  it("drops a packet delivered twice instead of reading it as a wrap of the counter", () => {
    const { bridge, eeg, feed, decoder } = bridged();
    bridge.start();
    feed([0, 1, 2, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(eeg().map((f) => [f.samples, f.timestamp])).toEqual([
      [9, 0],
      [9, 36_000],
    ]);
    expect(decoder.stats.gaps).toBe(0);
  });

  it("sizes a radio outage longer than the counter's range by the host clock", () => {
    const { bridge, eeg, feed, clock } = bridged();
    bridge.start();
    feed([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // 300 samples (1.2 s) never arrive; the counter alone would say 44.
    clock.t += 300 * 4;
    feed([309, 310, 311, 312, 313, 314, 315, 316, 317]);
    expect(eeg().map((f) => f.timestamp)).toEqual([0, 309 * 4000]);
    expect(eeg()[1].flags & Flag.deviceDrop).toBeTruthy();
  });

  it("restarts cleanly after stop, its device clock still running through the pause", () => {
    const { bridge, eeg, feed, clock, frames, decoder } = bridged();
    bridge.start();
    feed([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    bridge.stop();
    expect(eeg().map((f) => f.samples)).toEqual([9, 1]);
    bridge.push(cytonPacket(10, countsAt(10))); // in flight after "s": ignored
    clock.t += 60_000;
    bridge.start();
    // The board restarts its counter at 0 on "b".
    feed([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const hello = frames.filter((f): f is HelloFrame => f.type === "hello");
    expect(hello.map((h) => [h.seq, h.flags & Flag.streamStart])).toEqual([
      [0, Flag.streamStart],
      [0, Flag.streamStart],
    ]);
    expect(hello[1].timestamp).toBe(Math.round((40 + 60_000) / 4) * 4000);
    expect(eeg()[2].timestamp).toBe(hello[1].timestamp);
    expect(eeg()[2].flags & Flag.deviceDrop).toBe(0);
    expect(decoder.stats.gaps).toBe(0);
  });
});

/**
 * A serial port whose incoming bytes the test feeds and whose writes it
 * records. Like Web Serial, a recoverable error replaces its readable.
 */
function fakePort() {
  let feed!: ReadableStreamDefaultController<Uint8Array>;
  const fresh = () => new ReadableStream<Uint8Array>({ start: (c) => void (feed = c) });
  let readable = fresh();
  const written: string[] = [];
  const state = { open: false, closed: false };
  const port: SerialPortLike = {
    get readable() {
      return readable;
    },
    writable: new WritableStream<Uint8Array>({ write: (chunk) => void written.push(new TextDecoder().decode(chunk)) }),
    open: async (o) => {
      expect(o.baudRate).toBe(115200);
      state.open = true;
    },
    close: async () => {
      state.closed = true;
    },
  };
  const overrun = () => {
    feed.error(new Error("BufferOverrunError"));
    readable = fresh();
  };
  return { port, feed: (b: Uint8Array) => feed.enqueue(b), overrun, written, state };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("CytonSerialTransport", () => {
  it("starts the board with b, streams SSP, maps commands, and stops it with s", async () => {
    const { port, feed, written, state } = fakePort();
    const frames: SspFrame[] = [];
    const decoder = new SspDecoder();
    const t = new CytonSerialTransport({ port, labels: ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2"] });
    await t.connect((bytes) => frames.push(...decoder.push(bytes)));
    expect(state.open).toBe(true);
    expect(written).toEqual(["b"]);
    expect(frames[0]).toMatchObject({ type: "hello", labels: ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2"] });

    feed(concat(Array.from({ length: 19 }, (_, s) => cytonPacket(s, countsAt(s)))));
    await settle();
    expect(frames.filter((f) => f.type === "eeg").length).toBe(2);

    await t.send("single", encodeCommand({ op: "stop" }));
    await t.send("single", encodeCommand({ op: "start" }));
    await t.send("single", encodeCommand({ op: "hello" }));
    expect(written).toEqual(["b", "s", "b"]);
    expect(frames[frames.length - 1]).toMatchObject({ type: "hello", flags: 0 });

    await t.disconnect();
    expect(written[written.length - 1]).toBe("s");
    expect(state.closed).toBe(true);
  });

  it("ignores START while streaming and answers SET_EEG_RATE with a HELLO", async () => {
    const { port, written } = fakePort();
    const frames: SspFrame[] = [];
    const decoder = new SspDecoder();
    const t = new CytonSerialTransport({ port });
    await t.connect((bytes) => frames.push(...decoder.push(bytes)));
    await t.send("single", encodeCommand({ op: "start" }));
    expect(written).toEqual(["b"]);
    await t.send("single", encodeCommand({ op: "setEegRate", rate: 500 }));
    expect(frames[frames.length - 1]).toMatchObject({ type: "hello", eegRate: 250, flags: 0 });
    await t.disconnect();
  });

  it("keeps reading after a recoverable serial error and after the consumer throws", async () => {
    const { port, feed, overrun } = fakePort();
    const errors: unknown[] = [];
    let eeg = 0;
    let thrown = false;
    const decoder = new SspDecoder();
    const t = new CytonSerialTransport({ port, onError: (e) => errors.push(e) });
    await t.connect((bytes) => {
      for (const f of decoder.push(bytes)) if (f.type === "eeg") eeg++;
      if (eeg === 1 && !thrown) {
        thrown = true;
        throw new Error("consumer bug");
      }
    });
    feed(concat(Array.from({ length: 19 }, (_, s) => cytonPacket(s, countsAt(s)))));
    await settle();
    overrun();
    await settle();
    feed(concat(Array.from({ length: 19 }, (_, s) => cytonPacket(19 + s, countsAt(19 + s)))));
    await settle();
    expect(eeg).toBe(4);
    expect(errors.map((e) => (e as Error).message)).toEqual(["consumer bug", "BufferOverrunError"]);
    await t.disconnect();
  });
});

/* A Web Bluetooth stack in miniature: two earbud peripherals wired to one twin. */

class FakeCharacteristic extends EventTarget implements BleCharacteristic {
  value: DataView | null = null;
  notifying = false;
  constructor(private readonly onWrite: (b: Uint8Array) => void = () => {}) {
    super();
  }
  async startNotifications() {
    this.notifying = true;
    return this;
  }
  async stopNotifications() {
    this.notifying = false;
    return this;
  }
  async writeValueWithResponse(v: Uint8Array) {
    this.onWrite(v.slice());
  }
  async writeValue(v: Uint8Array) {
    this.onWrite(v.slice());
  }
  notify(bytes: Uint8Array) {
    if (!this.notifying) return;
    // Browsers hand over a view that may sit inside a larger buffer.
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 4);
    this.value = new DataView(padded.buffer, 4, bytes.length);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

class FakeEarbud extends EventTarget implements BleDevice {
  readonly frames: FakeCharacteristic;
  readonly commands: FakeCharacteristic;
  readonly gatt: BleServer;
  connects = 0;
  constructor(
    readonly id: string,
    onCommand: (b: Uint8Array) => void,
  ) {
    super();
    this.frames = new FakeCharacteristic();
    this.commands = new FakeCharacteristic(onCommand);
    const chars: Record<string, FakeCharacteristic> = { [SSP_FRAMES_UUID]: this.frames, [SSP_COMMANDS_UUID]: this.commands };
    const server: BleServer = {
      connected: false,
      connect: async () => {
        this.connects++;
        return server;
      },
      disconnect: () => {},
      getPrimaryService: async (uuid) => {
        expect(uuid).toBe(SSP_SERVICE_UUID);
        return { getCharacteristic: async (u) => chars[u] };
      },
    };
    this.gatt = server;
  }
}

function bleWorld() {
  const twin = new DigitalTwin({ recording: recording(), sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] }, clock: manualClock, driftPpm: 0 });
  const buds: Record<"left" | "right", FakeEarbud> = {
    left: new FakeEarbud("bud-L", (b) => twin.command("left", b)),
    right: new FakeEarbud("bud-R", (b) => twin.command("right", b)),
  };
  twin.start((bytes, side) => buds[side as "left" | "right"].frames.notify(bytes));
  // The chooser offers the right earbud first: the transport must learn sides from HELLO, not from order.
  const offered = [buds.right, buds.left];
  const requests: unknown[] = [];
  const bluetooth: BluetoothLike = {
    requestDevice: async (options) => {
      requests.push(options);
      return offered.shift()!;
    },
  };
  return { twin, buds, bluetooth, requests, offered };
}

describe("WebBluetoothTransport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects one earbud per pick, learns each side from its HELLO, streams and steers", async () => {
    const { twin, buds, bluetooth, requests } = bleWorld();
    const seen: string[] = [];
    const t = new WebBluetoothTransport({ bluetooth, onSide: (s) => seen.push(s) });
    const frames: Record<Side, SspFrame[]> = { left: [], right: [], single: [] };
    const decoders = { left: new SspDecoder(), right: new SspDecoder(), single: new SspDecoder() };
    await t.connect((bytes, side) => frames[side].push(...decoders[side].push(bytes)));
    expect(requests[0]).toEqual({ filters: [{ services: [SSP_SERVICE_UUID] }], optionalServices: [SSP_SERVICE_UUID] });
    expect(t.sides).toEqual(["right"]);
    await t.addDevice();
    expect(t.sides).toEqual(["right", "left"]);
    expect(seen).toEqual(["right", "left"]);

    twin.tick(1000);
    for (const side of ["left", "right"] as const) {
      expect(frames[side][0]).toMatchObject({ type: "hello", side });
      expect(frames[side].filter((f) => f.type === "eeg").length).toBeGreaterThan(10);
      expect(frames[side].every((f) => f.side === side)).toBe(true);
      expect(decoders[side].stats.crcErrors).toBe(0);
    }

    await t.send("left", encodeCommand({ op: "steer", azimuthDeg: 25, gainDb: 9 }, { side: "left" }));
    expect(twin.steering("left")).toEqual({ azimuthDeg: 25, gainDb: 9 });
    expect(twin.steering("right")).toBeNull();
    await expect(t.send("single", encodeCommand({ op: "hello" }))).resolves.toBeUndefined();

    await t.disconnect();
    expect(buds.left.frames.notifying).toBe(false);
    const after = frames.left.length;
    twin.tick(500);
    expect(frames.left.length).toBe(after);
  });

  it("gives up on an earbud that stays away, says so, and lets it be picked again", async () => {
    vi.useFakeTimers();
    const { buds, bluetooth, offered } = bleWorld();
    const lost: (Side | null)[] = [];
    const t = new WebBluetoothTransport({ bluetooth, onLost: (s) => lost.push(s) });
    await t.connect(() => {});
    expect(t.sides).toEqual(["right"]);
    buds.right.gatt.connect = async () => {
      throw new Error("out of range");
    };
    buds.right.dispatchEvent(new Event("gattserverdisconnected"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lost).toEqual(["right"]);
    expect(t.sides).toEqual([]);
    buds.right.gatt.connect = async () => buds.right.gatt;
    offered.unshift(buds.right);
    await t.addDevice();
    expect(t.sides).toEqual(["right"]);
    await t.disconnect();
  });

  it("queues GATT writes, one at a time, as the browser requires", async () => {
    const { buds, bluetooth } = bleWorld();
    let busy = false;
    let overlaps = 0;
    const write = buds.right.commands.writeValueWithResponse.bind(buds.right.commands);
    buds.right.commands.writeValueWithResponse = async (v: Uint8Array) => {
      if (busy) overlaps++;
      busy = true;
      await new Promise((r) => setTimeout(r, 2));
      busy = false;
      return write(v);
    };
    const t = new WebBluetoothTransport({ bluetooth });
    await t.connect(() => {});
    await Promise.all([0, 1, 2, 3].map((i) => t.send("right", encodeCommand({ op: "steer", azimuthDeg: i, gainDb: 1 }, { side: "right" }))));
    expect(overlaps).toBe(0);
    await t.disconnect();
  });

  it("reconnects an earbud that drops", async () => {
    vi.useFakeTimers();
    const { buds, bluetooth } = bleWorld();
    const t = new WebBluetoothTransport({ bluetooth });
    const commands: string[] = [];
    const write = buds.right.commands.writeValueWithResponse.bind(buds.right.commands);
    buds.right.commands.writeValueWithResponse = async (v: Uint8Array) => {
      commands.push(decodeCommand(v)!.command.op);
      return write(v);
    };
    await t.connect(() => {});
    expect(buds.right.connects).toBe(1);
    buds.right.dispatchEvent(new Event("gattserverdisconnected"));
    await vi.advanceTimersByTimeAsync(600);
    expect(buds.right.connects).toBe(2);
    expect(commands).toEqual(["hello", "start", "hello", "start"]);
    await t.disconnect();
  });
});

describe("TwinTransport", () => {
  it("streams the twin on real timers into the decoder, end to end", async () => {
    const t = new TwinTransport({ recording: recording(), sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] }, intervalMs: 10 });
    const frames: Record<Side, SspFrame[]> = { left: [], right: [], single: [] };
    const decoders = { left: new SspDecoder(), right: new SspDecoder(), single: new SspDecoder() };
    await t.connect((bytes, side) => frames[side].push(...decoders[side].push(bytes)));
    await new Promise((r) => setTimeout(r, 300));
    await t.send("right", encodeCommand({ op: "steer", azimuthDeg: -40, gainDb: 4.5 }, { side: "right" }));
    await t.disconnect();
    const count = frames.left.length + frames.right.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(frames.left.length + frames.right.length).toBe(count);
    for (const side of ["left", "right"] as const) {
      expect(frames[side][0]).toMatchObject({ type: "hello", side, flags: Flag.streamStart | Flag.simulated });
      expect(frames[side].some((f) => f.type === "eeg")).toBe(true);
      expect(decoders[side].stats).toMatchObject({ crcErrors: 0, gaps: 0 });
    }
    expect(t.twin.steering("right")).toEqual({ azimuthDeg: -40, gainDb: 4.5 });
  });
});
