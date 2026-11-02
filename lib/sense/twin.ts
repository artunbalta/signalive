/**
 * A digital twin of the earbuds. It plays a recording through exactly the
 * frames the hardware will send (SSP v0, lib/sense/protocol.ts), so the whole
 * phone side, transports, decoder, clench detector, steering, runs and is
 * tested before any hardware exists.
 *
 * It behaves like the hardware where the phone can tell the difference. Each
 * earbud is its own device with its own clock, which drifts (20 and -15 ppm
 * by default) and wraps every 71.6 minutes, and each samples the recording
 * at its own clock's instants, so left and right drift apart in content
 * exactly as real earbuds would, and only a phone that aligns them by time
 * keeps them together. Frames are as large as the MTU allows, numbered per
 * earbud, and can be lost on purpose. A clench adds jaw muscle activity to
 * every electrode of both earbuds; a head turn moves the IMU's quaternion and
 * gyro together. Host commands (start, stop, rate, steer, hello) are obeyed.
 *
 * Time is simulated: tick(ms) advances it and delivers everything due, in
 * time order, so tests run without real timers. Given the same seed and the
 * same calls at the same simulated times, the bytes are identical however
 * the time is chopped into ticks. Every frame carries the simulated flag, so
 * twin data can never pass for a recording from hardware.
 */
import {
  ADS1299_NV_PER_LSB,
  BLE_MTU,
  ENV_RATE,
  EventCode,
  Flag,
  QUAT_ONE,
  clampInt24,
  decodeCommand,
  encodeFrame,
  maxEegSamples,
  maxEnvSamples,
  maxImuSamples,
  yawQuat,
  type FrameBody,
  type HostCommand,
  type Side,
  type SspFrame,
} from "./protocol";

/** Per channel microvolts at fs. */
export interface TwinRecording {
  fs: number;
  labels: string[];
  data: Float32Array[];
}

export interface TwinClock {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Calls fn every ms milliseconds until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
}

export const realClock: TwinClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

/** Never ticks by itself: whoever holds the twin drives it with tick(). */
export const manualClock: TwinClock = { now: () => 0, every: () => () => {} };

export type ClenchKind = "single" | "double" | "hold";

export interface TwinOptions {
  recording: TwinRecording;
  /** Recording channel indexes per earbud. Left out: one device carrying every channel. */
  sides?: { left: number[]; right: number[] } | { single: number[] };
  /** ADC nanovolts per count. Default: an ADS1299 class front end at gain 24, about 22.35. */
  nvPerLsb?: number;
  /** IMU samples per second; 0 for none. Default 100. */
  imuRate?: number;
  /** The emulated ADC's rate. Default: the recording's own; otherwise the recording is interpolated. */
  eegRate?: number;
  seed?: number;
  /** Clock error in ppm, for every side or per side. Default left +20, right -15, single +20. */
  driftPpm?: number | Partial<Record<Side, number>>;
  /** Each device clock's reading at simulated time 0, microseconds. Default: seeded. */
  clockStartUs?: Partial<Record<Side, number>>;
  /** ATT MTU; frames are sized to fit one notification. Default 247. */
  mtu?: number;
  /** IMU samples per frame. Default 5, 50 ms at 100 Hz. */
  imuPerFrame?: number;
  /** Speech envelopes at 64 Hz, any scale, sent as AUDIO_ENV by the left earbud (or the single device). Give them the recording's duration so the two loop together. */
  audio?: { azimuths: number[]; data: Float32Array[] };
  /** Chance that any one frame never reaches the phone. Default 0. */
  loss?: number;
  /** Default: real timers. Tests pass manualClock and call tick(). */
  clock?: TwinClock;
  /** How often real timers advance the twin, ms. Default 15. */
  intervalMs?: number;
}

/** Jaw muscle activity: band limited noise of this RMS, on every channel. */
const EMG_RMS_UV = 40;
const EMG_BAND: [number, number] = [30, 150];
const RAMP_MS = 10;
/** How fast the emulated head turns toward a new yaw. */
const TURN_DEG_PER_S = 200;
const BATTERY_EVERY_US = 10e6;
const ENV_PER_FRAME = 16;
/** When the twin's timers stall longer than this (a background tab), the earbuds drop what they could not send. */
const MAX_CATCH_UP_MS = 1000;

/* ---- Seeded randomness --------------------------------------------------- */

function mix(a: number, b: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: small, fast, and the same everywhere. */
function uniform(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(u: () => number) {
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

/* ---- Jaw EMG ------------------------------------------------------------- */

type Biquad = [number, number, number, number, number];

/** RBJ cookbook high or low pass, normalised: b0, b1, b2, a1, a2. */
function biquad(kind: "hp" | "lp", f: number, q: number, fs: number): Biquad {
  const w = (2 * Math.PI * f) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b = kind === "lp" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - alpha) / a0];
}

/** Second order sections in direct form II transposed; z holds two states per section. */
function runSections(design: Biquad[], z: Float64Array, x: number) {
  for (let s = 0; s < design.length; s++) {
    const [b0, b1, b2, a1, a2] = design[s];
    const y = b0 * x + z[2 * s];
    z[2 * s] = b1 * x - a1 * y + z[2 * s + 1];
    z[2 * s + 1] = b2 * x - a2 * y;
    x = y;
  }
  return x;
}

interface EmgBand {
  sections: Biquad[];
  /** Input noise level that gives EMG_RMS_UV at the output. */
  scale: number;
}

/**
 * The EMG band at this rate: a fourth order high pass at 30 Hz and a second
 * order low pass at 150 Hz, or just under Nyquist when the rate is low; and
 * the noise level that comes out at EMG_RMS_UV, from the band's impulse
 * response energy.
 */
function emgBand(fs: number): EmgBand {
  const hi = Math.min(EMG_BAND[1], 0.45 * fs);
  const lo = Math.min(EMG_BAND[0], 0.5 * hi);
  const sections = [biquad("hp", lo, 0.5412, fs), biquad("hp", lo, 1.3066, fs), biquad("lp", hi, Math.SQRT1_2, fs)];
  const z = new Float64Array(sections.length * 2);
  let energy = 0;
  for (let i = 0; i < 4 * fs; i++) energy += runSections(sections, z, i === 0 ? 1 : 0) ** 2;
  return { sections, scale: EMG_RMS_UV / Math.sqrt(energy) };
}

/** One channel's EMG: white noise through the band, always running so it is settled when a burst starts. */
class EmgSource {
  private readonly z: Float64Array;
  private readonly noise: () => number;

  constructor(
    private readonly band: EmgBand,
    seed: number,
  ) {
    this.z = new Float64Array(band.sections.length * 2);
    this.noise = gaussian(uniform(seed));
  }

  next(): number {
    return runSections(this.band.sections, this.z, this.noise() * this.band.scale);
  }
}

/** Bursts in simulated milliseconds, with raised cosine ramps. */
function burstLevel(bursts: { start: number; end: number }[], t: number) {
  let level = 0;
  for (const b of bursts) {
    if (t < b.start || t > b.end) continue;
    const edge = Math.min(t - b.start, b.end - t, RAMP_MS) / RAMP_MS;
    level = Math.max(level, 0.5 - 0.5 * Math.cos(Math.PI * edge));
  }
  return level;
}

/* ---- One earbud ---------------------------------------------------------- */

/** A sampled stream on one earbud's clock: sample k is at e0 + k * period device microseconds. */
interface Schedule {
  e0: number;
  period: number;
  k: number;
}

interface Earbud {
  side: Side;
  /** This earbud's own seed, so no two earbuds ever share noise. */
  seed: number;
  channels: number[];
  labels: string[];
  /** Device clock rate: device microseconds per simulated microsecond. */
  rate: number;
  clock0: number;
  deviceId: string;
  seq: number;
  streaming: boolean;
  /** The earbud dropped frames it could not send; the next frame says so. */
  dropped: boolean;
  fs: number;
  eeg: Schedule;
  eegFirst: number;
  eegCounts: Int32Array;
  eegCount: number;
  maxEeg: number;
  emg: EmgSource[];
  imu: Schedule | null;
  imuValues: Int16Array;
  imuCount: number;
  imuFirst: number;
  imuNoise: () => number;
  env: Schedule | null;
  envValues: Uint16Array;
  envCount: number;
  envFirst: number;
  batteryAt: number;
  battery0: number;
  lossDraw: () => number;
  steer: { azimuthDeg: number; gainDb: number } | null;
}

type Due = { bud: Earbud; kind: 0 | 1 | 2 | 3; t: number };

const DEFAULT_DRIFT: Record<Side, number> = { left: 20, right: -15, single: 20 };

export class DigitalTwin {
  private readonly rec: TwinRecording;
  private readonly buds: Earbud[];
  private readonly nv: number;
  private readonly imuRate: number;
  private readonly mtu: number;
  private readonly imuPerFrame: number;
  private readonly audio: { azimuths: number[]; data: Float32Array[]; scale: number } | null;
  private readonly loss: number;
  private readonly clock: TwinClock;
  private readonly intervalMs: number;
  private readonly seed: number;
  private onBytes: ((bytes: Uint8Array, side: Side) => void) | null = null;
  private stopTimer: (() => void) | null = null;
  private lastWall = 0;
  private now = 0;
  private bursts: { start: number; end: number }[] = [];
  private head = { from: 0, delta: 0, t0: 0 };
  /** False while advancing through a stall: frames are made, numbered and dropped. */
  private deliver = true;

  constructor(opts: TwinOptions) {
    const rec = opts.recording;
    if (!(rec.fs > 0) || rec.data.length === 0 || rec.data.some((d) => d.length < 2)) {
      throw new RangeError("twin: a recording needs a rate and at least two samples per channel");
    }
    this.rec = rec;
    this.seed = (opts.seed ?? 1) >>> 0;
    this.nv = Math.fround(opts.nvPerLsb ?? ADS1299_NV_PER_LSB);
    this.imuRate = Math.round(opts.imuRate ?? 100);
    this.mtu = opts.mtu ?? BLE_MTU;
    this.imuPerFrame = Math.max(1, Math.min(opts.imuPerFrame ?? 5, maxImuSamples(this.mtu)));
    this.loss = opts.loss ?? 0;
    this.clock = opts.clock ?? realClock;
    this.intervalMs = opts.intervalMs ?? 15;
    const fs = Math.round(opts.eegRate ?? rec.fs);
    if (fs < 1 || fs > 0xffff) throw new RangeError(`twin: EEG rate ${fs} does not fit the protocol`);

    if (opts.audio) {
      let peak = 0;
      for (const d of opts.audio.data) for (const v of d) peak = Math.max(peak, v);
      this.audio = { ...opts.audio, scale: peak > 0 ? 65535 / peak : 0 };
    } else {
      this.audio = null;
    }

    const layout: [Side, number[]][] = !opts.sides
      ? [["single", rec.data.map((_, i) => i)]]
      : "single" in opts.sides
        ? [["single", opts.sides.single]]
        : [
            ["left", opts.sides.left],
            ["right", opts.sides.right],
          ];
    this.buds = layout.map(([side, channels], n) => this.makeBud(side, channels, n, fs, opts));
  }

  private makeBud(side: Side, channels: number[], n: number, fs: number, opts: TwinOptions): Earbud {
    const c = channels.length;
    const maxEeg = maxEegSamples(c, this.mtu);
    if (maxEeg < 1) throw new RangeError(`twin: ${c} channels do not fit a frame at MTU ${this.mtu}`);
    for (const i of channels) if (!this.rec.data[i]) throw new RangeError(`twin: no recording channel ${i}`);
    const drift = typeof opts.driftPpm === "number" ? opts.driftPpm : (opts.driftPpm?.[side] ?? DEFAULT_DRIFT[side]);
    const s = mix(this.seed, n + 1);
    const band = emgBand(fs);
    const talkers = this.audio?.azimuths.length ?? 0;
    const sendsAudio = talkers > 0 && side !== "right";
    const envPer = sendsAudio ? Math.min(ENV_PER_FRAME, maxEnvSamples(talkers, this.mtu)) : 0;
    return {
      side,
      seed: s,
      channels,
      labels: channels.map((i) => (this.rec.labels[i] ?? `${i + 1}`).slice(0, 4)),
      rate: 1 + drift * 1e-6,
      clock0: opts.clockStartUs?.[side] ?? Math.floor(mix(s, 7) * 0.9),
      deviceId: "7477696e" + mix(s, 11).toString(16).padStart(8, "0"),
      seq: 0,
      streaming: false,
      dropped: false,
      fs,
      eeg: { e0: 0, period: 1e6 / fs, k: 0 },
      eegFirst: 0,
      eegCounts: new Int32Array(maxEeg * c),
      eegCount: 0,
      maxEeg,
      emg: channels.map((_, j) => new EmgSource(band, mix(s, 100 + j))),
      imu: this.imuRate > 0 ? { e0: 0, period: 1e6 / this.imuRate, k: 0 } : null,
      imuValues: new Int16Array(this.imuPerFrame * 10),
      imuCount: 0,
      imuFirst: 0,
      imuNoise: gaussian(uniform(mix(s, 13))),
      env: sendsAudio && envPer > 0 ? { e0: 0, period: 1e6 / ENV_RATE, k: 0 } : null,
      envValues: new Uint16Array(Math.max(envPer, 1) * Math.max(talkers, 1)),
      envCount: 0,
      envFirst: 0,
      batteryAt: 0,
      battery0: side === "right" ? 91 : 88,
      lossDraw: uniform(mix(s, 17)),
      steer: null,
    };
  }

  /** Simulated milliseconds since the twin was made. */
  get time(): number {
    return this.now;
  }

  get sides(): Side[] {
    return this.buds.map((b) => b.side);
  }

  /** Powers the earbuds' streams on: each sends HELLO and a wear event, then streams. */
  start(onBytes: (bytes: Uint8Array, side: Side) => void): void {
    this.stop();
    this.onBytes = onBytes;
    for (const bud of this.buds) this.startStream(bud);
    this.lastWall = this.clock.now();
    this.stopTimer = this.clock.every(this.intervalMs, () => this.pump());
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.onBytes = null;
    for (const bud of this.buds) bud.streaming = false;
  }

  /** Advances simulated time and delivers every frame that falls due, in time order. */
  tick(ms: number): void {
    if (this.onBytes && ms > 0) this.advance(this.now + ms, true);
  }

  /** The head turns, at a head's pace, toward this yaw: degrees, positive to the right. */
  setYaw(deg: number): void {
    const from = this.yawAt(this.now);
    this.head = { from, delta: wrap180(deg - from), t0: this.now };
  }

  /** The head's yaw now, degrees. */
  get yaw(): number {
    return this.yawAt(this.now);
  }

  /**
   * Jaw muscle activity on every channel of every earbud, starting now:
   * single, one 200 ms burst; double, two 150 ms bursts with 250 ms between
   * them; hold, 1.2 s.
   */
  clench(kind: ClenchKind): void {
    const t = this.now;
    this.bursts = this.bursts.filter((b) => b.end > t - 1000);
    if (kind === "single") this.bursts.push({ start: t, end: t + 200 });
    else if (kind === "double") this.bursts.push({ start: t, end: t + 150 }, { start: t + 400, end: t + 550 });
    else this.bursts.push({ start: t, end: t + 1200 });
  }

  /** The last STEER an earbud obeyed. */
  steering(side: Side): { azimuthDeg: number; gainDb: number } | null {
    return this.buds.find((b) => b.side === side)?.steer ?? null;
  }

  /** A command frame written to one earbud ("single" reaches every earbud; a single device takes writes for any side). */
  command(side: Side, bytes: Uint8Array): void {
    const f = decodeCommand(bytes);
    if (!f) return;
    for (const bud of this.buds) {
      const reached = side === "single" || bud.side === "single" || side === bud.side;
      const addressed = f.side === "single" || f.side === bud.side;
      if (reached && addressed) this.obey(bud, f.command);
    }
  }

  private obey(bud: Earbud, c: HostCommand) {
    if (!this.onBytes) return;
    switch (c.op) {
      case "start":
        if (!bud.streaming) this.startStream(bud);
        break;
      case "stop":
        bud.streaming = false;
        break;
      case "setEegRate":
        if (c.rate >= 1 && c.rate !== bud.fs) {
          bud.fs = c.rate;
          const band = emgBand(c.rate);
          bud.emg = bud.channels.map((_, j) => new EmgSource(band, mix(mix(bud.seed, c.rate), 100 + j)));
          // The EEG timeline restarts, so the answering HELLO says so.
          if (bud.streaming) this.startStream(bud, false);
          else this.sendHello(bud, 0);
        } else {
          this.sendHello(bud, 0);
        }
        break;
      case "steer":
        bud.steer = { azimuthDeg: c.azimuthDeg, gainDb: c.gainDb };
        break;
      case "hello":
        this.sendHello(bud, 0);
        break;
    }
  }

  /** Real timers: catch up with the wall clock; a long stall is dropped, as earbuds with a full queue would. */
  private pump() {
    const wall = this.clock.now();
    const dt = wall - this.lastWall;
    this.lastWall = wall;
    if (!this.onBytes || dt <= 0) return;
    if (dt > MAX_CATCH_UP_MS) this.advance(this.now + dt - MAX_CATCH_UP_MS, false);
    this.advance(this.now + Math.min(dt, MAX_CATCH_UP_MS), true);
  }

  /* ---- Simulation -------------------------------------------------------- */

  private devUs(bud: Earbud, ms: number) {
    return bud.clock0 + ms * 1000 * bud.rate;
  }

  private simMs(bud: Earbud, us: number) {
    return (us - bud.clock0) / (1000 * bud.rate);
  }

  private startStream(bud: Earbud, resetSeq = true) {
    const e0 = Math.round(this.devUs(bud, this.now));
    bud.streaming = true;
    if (resetSeq) bud.seq = 0;
    bud.eeg = { e0, period: 1e6 / bud.fs, k: 0 };
    bud.eegCount = 0;
    bud.maxEeg = maxEegSamples(bud.channels.length, this.mtu);
    if (bud.imu) bud.imu = { e0, period: bud.imu.period, k: 0 };
    bud.imuCount = 0;
    if (bud.env) bud.env = { e0, period: bud.env.period, k: 0 };
    bud.envCount = 0;
    bud.batteryAt = e0 + BATTERY_EVERY_US;
    this.sendHello(bud, Flag.streamStart);
    if (resetSeq) this.send(bud, { type: "event", code: EventCode.wear, value: 1 }, e0);
  }

  private sendHello(bud: Earbud, flags: number) {
    const t = Math.round(this.devUs(bud, this.now));
    this.send(
      bud,
      {
        type: "hello",
        firmware: [0, 1, 0],
        deviceId: bud.deviceId,
        labels: bud.labels,
        eegRate: bud.fs,
        nvPerLsb: this.nv,
        imuRate: this.imuRate,
        battery: this.battery(bud, t),
      },
      t,
      flags,
    );
  }

  /** Battery percent at a device time: about 1% every 6 minutes from where it started. */
  private battery(bud: Earbud, us: number) {
    return Math.max(5, bud.battery0 - Math.floor(Math.max(0, us - bud.clock0) / 360e6));
  }

  /** Every event of every earbud up to `to`, earliest first; ties go left, right, single, then EEG, IMU, audio, battery. */
  private advance(to: number, deliver: boolean) {
    for (;;) {
      let due: Due | null = null;
      for (const bud of this.buds) {
        if (!bud.streaming) continue;
        const cands: [Due["kind"], number][] = [[0, this.at(bud, bud.eeg)]];
        if (bud.imu) cands.push([1, this.at(bud, bud.imu)]);
        if (bud.env) cands.push([2, this.at(bud, bud.env)]);
        cands.push([3, this.simMs(bud, bud.batteryAt)]);
        for (const [kind, t] of cands) if (t <= to && (!due || t < due.t)) due = { bud, kind, t };
      }
      if (!due) break;
      this.now = Math.max(this.now, due.t);
      this.deliver = deliver;
      if (due.kind === 0) this.eegSample(due.bud, due.t);
      else if (due.kind === 1) this.imuSample(due.bud, due.t);
      else if (due.kind === 2) this.envSample(due.bud, due.t);
      else this.batteryEvent(due.bud);
    }
    this.now = Math.max(this.now, to);
    this.deliver = true;
  }

  private at(bud: Earbud, s: Schedule) {
    return this.simMs(bud, s.e0 + s.k * s.period);
  }

  /** The recording at simulated time t, interpolated, looped. */
  private recordingAt(ch: number, t: number) {
    const d = this.rec.data[ch];
    const x = (t * this.rec.fs) / 1000;
    const i = Math.floor(x);
    const f = x - i;
    const n = d.length;
    const a = d[((i % n) + n) % n];
    return f === 0 ? a : a + (d[(((i + 1) % n) + n) % n] - a) * f;
  }

  private eegSample(bud: Earbud, t: number) {
    const c = bud.channels.length;
    if (bud.eegCount === 0) bud.eegFirst = bud.eeg.k;
    const level = burstLevel(this.bursts, t);
    const toCounts = 1000 / this.nv;
    for (let j = 0; j < c; j++) {
      const emg = bud.emg[j].next();
      const uv = this.recordingAt(bud.channels[j], t) + level * emg;
      bud.eegCounts[bud.eegCount * c + j] = clampInt24(Math.round(uv * toCounts));
    }
    bud.eeg.k++;
    if (++bud.eegCount === bud.maxEeg) {
      this.send(
        bud,
        { type: "eeg", channels: c, samples: bud.maxEeg, counts: bud.eegCounts.slice() },
        bud.eeg.e0 + bud.eegFirst * bud.eeg.period,
      );
      bud.eegCount = 0;
    }
  }

  private yawAt(t: number) {
    const h = this.head;
    const turned = Math.min(Math.abs(h.delta), (TURN_DEG_PER_S * Math.max(0, t - h.t0)) / 1000);
    return wrap180(h.from + Math.sign(h.delta) * turned);
  }

  private turnRate(t: number) {
    const h = this.head;
    const turned = (TURN_DEG_PER_S * Math.max(0, t - h.t0)) / 1000;
    return t >= h.t0 && turned < Math.abs(h.delta) ? Math.sign(h.delta) * TURN_DEG_PER_S : 0;
  }

  private imuSample(bud: Earbud, t: number) {
    const s = bud.imu!;
    if (bud.imuCount === 0) bud.imuFirst = s.k;
    const q = yawQuat(this.yawAt(t));
    const noise = bud.imuNoise;
    const o = bud.imuCount * 10;
    const v = bud.imuValues;
    v[o] = Math.round(noise() * 3);
    v[o + 1] = Math.round(noise() * 3);
    v[o + 2] = -1000 + Math.round(noise() * 3);
    v[o + 3] = Math.round(noise() * 2);
    v[o + 4] = Math.round(noise() * 2);
    v[o + 5] = Math.round(this.turnRate(t) * 10);
    for (let k = 0; k < 4; k++) v[o + 6 + k] = Math.round(q[k] * QUAT_ONE);
    s.k++;
    if (++bud.imuCount === this.imuPerFrame) {
      this.send(bud, { type: "imu", samples: this.imuPerFrame, values: v.slice() }, s.e0 + bud.imuFirst * s.period);
      bud.imuCount = 0;
    }
  }

  private envSample(bud: Earbud, t: number) {
    const s = bud.env!;
    const a = this.audio!;
    const k = a.azimuths.length;
    const per = bud.envValues.length / k;
    if (bud.envCount === 0) bud.envFirst = s.k;
    const x = (t * ENV_RATE) / 1000;
    for (let i = 0; i < k; i++) {
      const d = a.data[i];
      const n = d.length;
      const j = Math.floor(x);
      const f = x - j;
      const v0 = d[((j % n) + n) % n];
      const v = v0 + (d[(((j + 1) % n) + n) % n] - v0) * f;
      bud.envValues[bud.envCount * k + i] = Math.max(0, Math.min(65535, Math.round(v * a.scale)));
    }
    s.k++;
    if (++bud.envCount === per) {
      this.send(
        bud,
        { type: "audioEnv", samples: per, talkers: k, azimuths: a.azimuths, envelopes: bud.envValues.slice() },
        s.e0 + bud.envFirst * s.period,
      );
      bud.envCount = 0;
    }
  }

  private batteryEvent(bud: Earbud) {
    const t = bud.batteryAt;
    bud.batteryAt += BATTERY_EVERY_US;
    this.send(bud, { type: "event", code: EventCode.battery, value: this.battery(bud, t) }, t);
  }

  /** Numbers, flags and encodes a frame, then delivers it, or loses or drops it. */
  private send(bud: Earbud, body: FrameBody, deviceUs: number, flags = 0) {
    const seq = bud.seq;
    bud.seq = (bud.seq + 1) & 0xffff;
    if (!this.deliver) {
      bud.dropped = true;
      return;
    }
    if (this.loss > 0 && bud.lossDraw() < this.loss) return;
    let f = flags | Flag.simulated;
    if (bud.dropped) {
      f |= Flag.deviceDrop;
      bud.dropped = false;
    }
    const frame = { ...body, side: bud.side, seq, timestamp: Math.floor(deviceUs) % 2 ** 32, flags: f } as SspFrame;
    this.onBytes?.(encodeFrame(frame), bud.side);
  }
}

function wrap180(deg: number) {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}
