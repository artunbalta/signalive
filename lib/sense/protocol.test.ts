import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ClockSync,
  ClockUnwrap,
  EegStream,
  Flag,
  INT24_MAX,
  INT24_MIN,
  SSP_COMMANDS_UUID,
  SSP_FRAMES_UUID,
  SSP_SERVICE_UUID,
  SspDecoder,
  clampInt24,
  crc16,
  decodeCommand,
  decodeFrame,
  encodeCommand,
  encodeFrame,
  maxEegSamples,
  maxEnvSamples,
  maxImuSamples,
  readInt24,
  writeInt24,
  yawDeg,
  yawQuat,
  type EegFrame,
  type HostCommand,
  type SspFrame,
} from "./protocol";

/* The C reference encoder's output: hardware/firmware/build.sh writes both. */
const bin = new Uint8Array(readFileSync(new URL("./__fixtures__/ssp-golden.bin", import.meta.url)));
type Json = Record<string, unknown>;
interface Golden {
  frames: { offset: number; length: number; corrupt: boolean; frame: Json }[];
  stats: { frames: number; crcErrors: number; gaps: number; lost: number };
  limits: { eeg4: number; eeg8: number; imu: number; env2: number; env3: number };
  crcCheck: { input: string; crc: number };
  uuids: { service: string; frames: string; commands: string };
  commands: { hex: string; frame: Json }[];
}
const golden = JSON.parse(readFileSync(new URL("./__fixtures__/ssp-golden.json", import.meta.url), "utf8")) as Golden;

/** A frame from the fixture's JSON, with its arrays typed the way the decoder returns them. */
function fromJson(j: Json): SspFrame {
  if (j.type === "eeg") return { ...j, counts: Int32Array.from(j.counts as number[]) } as unknown as SspFrame;
  if (j.type === "imu") return { ...j, values: Int16Array.from(j.values as number[]) } as unknown as SspFrame;
  if (j.type === "audioEnv") return { ...j, envelopes: Uint16Array.from(j.envelopes as number[]) } as unknown as SspFrame;
  return j as unknown as SspFrame;
}

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
const good = golden.frames.filter((e) => !e.corrupt);

/** A small seeded generator so the random tests repeat exactly. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function decodeInChunks(bytes: Uint8Array, sizes: () => number) {
  const d = new SspDecoder();
  const frames: SspFrame[] = [];
  for (let i = 0; i < bytes.length; ) {
    const n = Math.max(1, sizes());
    frames.push(...d.push(bytes.subarray(i, i + n)));
    i += n;
  }
  return { frames, stats: d.stats };
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const eeg = (seq: number, timestamp: number, counts: number[], channels = 2, side: SspFrame["side"] = "left"): EegFrame => ({
  type: "eeg",
  side,
  seq,
  timestamp,
  flags: 0,
  channels,
  samples: counts.length / channels,
  counts: Int32Array.from(counts),
});

describe("cross language: the C encoder's golden stream", () => {
  it("agrees on the GATT UUIDs", () => {
    expect(golden.uuids).toEqual({ service: SSP_SERVICE_UUID, frames: SSP_FRAMES_UUID, commands: SSP_COMMANDS_UUID });
    for (const u of Object.values(golden.uuids)) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("agrees on the CRC check value and the frame size limits", () => {
    expect(crc16(new TextEncoder().encode(golden.crcCheck.input))).toBe(golden.crcCheck.crc);
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x29b1);
    expect([maxEegSamples(4), maxEegSamples(8), maxImuSamples(), maxEnvSamples(2), maxEnvSamples(3)]).toEqual([
      golden.limits.eeg4,
      golden.limits.eeg8,
      golden.limits.imu,
      golden.limits.env2,
      golden.limits.env3,
    ]);
  });

  it("decodes every frame the C encoder wrote to the values it recorded", () => {
    const d = new SspDecoder();
    const frames = d.push(bin);
    expect(frames).toEqual(good.map((e) => fromJson(e.frame)));
    expect(d.stats).toMatchObject(golden.stats);
    expect(d.stats.unreadable).toBe(0);
  });

  it("decodes the same however the stream is chunked", () => {
    const whole = new SspDecoder().push(bin);
    const r = rng(1);
    for (const sizes of [() => 1, () => 2, () => 7, () => 233, () => 1 + Math.floor(r() * 300)]) {
      const { frames, stats } = decodeInChunks(bin, sizes);
      expect(frames).toEqual(whole);
      expect(stats).toMatchObject(golden.stats);
    }
  });

  it("encodes the same values to the same bytes as the C encoder", () => {
    for (const e of good) {
      expect(encodeFrame(fromJson(e.frame)), `${e.frame.type} at ${e.offset}`).toEqual(bin.subarray(e.offset, e.offset + e.length));
    }
  });

  it("differs from the corrupted frame only in the CRC byte the fixture inverted", () => {
    const bad = golden.frames.find((e) => e.corrupt)!;
    const mine = encodeFrame(fromJson(bad.frame));
    mine[mine.length - 2] ^= 0xff;
    expect(mine).toEqual(bin.subarray(bad.offset, bad.offset + bad.length));
  });

  it("reads and writes host commands exactly as the firmware's parser expects", () => {
    for (const c of golden.commands) {
      const bytes = hex(c.hex);
      expect(decodeCommand(bytes)).toEqual(c.frame);
      const f = c.frame as unknown as { side: SspFrame["side"]; seq: number; timestamp: number; flags: number; command: HostCommand };
      expect(encodeCommand(f.command, f)).toEqual(bytes);
    }
  });
});

describe("encodeFrame and the decoders", () => {
  const r = rng(7);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const head = () => ({ side: (["left", "right", "single"] as const)[int(0, 2)], seq: int(0, 0xffff), timestamp: int(0, 0xffffffff), flags: int(0, 255) });

  it("round trips random frames of every type", () => {
    for (let k = 0; k < 200; k++) {
      const c = int(1, 32);
      const n = int(1, Math.min(255, Math.floor((1008 - 2) / (3 * c))));
      const talkers = int(1, 8);
      const frames: SspFrame[] = [
        { ...head(), type: "eeg", channels: c, samples: n, counts: Int32Array.from({ length: n * c }, () => int(INT24_MIN, INT24_MAX)) },
        { ...head(), type: "imu", samples: int(1, 50), values: new Int16Array(0) },
        { ...head(), type: "event", code: int(0, 255), value: int(0, 0xffffffff) },
        {
          ...head(),
          type: "hello",
          firmware: [int(0, 255), int(0, 255), int(0, 255)],
          deviceId: Array.from({ length: 8 }, () => int(0, 255).toString(16).padStart(2, "0")).join(""),
          labels: Array.from({ length: c }, (_, i) => `C${i}`.slice(0, 4)),
          eegRate: int(1, 2000),
          nvPerLsb: Math.fround(r() * 100),
          imuRate: int(0, 1000),
          battery: int(0, 255),
        },
        {
          ...head(),
          type: "audioEnv",
          samples: int(1, 20),
          talkers,
          azimuths: Array.from({ length: talkers }, () => int(-1800, 1800) / 10),
          envelopes: new Uint16Array(0),
        },
        { ...head(), type: "command", command: { op: "steer", azimuthDeg: int(-1800, 1800) / 10, gainDb: int(-200, 200) / 10 } },
        { ...head(), type: "command", command: { op: "setEegRate", rate: int(0, 0xffff) } },
      ];
      const imu = frames[1] as Extract<SspFrame, { type: "imu" }>;
      imu.values = Int16Array.from({ length: imu.samples * 10 }, () => int(-32768, 32767));
      const env = frames[4] as Extract<SspFrame, { type: "audioEnv" }>;
      env.envelopes = Uint16Array.from({ length: env.samples * env.talkers }, () => int(0, 0xffff));
      for (const f of frames) expect(decodeFrame(encodeFrame(f))).toEqual(f);
    }
  });

  it("decodes a frame split at every possible byte", () => {
    const a = encodeFrame(eeg(1, 100, [1, -1, INT24_MAX, INT24_MIN]));
    const b = encodeFrame(eeg(2, 108, [5, 6, 7, 8]));
    const both = concat(a, b);
    for (let cut = 0; cut <= both.length; cut++) {
      const d = new SspDecoder();
      const frames = [...d.push(both.subarray(0, cut)), ...d.push(both.subarray(cut))];
      expect(frames.map((f) => f.seq)).toEqual([1, 2]);
      expect(d.stats.crcErrors).toBe(0);
    }
  });

  it("skips a corrupted frame and resyncs on the next magic", () => {
    const frames = [0, 1, 2, 3].map((i) => encodeFrame(eeg(i, i * 8000, [i, -i, 10 * i, -10 * i])));
    frames[1][20] ^= 0x10;
    const d = new SspDecoder();
    const out = d.push(concat(...frames));
    expect(out.map((f) => f.seq)).toEqual([0, 2, 3]);
    expect(d.stats).toMatchObject({ frames: 3, crcErrors: 1, gaps: 1, lost: 1 });
  });

  it("does not let a corrupted length hide the frames behind it", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => encodeFrame(eeg(i, i * 8000, Array.from({ length: 36 }, (_, k) => k * i), 4)));
    // Frame 1 claims a 1000 byte payload; the decoder must wait for it, fail its CRC, then find frame 2 inside.
    frames[1][12] = 1000 & 0xff;
    frames[1][13] = 1000 >> 8;
    const d = new SspDecoder();
    const out = [...d.push(concat(...frames)), ...d.push(new Uint8Array(1100))];
    expect(out.map((f) => f.seq)).toEqual([0, 2, 3, 4, 5, 6, 7]);
    expect(d.stats.crcErrors).toBe(1);
  });

  it("flushes at the end of a stream: frames behind a corrupted length come out", () => {
    const frames = [0, 1, 2].map((i) => encodeFrame(eeg(i, i * 8000, [i, -i])));
    frames[0][12] = 200; // claims more than the stream will ever hold
    const d = new SspDecoder();
    expect(d.push(concat(...frames))).toEqual([]);
    expect(d.flush().map((f) => f.seq)).toEqual([1, 2]);
    expect(d.push(encodeFrame(eeg(3, 0, [0, 0]))).map((f) => f.seq)).toEqual([3]);
  });

  it("finds frames among garbage, including false magic", () => {
    const r2 = rng(3);
    const parts: Uint8Array[] = [];
    for (let i = 0; i < 50; i++) {
      const junk = Uint8Array.from({ length: Math.floor(r2() * 40) }, () => Math.floor(r2() * 256));
      if (i % 5 === 0 && junk.length > 3) junk.set([0x53, 0x4c, 0x00], 1);
      parts.push(junk, encodeFrame(eeg(i, i * 8000, [i, 2 * i])));
    }
    const { frames, stats } = decodeInChunks(concat(...parts), () => 1 + Math.floor(r2() * 64));
    expect(frames.map((f) => f.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(stats.gaps).toBe(0);
    expect(stats.skipped).toBeGreaterThan(0);
  });

  it("counts gaps per side, across the seq wrap, and forgets a side at stream start", () => {
    const d = new SspDecoder();
    d.push(concat(encodeFrame(eeg(65534, 0, [0, 0])), encodeFrame(eeg(65535, 0, [0, 0])), encodeFrame(eeg(0, 0, [0, 0]))));
    expect(d.stats.gaps).toBe(0);
    d.push(concat(encodeFrame(eeg(7, 0, [0, 0], 2, "right")), encodeFrame(eeg(1, 0, [0, 0]))));
    expect(d.stats).toMatchObject({ gaps: 0 });
    d.push(encodeFrame(eeg(9, 0, [0, 0], 2, "right")));
    expect(d.stats).toMatchObject({ gaps: 1, lost: 1 });
    d.push(encodeFrame({ ...eeg(500, 0, [0, 0]), flags: Flag.streamStart }));
    expect(d.stats.gaps).toBe(1);
    // Commands carry the phone's own count and never make a gap.
    d.push(encodeCommand({ op: "start" }, { side: "left", seq: 9999 }));
    d.push(encodeFrame(eeg(501, 0, [0, 0])));
    expect(d.stats.gaps).toBe(1);
  });

  it("reads a longer payload from a later version and skips unknown types without a false gap", () => {
    const f = encodeFrame(eeg(1, 0, [3, 4]));
    const longer = new Uint8Array(f.length + 3);
    longer.set(f.subarray(0, f.length - 2));
    longer[12] = f[12] + 3;
    longer.set([9, 9, 9], f.length - 2);
    const c = crc16(longer, 0, longer.length - 2);
    longer[longer.length - 2] = c & 0xff;
    longer[longer.length - 1] = c >> 8;
    expect(decodeFrame(longer)).toEqual(eeg(1, 0, [3, 4]));

    const unknown = encodeFrame({ type: "event", side: "left", seq: 2, timestamp: 0, flags: 0, code: 1, value: 1 });
    unknown[3] = 0x7e;
    const u = crc16(unknown, 0, unknown.length - 2);
    unknown[unknown.length - 2] = u & 0xff;
    unknown[unknown.length - 1] = u >> 8;
    const d = new SspDecoder();
    const out = d.push(concat(f, unknown, encodeFrame(eeg(3, 0, [0, 0]))));
    expect(out.map((x) => x.seq)).toEqual([1, 3]);
    expect(d.stats).toMatchObject({ unreadable: 1, gaps: 0 });
  });

  it("refuses frames the protocol cannot carry", () => {
    expect(() => encodeFrame(eeg(0, 0, [1, 2, 3], 2))).toThrow(RangeError);
    expect(() => encodeFrame({ ...eeg(0, 0, [1]), channels: 1, samples: 1, counts: Int32Array.from([1]), side: "both" as never })).toThrow(RangeError);
    expect(() => encodeFrame(eeg(0, 0, Array(255 * 32).fill(0), 32))).toThrow(RangeError);
    expect(() => encodeCommand({ op: "steer", azimuthDeg: 5000, gainDb: 0 })).toThrow(RangeError);
    expect(() => encodeCommand({ op: "nope" } as unknown as HostCommand)).toThrow(RangeError);
    expect(decodeCommand(encodeFrame(eeg(0, 0, [1, 2])))).toBeNull();
    const cmd = encodeCommand({ op: "hello" });
    cmd[cmd.length - 1] ^= 1;
    expect(decodeCommand(cmd)).toBeNull();
  });

  it("saturates int24 and reads back its extremes", () => {
    const b = new Uint8Array(3);
    for (const v of [0, 1, -1, INT24_MAX, INT24_MIN, 0x123456, -0x123456]) {
      writeInt24(b, 0, v);
      expect(readInt24(b, 0)).toBe(v);
    }
    expect([clampInt24(9e6), clampInt24(-9e6), clampInt24(NaN), clampInt24(2.6)]).toEqual([INT24_MAX, INT24_MIN, 0, 3]);
    expect(encodeFrame(eeg(0, 0, [9_000_000, -9_000_000]))).toEqual(encodeFrame(eeg(0, 0, [INT24_MAX, INT24_MIN])));
  });

  it("turns yaw into a quaternion and back", () => {
    for (const deg of [-179, -90, -30.5, 0, 12.3, 90, 179]) {
      const q = yawQuat(deg);
      expect(yawDeg(...q)).toBeCloseTo(deg, 9);
    }
  });
});

describe("time series on the phone", () => {
  it("unwraps the device clock, and tolerates frames slightly out of order", () => {
    const u = new ClockUnwrap();
    expect([0xfffff000, 0xfffff800, 0x00000400, 0xfffffc00, 0x00000800].map((t) => u.push(t))).toEqual([
      0xfffff000,
      0xfffff800,
      2 ** 32 + 0x400,
      0xfffffc00,
      2 ** 32 + 0x800,
    ]);
  });

  it("fills lost frames with NaN and never shifts the samples after them", () => {
    const fs = 250;
    const s = new EegStream(fs, 2, 1000);
    // Five frames of 4 samples; the third is lost. Timestamps wrap on the way.
    const t0 = 2 ** 32 - 20_000;
    const frames = [0, 1, 2, 3, 4].map((i) =>
      eeg(i, (t0 + i * 16_000) % 2 ** 32, Array.from({ length: 8 }, (_, k) => 100 * i + k)),
    );
    const chunks = [frames[0], frames[1], frames[3], frames[4]].map((f) => s.push(f)!);
    expect(chunks.map((c) => [c.index, c.missing])).toEqual([
      [0, 0],
      [4, 0],
      [8, 4],
      [16, 0],
    ]);
    expect(s.length).toBe(20);
    expect(Array.from(chunks[2].data[0])).toEqual([NaN, NaN, NaN, NaN, 300, 302, 304, 306]);
    expect(chunks[2].time).toBe(t0 + 2 * 16_000);
    expect(chunks[3].data[1][0]).toBe(401);
    expect(s.push(frames[4])).toBeNull();
  });

  it("restarts the series when the earbud's clock goes back without a HELLO", () => {
    const s = new EegStream(250, 2, 1000);
    s.push(eeg(0, 900_000, [1, 2, 3, 4]));
    s.push(eeg(1, 908_000, [5, 6, 7, 8]));
    const after = s.push(eeg(0, 1_000, [9, 10, 11, 12]))!;
    expect(after).toMatchObject({ index: 4, missing: 0, restart: true });
    expect(s.push(eeg(1, 9_000, [13, 14, 15, 16]))).toMatchObject({ index: 6, missing: 0, restart: false });
  });

  it("follows a dev kit clock 0.4% slow, and is not tilted by a phone that stalled", () => {
    const r = rng(11);
    for (const [ppm, stall] of [
      [-4000, false],
      [30, true],
    ] as const) {
      const sync = new ClockSync();
      let worst = 0;
      for (let k = 0; k < 2400; k++) {
        const host = k * 50;
        const device = 1e9 + host * 1000 * (1 + ppm * 1e-6);
        // A stall: for two seconds every frame is held back, then they all arrive together.
        const late = stall && host >= 40_000 && host < 42_000 ? 42_000 - host : 0;
        sync.observe(device, host + 3 + r() * 30 + late);
        if (host > 20_000 && !late) worst = Math.max(worst, Math.abs(sync.toHost(device) - host - 3));
      }
      expect(worst).toBeLessThan(2);
      expect(Math.abs(sync.driftPpm - ppm)).toBeLessThan(20);
    }
  });

  it("maps a drifting, jittery device clock onto the phone's", () => {
    const r = rng(5);
    const sync = new ClockSync();
    const ppm = 80;
    let worst = 0;
    for (let k = 0; k < 2000; k++) {
      const host = k * 50;
      const device = 7e9 + host * 1000 * (1 + ppm * 1e-6);
      sync.observe(device, host + 3 + r() * 30);
      if (host > 20_000) worst = Math.max(worst, Math.abs(sync.toHost(device) - host - 3));
    }
    expect(worst).toBeLessThan(1.5);
    expect(Math.abs(sync.driftPpm - ppm)).toBeLessThan(10);
  });
});
