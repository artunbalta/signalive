import { describe, expect, it } from "vitest";
import {
  ClockSync,
  ClockUnwrap,
  EarAligner,
  EegStream,
  EventCode,
  Flag,
  SspDecoder,
  encodeCommand,
  imuSamples,
  yawDeg,
  type EegFrame,
  type HelloFrame,
  type Side,
  type SspFrame,
} from "./protocol";
import { DigitalTwin, manualClock, type TwinClock, type TwinOptions, type TwinRecording } from "./twin";

const FS = 250;
const NV = 4.5e9 / 24 / 2 ** 23;
const LSB_UV = NV / 1000;

/** Eight channels of slow, distinct sines with offsets, in microvolts: four per ear. */
function recording(seconds = 4, amp = 20): TwinRecording {
  const n = seconds * FS;
  return {
    fs: FS,
    labels: ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4"],
    data: Array.from({ length: 8 }, (_, c) =>
      Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * (3 + c) * i) / FS + c) + 5 * c),
    ),
  };
}

const PAIR = { left: [0, 1, 2, 3], right: [4, 5, 6, 7] };

function twin(opts: Partial<TwinOptions> = {}) {
  return new DigitalTwin({ recording: recording(), sides: PAIR, clock: manualClock, driftPpm: 0, ...opts });
}

/** Starts a twin with one decoder per earbud; returns what arrives, with the simulated time it arrived. */
function listen(t: DigitalTwin) {
  const frames: Record<Side, SspFrame[]> = { left: [], right: [], single: [] };
  const arrivals: Record<Side, number[]> = { left: [], right: [], single: [] };
  const bytes: Record<Side, number[]> = { left: [], right: [], single: [] };
  const decoders = { left: new SspDecoder(), right: new SspDecoder(), single: new SspDecoder() };
  t.start((b, side) => {
    bytes[side].push(...b);
    for (const f of decoders[side].push(b)) {
      frames[side].push(f);
      arrivals[side].push(t.time);
    }
  });
  return { frames, arrivals, bytes, decoders };
}

const eegOf = (fs: SspFrame[]) => fs.filter((f): f is EegFrame => f.type === "eeg");

/** One channel's samples across frames, in microvolts. */
function channel(frames: EegFrame[], c: number) {
  const out: number[] = [];
  for (const f of frames) for (let s = 0; s < f.samples; s++) out.push(f.counts[s * f.channels + c] * LSB_UV);
  return out;
}

function rms(x: number[]) {
  return Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
}

describe("DigitalTwin", () => {
  it("streams two seconds of both earbuds, each opening with HELLO", () => {
    const t = twin();
    const { frames, decoders } = listen(t);
    t.tick(2000);
    for (const side of ["left", "right"] as const) {
      const hello = frames[side][0] as HelloFrame;
      expect(hello.type).toBe("hello");
      expect(hello.flags).toBe(Flag.streamStart | Flag.simulated);
      expect(hello).toMatchObject({ eegRate: FS, imuRate: 100, labels: side === "left" ? ["L1", "L2", "L3", "L4"] : ["R1", "R2", "R3", "R4"] });
      expect(hello.nvPerLsb).toBe(Math.fround(NV));
      const eeg = eegOf(frames[side]);
      expect(eeg.every((f) => f.samples === 18 && f.channels === 4)).toBe(true);
      const n = eeg.reduce((a, f) => a + f.samples, 0);
      expect(n).toBeGreaterThan(2 * FS - 18);
      expect(n).toBeLessThanOrEqual(2 * FS + 1);
      expect(decoders[side].stats).toMatchObject({ crcErrors: 0, gaps: 0, unreadable: 0 });
      expect(frames[side].filter((f) => f.type === "imu").length).toBe(40);
    }
  });

  it("sends the recording back within one LSB", () => {
    const t = twin();
    const { frames } = listen(t);
    t.tick(5000);
    const rec = recording();
    for (const [side, chans] of [["left", PAIR.left], ["right", PAIR.right]] as const) {
      const eeg = eegOf(frames[side]);
      chans.forEach((ch, j) => {
        const got = channel(eeg, j);
        expect(got.length).toBeGreaterThan(4 * FS);
        let worst = 0;
        got.forEach((v, k) => (worst = Math.max(worst, Math.abs(v - rec.data[ch][k % rec.data[ch].length]))));
        expect(worst).toBeLessThanOrEqual(LSB_UV);
      });
    }
  });

  it("packs a single eight channel device nine samples to a frame", () => {
    const t = new DigitalTwin({ recording: recording(), clock: manualClock });
    const { frames } = listen(t);
    t.tick(1000);
    expect(t.sides).toEqual(["single"]);
    const eeg = eegOf(frames.single);
    expect(eeg.length).toBeGreaterThan(20);
    expect(eeg.every((f) => f.samples === 9 && f.channels === 8)).toBe(true);
    expect(frames.left.length + frames.right.length).toBe(0);
  });

  it("puts a clench on every channel of both earbuds, in its band and its time", () => {
    const rec = recording(4, 5);
    const t = twin({ recording: rec });
    const { frames } = listen(t);
    t.tick(1000);
    t.clench("single");
    t.tick(1000);
    const at = (ms: number) => Math.round((ms * FS) / 1000);
    for (const [side, chans] of [["left", PAIR.left], ["right", PAIR.right]] as const) {
      chans.forEach((ch, j) => {
        const emg = channel(eegOf(frames[side]), j).map((v, k) => v - rec.data[ch][k]);
        const burst = emg.slice(at(1010), at(1190));
        expect(rms(burst)).toBeGreaterThan(25);
        expect(rms(burst)).toBeLessThan(55);
        expect(rms(emg.slice(0, at(1000)))).toBeLessThan(LSB_UV);
        expect(rms(emg.slice(at(1201), at(1900)))).toBeLessThan(LSB_UV);
        // Its power is in the EMG band, not in the EEG band the decoder uses.
        const power = (f0: number, f1: number) => {
          let p = 0;
          for (let f = f0; f <= f1; f += 5) {
            let re = 0;
            let im = 0;
            burst.forEach((v, k) => {
              const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (burst.length - 1));
              re += w * v * Math.cos((2 * Math.PI * f * k) / FS);
              im += w * v * Math.sin((2 * Math.PI * f * k) / FS);
            });
            p += re * re + im * im;
          }
          return p;
        };
        expect(power(35, 110)).toBeGreaterThan(8 * power(0, 15));
      });
    }
  });

  it("shapes double and hold clenches", () => {
    const rec = recording(4, 5);
    const level = (kind: "double" | "hold") => {
      const t = twin({ recording: rec });
      const { frames } = listen(t);
      t.tick(500);
      t.clench(kind);
      t.tick(2000);
      const emg = channel(eegOf(frames.left), 0).map((v, k) => v - rec.data[0][k]);
      const win = (a: number, b: number) => rms(emg.slice(Math.round((a * FS) / 1000), Math.round((b * FS) / 1000)));
      return win;
    };
    const d = level("double");
    expect(d(510, 640)).toBeGreaterThan(20);
    expect(d(660, 890)).toBeLessThan(LSB_UV);
    expect(d(910, 1040)).toBeGreaterThan(20);
    expect(d(1060, 1500)).toBeLessThan(LSB_UV);
    const h = level("hold");
    expect(h(510, 1690)).toBeGreaterThan(25);
    expect(h(1710, 2400)).toBeLessThan(LSB_UV);
  });

  it("turns the head: the quaternion's yaw lands on setYaw and the gyro integrates to the turn", () => {
    const t = twin();
    const { frames } = listen(t);
    t.tick(500);
    t.setYaw(30);
    t.tick(1000);
    t.setYaw(-170);
    t.tick(1500);
    for (const side of ["left", "right"] as const) {
      const imu = frames[side].filter((f) => f.type === "imu");
      const samples = imu.flatMap((f) => imuSamples(f).map((s, i) => ({ ...s, t: (f.timestamp - imu[0].timestamp) / 1000 + i * 10 })));
      const yawAt = (ms: number) => {
        const s = samples.find((x) => x.t >= ms)!;
        return yawDeg(...s.quat);
      };
      expect(yawAt(0)).toBeCloseTo(0, 2);
      expect(yawAt(800)).toBeCloseTo(30, 1);
      expect(yawAt(1400)).toBeCloseTo(30, 1);
      // 30 to -170 the short way is 160 degrees to the right, through 180.
      expect(Math.abs(yawAt(2800) + 170)).toBeLessThan(0.1);
      let turned = 0;
      for (const s of samples.filter((x) => x.t < 1500)) turned += s.gyro[2] / 100;
      expect(turned).toBeGreaterThan(27.5);
      expect(turned).toBeLessThan(32.5);
      const accel = samples[0].accel;
      expect(accel[2]).toBeCloseTo(-1, 1);
    }
    expect(t.yaw).toBeCloseTo(-170, 6);
  });

  it("is deterministic for a seed, however time is chopped into ticks", () => {
    const run = (step: number, seed: number) => {
      const t = twin({ seed, driftPpm: undefined, loss: 0.05 });
      const { bytes } = listen(t);
      for (let ms = 0; ms < 1000; ms += step) t.tick(Math.min(step, 1000 - ms));
      t.clench("double");
      t.setYaw(45);
      for (let ms = 0; ms < 1500; ms += step) t.tick(Math.min(step, 1500 - ms));
      return bytes;
    };
    const a = run(1500, 9);
    const b = run(37, 9);
    expect(b.left).toEqual(a.left);
    expect(b.right).toEqual(a.right);
    expect(run(1500, 10).left).not.toEqual(a.left);
  });

  it("runs each earbud on its own drifting clock, which wraps", () => {
    const t = twin({ driftPpm: { left: 500, right: -500 }, clockStartUs: { left: 2 ** 32 - 5e6, right: 1e9 } });
    const { frames, arrivals } = listen(t);
    t.tick(20_000);
    for (const [side, ppm] of [["left", 500], ["right", -500]] as const) {
      const unwrap = new ClockUnwrap();
      const pts = frames[side]
        .map((f, i) => ({ f, at: arrivals[side][i] }))
        .filter((p) => p.f.type === "eeg")
        .map((p) => ({ x: p.at, y: unwrap.push(p.f.timestamp) }));
      if (side === "left") expect(pts.some((p) => p.y >= 2 ** 32)).toBe(true);
      const n = pts.length;
      const mx = pts.reduce((a, p) => a + p.x, 0) / n;
      const my = pts.reduce((a, p) => a + p.y, 0) / n;
      const slope = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
      expect((slope / 1000 - 1) * 1e6).toBeCloseTo(ppm, -1);
    }
  });

  it("lets the phone align left and right to well inside 10 ms with a clock fit per side", () => {
    const start = { left: 123_456_789, right: 3_000_000_000 };
    const drift = { left: 20, right: -15 };
    const t = twin({ driftPpm: drift, clockStartUs: start });
    const { frames, arrivals } = listen(t);
    t.tick(60_000);
    let jitter = 12345;
    const latency = () => {
      jitter = (Math.imul(jitter, 1103515245) + 12345) >>> 0;
      return 4 + (jitter / 2 ** 32) * 30;
    };
    let worst = 0;
    for (const side of ["left", "right"] as const) {
      const sync = new ClockSync();
      const unwrap = new ClockUnwrap();
      frames[side].forEach((f, i) => {
        if (f.type !== "eeg") return;
        const last = unwrap.push(f.timestamp) + (f.samples - 1) * 4000;
        sync.observe(last, arrivals[side][i] + latency());
        // Truth: the simulated time this sample was taken.
        const truth = (last - start[side]) / (1000 * (1 + drift[side] * 1e-6));
        if (arrivals[side][i] > 15_000) worst = Math.max(worst, Math.abs(sync.toHost(last) - truth - 4));
      });
      expect(Math.abs(sync.driftPpm - drift[side])).toBeLessThan(10);
    }
    expect(worst).toBeLessThan(1.5);
  });

  it("loses frames on purpose, and the phone puts NaN exactly where they were", () => {
    const rec = recording();
    const t = twin({ loss: 0.05, seed: 3 });
    const { frames, decoders } = listen(t);
    t.tick(10_000);
    for (const [side, chans] of [["left", PAIR.left], ["right", PAIR.right]] as const) {
      expect(decoders[side].stats.gaps).toBeGreaterThan(0);
      const stream = new EegStream(FS, 4, NV);
      let nan = 0;
      let placed = 0;
      for (const f of eegOf(frames[side])) {
        const chunk = stream.push(f)!;
        nan += chunk.missing;
        chunk.data.forEach((d, j) => {
          d.forEach((v, i) => {
            if (Number.isNaN(v)) return;
            placed++;
            const k = (chunk.index + i) % rec.data[chans[j]].length;
            expect(Math.abs(v - rec.data[chans[j]][k])).toBeLessThanOrEqual(LSB_UV);
          });
        });
      }
      expect(nan).toBeGreaterThan(0);
      expect(nan % 18).toBe(0);
      expect(placed / 4 + nan).toBe(stream.length);
    }
  });

  it("obeys host commands: steer, hello, stop, start and a new rate", () => {
    const t = twin();
    const { frames } = listen(t);
    t.tick(200);
    t.command("left", encodeCommand({ op: "steer", azimuthDeg: -30.5, gainDb: 6 }, { side: "left" }));
    expect(t.steering("left")).toEqual({ azimuthDeg: -30.5, gainDb: 6 });
    expect(t.steering("right")).toBeNull();
    // A command addressed to the other side is ignored, as the firmware does.
    t.command("right", encodeCommand({ op: "steer", azimuthDeg: 10, gainDb: 3 }, { side: "left" }));
    expect(t.steering("right")).toBeNull();

    t.command("right", encodeCommand({ op: "stop" }));
    const before = frames.right.length;
    t.tick(500);
    expect(frames.right.length).toBe(before);
    t.command("right", encodeCommand({ op: "start" }));
    expect(frames.right[before]).toMatchObject({ type: "hello", seq: 0, flags: Flag.streamStart | Flag.simulated });

    t.command("left", encodeCommand({ op: "setEegRate", rate: 500 }));
    const hello = frames.left[frames.left.length - 1] as HelloFrame;
    expect(hello).toMatchObject({ type: "hello", eegRate: 500, flags: Flag.streamStart | Flag.simulated });
    const from = frames.left.length;
    t.tick(1000);
    const n = eegOf(frames.left.slice(from)).reduce((a, f) => a + f.samples, 0);
    expect(n).toBeGreaterThan(500 - 18);
    t.command("left", encodeCommand({ op: "hello" }));
    expect(frames.left[frames.left.length - 1]).toMatchObject({ type: "hello", flags: Flag.simulated });
  });

  it("gives each earbud its own muscle noise, also after a rate change", () => {
    const rec = recording(4, 0);
    const t = twin({ recording: rec });
    const { frames } = listen(t);
    t.command("single", encodeCommand({ op: "setEegRate", rate: 500 }));
    const from = { left: frames.left.length, right: frames.right.length };
    t.clench("hold");
    t.tick(1000);
    const burst = (side: "left" | "right") => channel(eegOf(frames[side].slice(from[side])), 0).slice(20, 200);
    const l = burst("left");
    const r = burst("right");
    expect(rms(l)).toBeGreaterThan(20);
    expect(l.filter((v, i) => v === r[i]).length).toBeLessThan(5);
  });

  it("sends speech envelopes from the left earbud and a battery event every 10 s", () => {
    const env = [0, 1].map((k) => Float32Array.from({ length: 4 * 64 }, (_, i) => 1 + Math.sin(i / (5 + k))));
    const t = twin({ audio: { azimuths: [-30, 45.5], data: env } });
    const { frames } = listen(t);
    t.tick(25_000);
    const audio = frames.left.filter((f) => f.type === "audioEnv");
    expect(audio.length).toBeGreaterThan(95);
    expect(audio[0]).toMatchObject({ talkers: 2, samples: 16, azimuths: [-30, 45.5] });
    expect(frames.right.some((f) => f.type === "audioEnv")).toBe(false);
    for (const side of ["left", "right"] as const) {
      const battery = frames[side].filter((f) => f.type === "event" && f.code === EventCode.battery);
      expect(battery.length).toBe(2);
    }
  });

  it("drops what it cannot send when its timers stall, and says so on the next frame", () => {
    let wall = 0;
    let pump: () => void = () => {};
    const clock: TwinClock = {
      now: () => wall,
      every: (_ms, fn) => {
        pump = fn;
        return () => {};
      },
    };
    const t = twin({ clock });
    const { frames, decoders } = listen(t);
    wall = 100;
    pump();
    wall = 3100;
    pump();
    expect(t.time).toBe(3100);
    const flagged = frames.left.filter((f) => f.flags & Flag.deviceDrop);
    expect(flagged.length).toBe(1);
    expect(decoders.left.stats.gaps).toBe(1);
    expect(decoders.left.stats.lost).toBeGreaterThan(30);
  });

  it("pairs the ears by time when they start apart and their clocks drift", () => {
    // Channel 0 of each ear sees the same signal, so their lag can be measured.
    const n = 20 * FS;
    const f = [3.1, 7.3, 11.7, 17.9];
    const shared = Float32Array.from({ length: n }, (_, i) => f.reduce((a, hz, k) => a + 10 * Math.sin((2 * Math.PI * hz * i) / FS + k), 0));
    const rec: TwinRecording = { fs: FS, labels: recording().labels, data: recording(20).data.map((d, c) => (c === 0 || c === 4 ? shared : d)) };
    const t = twin({ recording: rec, driftPpm: { left: 500, right: -500 }, clockStartUs: { left: 1e9, right: 4.2e9 } });
    const decoders = { left: new SspDecoder(), right: new SspDecoder() };
    const streams: Partial<Record<"left" | "right", EegStream>> = {};
    const syncs = { left: new ClockSync(), right: new ClockSync() };
    const aligner = new EarAligner(FS, [4, 4]);
    let jitter = 99;
    t.start((bytes, side) => {
      const ear = side as "left" | "right";
      for (const fr of decoders[ear].push(bytes)) {
        if (fr.type === "hello" && fr.flags & Flag.streamStart) streams[ear] = new EegStream(fr.eegRate, 4, fr.nvPerLsb);
        if (fr.type !== "eeg") continue;
        const chunk = streams[ear]!.push(fr)!;
        jitter = (Math.imul(jitter, 1103515245) + 12345) >>> 0;
        syncs[ear].observe(chunk.time + (chunk.data[0].length - 1) * 4000, t.time + 4 + (jitter / 2 ** 32) * 30);
        aligner.push(ear, syncs[ear].toHost(chunk.time), chunk.data);
      }
    });
    t.command("right", encodeCommand({ op: "stop" }));
    t.tick(5000);
    t.command("right", encodeCommand({ op: "start" }));
    t.tick(115_000);
    const pairs = aligner.pull();

    const both = pairs.filter((p) => !Number.isNaN(p.values[0]) && !Number.isNaN(p.values[4]));
    const leftOnly = pairs.filter((p) => p.time < 4900);
    expect(leftOnly.every((p) => Number.isNaN(p.values[4]))).toBe(true);
    expect(leftOnly.length).toBeGreaterThan(4.8 * FS);
    // After the right ear's clock fit has settled, the slips that drift forces are rare.
    const late = pairs.filter((p) => p.time > 30_000);
    expect(late.filter((p) => Number.isNaN(p.values[0]) || Number.isNaN(p.values[4])).length / late.length).toBeLessThan(0.02);

    /** The lag, in samples, at which the right ear's channel 0 best matches the left's, over 10 s from `from`. */
    const lagAt = (from: number) => {
      const w = both.filter((p) => p.time >= from && p.time < from + 10_000);
      let best = 0;
      let bestErr = Infinity;
      for (let lag = -20; lag <= 20; lag++) {
        let err = 0;
        for (let k = 20; k < w.length - 20; k++) err += (w[k].values[0] - w[k + lag].values[4]) ** 2;
        if (err < bestErr) {
          bestErr = err;
          best = lag;
        }
      }
      return best;
    };
    // Pairing by count would be 1250 samples off from the start and drift a further 30.
    expect([lagAt(30_000), lagAt(60_000), lagAt(105_000)]).toEqual([0, 0, 0]);
  });
});
