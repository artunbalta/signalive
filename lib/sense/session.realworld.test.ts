import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClenchEvent } from "./clench";
import type { DecoderModel } from "./decoder";
import { decodeCommand, encodeCommand, encodeFrame, type Side } from "./protocol";
import { PhoneSession } from "./session";
import { DigitalTwin, manualClock, type TwinOptions } from "./twin";

/**
 * PhoneSession against what radios and phones really do, on a real
 * recording: the clearest person from research/aad, streamed by the digital
 * twin with the two stories' envelopes as AUDIO_ENV, exactly as the research
 * page's console does. Each scenario checks that the decoder's EEG and
 * envelopes stay on one timeline (its verdicts stay right as often as with a
 * perfect link) and that clenches keep being found.
 */

type Meta = {
  fsRaw: number;
  channels: string[];
  lsbUv: number;
  offsetsUv: number[];
  samples: number;
  leadSamples: number;
  envelopes: [number[], number[]];
  attendedStory: number;
  model: DecoderModel;
};

const dir = new URL("../../public/research/people/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("clearest.json", dir), "utf8")) as Meta;
const codes = new Int16Array(readFileSync(new URL("clearest.bin", dir)).buffer.slice(0));
const C = meta.channels.length;
const data = Array.from({ length: C }, (_, ch) => {
  const out = new Float32Array(meta.samples);
  for (let k = 0; k < meta.samples; k++) out[k] = codes[k * C + ch] * meta.lsbUv + meta.offsetsUv[ch];
  return out;
});
const n64 = Math.floor((meta.samples * 64) / meta.fsRaw);
const lead64 = Math.round((meta.leadSamples * 64) / meta.fsRaw);
const audio = meta.envelopes.map((env) => {
  const out = new Float32Array(n64);
  for (let i = 0; i < env.length && lead64 + i < n64; i++) out[lead64 + i] = env[i];
  return out;
});

/** How each side's bytes reach the phone: what to deliver now (nothing drops them, more delivers a backlog). */
type Link = (bytes: Uint8Array, side: Side, t: number) => { bytes: Uint8Array; side: Side }[];

function run(opts: { twin?: Partial<TwinOptions>; link?: Link; seconds?: number; at?: (t: number, twin: DigitalTwin) => void }) {
  const twin = new DigitalTwin({
    recording: { fs: meta.fsRaw, labels: meta.channels, data },
    sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] },
    audio: { azimuths: [-90, 90], data: audio },
    clock: manualClock,
    seed: 11,
    ...opts.twin,
  });
  let host = 0;
  const session = new PhoneSession({ fs: meta.fsRaw, perEar: 4, model: meta.model, azimuths: [-90, 90], now: () => host });
  twin.start((bytes, side) => {
    for (const d of opts.link ? opts.link(bytes, side, twin.time) : [{ bytes, side }]) session.bytes(d.bytes, d.side);
  });
  const verdicts: { t: number; right: boolean }[] = [];
  const seconds = opts.seconds ?? 200;
  let next = 1000;
  for (let t = 0; t < seconds * 1000; t += 20) {
    opts.at?.(t, twin);
    twin.tick(20);
    host = twin.time + 8;
    if (twin.time >= next) {
      next += 1000;
      const e = session.snapshot().eeg;
      if (e && twin.time >= 31_000) verdicts.push({ t: twin.time, right: e.talker === meta.attendedStory });
    }
  }
  const d = session.decoder!;
  const share = (from = 0) => {
    const v = verdicts.filter((x) => x.t >= from);
    return v.length ? v.filter((x) => x.right).length / v.length : 0;
  };
  return { session, twin, d, verdicts, share, skew: d.featureCount - d.envelopeCount(0) };
}

const baseline = run({});

describe("PhoneSession on a real recording, through a real radio", () => {
  it("decodes the followed story with a perfect link", () => {
    expect(baseline.verdicts.length).toBeGreaterThan(150);
    expect(baseline.share()).toBeGreaterThan(0.8);
    expect(Math.abs(baseline.skew)).toBeLessThan(40);
  });

  it("keeps one timeline when an earbud stalls and then delivers its backlog", () => {
    // Every 10 s the right earbud's link stalls 700 ms, then everything held arrives at once.
    let held: Uint8Array[] = [];
    const r = run({
      link: (bytes, side, t) => {
        if (side !== "right") return [{ bytes, side }];
        if (t % 10_000 < 700) {
          held.push(bytes);
          return [];
        }
        const out = [...held, bytes].map((b) => ({ bytes: b, side }));
        held = [];
        return out;
      },
    });
    expect(Math.abs(r.skew)).toBeLessThan(40);
    expect(r.share()).toBeGreaterThan(baseline.share() - 0.08);
  });

  it("keeps one timeline when the envelope sending earbud joins 15 s late", () => {
    const r = run({
      at: (t, twin) => {
        if (t === 0) twin.command("left", encodeCommand({ op: "stop" }, { side: "left" }));
        if (t === 15_000) twin.command("left", encodeCommand({ op: "start" }, { side: "left" }));
      },
    });
    expect(r.share(60_000)).toBeGreaterThan(baseline.share(60_000) - 0.08);
  });

  it("keeps one timeline when an earbud stops for 10 s and starts again", () => {
    const r = run({
      at: (t, twin) => {
        if (t === 40_000) twin.command("left", encodeCommand({ op: "stop" }, { side: "left" }));
        if (t === 50_000) twin.command("left", encodeCommand({ op: "start" }, { side: "left" }));
      },
    });
    expect(r.share(80_000)).toBeGreaterThan(baseline.share(80_000) - 0.08);
  });

  it("picks the envelopes up again after they paused for 36.5 minutes", () => {
    // AUDIO_ENV is optional: a quiet room can pause it while the EEG keeps
    // streaming, longer than half the 32 bit microsecond clock.
    const r = run({ seconds: 2400, link: (bytes, side, t) => (bytes[3] === 0x06 && t >= 60_000 && t < 2_250_000 ? [] : [{ bytes, side }]) });
    expect(r.verdicts.filter((v) => v.t > 2_280_000).length).toBeGreaterThan(100);
    expect(r.share(2_280_000)).toBeGreaterThan(0.6);
  }, 120_000);

  it("comes back after the tab was hidden for a minute", () => {
    const r = run({ link: (bytes, side, t) => (t < 60_000 || t >= 120_000 ? [{ bytes, side }] : []) });
    expect(r.verdicts.filter((v) => v.t > 150_000).length).toBeGreaterThan(40);
    expect(r.share(150_000)).toBeGreaterThan(0.6);
  });
});

describe("PhoneSession keeps the clench through a bad link", () => {
  function clenches(keep: (bytes: Uint8Array, side: Side, t: number) => boolean) {
    const twin = new DigitalTwin({ recording: { fs: meta.fsRaw, labels: meta.channels, data }, sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] }, clock: manualClock, seed: 4 });
    let host = 0;
    const session = new PhoneSession({ fs: meta.fsRaw, perEar: 4, now: () => host });
    const events: ClenchEvent[] = [];
    session.onClench((e) => events.push(e));
    twin.start((bytes, side) => {
      if (keep(bytes, side, twin.time)) session.bytes(bytes, side);
    });
    const go = (ms: number) => {
      for (let t = 0; t < ms; t += 20) {
        twin.tick(20);
        host = twin.time + 8;
      }
    };
    go(5000);
    twin.clench("single");
    go(1500);
    twin.clench("double");
    go(2000);
    twin.clench("hold");
    go(2500);
    return { kinds: events.map((e) => e.kind), mode: session.snapshot().clench };
  }
  let seed = 99;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

  it("with 30% of the right earbud's frames lost", () => {
    expect(clenches((_b, side) => side !== "right" || rand() > 0.3).kinds).toEqual(["single", "double", "hold"]);
  });

  it("with 70% of the right earbud's frames lost, on the left ear", () => {
    const r = clenches((_b, side) => side !== "right" || rand() > 0.7);
    expect(r.mode).toBe("left");
    expect(r.kinds).toEqual(["single", "double", "hold"]);
  });

  it("with the right earbud's link going on and off every 2.5 s", () => {
    expect(clenches((_b, side, t) => side !== "right" || t % 5000 < 2500).kinds).toEqual(["single", "double", "hold"]);
  });

  it("with the link going on and off at any phase of the clench", () => {
    // A handover between detectors can land anywhere in a gesture: slide the on and off pattern across it.
    const missed: number[] = [];
    for (let step = 0; step < 20; step++) {
      const r = clenches((_b, side, t) => side !== "right" || (t + step * 250) % 5000 < 2500);
      if (r.kinds.join() !== "single,double,hold") missed.push(step);
    }
    expect(missed).toEqual([]);
  });

  it("with 97% of the right earbud's frames lost, on the left ear alone", () => {
    const r = clenches((_b, side) => side !== "right" || rand() > 0.97);
    expect(r.mode).toBe("left");
    expect(r.kinds).toEqual(["single", "double", "hold"]);
  });
});

describe("PhoneSession edges", () => {
  it("steers relative to the head", () => {
    const twin = new DigitalTwin({ recording: { fs: meta.fsRaw, labels: meta.channels, data }, sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] }, clock: manualClock, seed: 2 });
    let host = 0;
    const session = new PhoneSession({ fs: meta.fsRaw, perEar: 4, now: () => host });
    twin.start((bytes, side) => session.bytes(bytes, side));
    for (const [yaw, expected] of [
      [0, 90],
      [60, 30],
      [120, -30],
    ] as const) {
      twin.setYaw(yaw);
      for (let t = 0; t < 2000; t += 20) {
        twin.tick(20);
        host = twin.time;
      }
      const cmd = decodeCommand(session.steer([0.1, 0.9]))?.command;
      expect(cmd?.op).toBe("steer");
      if (cmd?.op === "steer") expect(Math.abs(cmd.azimuthDeg - expected)).toBeLessThan(1.5);
    }
  });

  it("does not throw steering a single voice", () => {
    const session = new PhoneSession({ fs: 500, perEar: 4, azimuths: [0] });
    const cmd = decodeCommand(session.steer([1]))?.command;
    expect(cmd).toEqual({ op: "steer", azimuthDeg: 0, gainDb: 0 });
  });

  it("forgets the yaw of an earbud that has gone", () => {
    const twin = new DigitalTwin({ recording: { fs: meta.fsRaw, labels: meta.channels, data }, sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] }, clock: manualClock, seed: 2 });
    let host = 0;
    const session = new PhoneSession({ fs: meta.fsRaw, perEar: 4, now: () => host });
    twin.start((bytes, side) => session.bytes(bytes, side));
    for (let t = 0; t < 1000; t += 20) (twin.tick(20), (host = twin.time));
    twin.command("left", encodeCommand({ op: "stop" }, { side: "left" }));
    twin.setYaw(60);
    for (let t = 0; t < 2000; t += 20) (twin.tick(20), (host = twin.time));
    expect(Math.abs((session.yaw ?? 0) - 60)).toBeLessThan(2);
  });

  it("says so, instead of guessing, when the earbuds' rates cannot work", () => {
    const hello = (side: Side, eegRate: number) =>
      encodeFrame({ type: "hello", side, seq: 0, timestamp: 0, flags: 1, firmware: [0, 1, 0], deviceId: "0011223344556677", labels: ["E1", "E2", "E3", "E4"], eegRate, nvPerLsb: 22.35, imuRate: 0, battery: 90 });
    const mixed = new PhoneSession({ fs: 500, perEar: 4, now: () => 0 });
    mixed.bytes(hello("left", 500), "left");
    mixed.bytes(hello("right", 250), "right");
    expect(mixed.snapshot().warning).toMatch(/different EEG rates/);
    const slow = new PhoneSession({ fs: 500, perEar: 4, now: () => 0 });
    expect(() => slow.bytes(hello("left", 50), "left")).not.toThrow();
    expect(slow.fs).toBe(500);
    expect(slow.snapshot().warning).toMatch(/too slow/);
  });

  it("runs at the rate the earbuds announce", () => {
    const twin = new DigitalTwin({ recording: { fs: meta.fsRaw, labels: meta.channels, data }, sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] }, clock: manualClock, seed: 6, eegRate: 250 });
    let host = 0;
    const session = new PhoneSession({ fs: 500, perEar: 4, now: () => host });
    const kinds: string[] = [];
    session.onClench((e) => kinds.push(e.kind));
    twin.start((bytes, side) => session.bytes(bytes, side));
    const go = (ms: number) => {
      for (let t = 0; t < ms; t += 20) (twin.tick(20), (host = twin.time));
    };
    go(4000);
    expect(session.fs).toBe(250);
    twin.clench("hold");
    go(2500);
    expect(kinds).toEqual(["hold"]);
  });
});
