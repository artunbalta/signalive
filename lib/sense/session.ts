/**
 * The phone side of a pair of earbuds, from bytes to decisions. Feed it what
 * a Transport delivers (SSP bytes, tagged with the earbud they came from) and
 * it decodes the frames, places every sample on one timeline, runs the
 * clench detector and, when the earbuds send the voices' envelopes and a
 * decoder model is given, the attention decoder; it fuses that with the head
 * direction from the motion sensors and writes the STEER command that tells
 * the earbuds which voice to bring forward.
 *
 * One timeline, on the phone's clock. Each earbud's samples are mapped there
 * through that earbud's ClockSync, and read out on a fixed grid at the EEG
 * rate: tick k is time t0 + k / fs, and takes from each ear the sample
 * nearest to it, or NaN. The voices' envelopes go onto the same timeline at
 * their own rate. So the decoder's sample k is always the same moment for EEG
 * and envelopes, whatever the radio does: an earbud that joins late, stalls
 * and then delivers a backlog, drops out, restarts its clock, or both earbuds
 * sending envelopes at once. A late sample for a moment already read out is
 * simply too late, and is dropped.
 *
 * It does not care where the bytes come from: the digital twin, an OpenBCI
 * board and the earbuds themselves all produce SSP, which is the point.
 */
import { ClenchDetector, type ClenchEvent } from "./clench";
import { AttentionDecoder, type DecoderModel } from "./decoder";
import { fuseAttention } from "./fusion";
import { ClockSync, ClockUnwrap, EegStream, EventCode, Flag, QUAT_ONE, SspDecoder, encodeCommand, yawDeg, type EegFrame, type Side, type SspFrame } from "./protocol";

export type Ear = "left" | "right";

/** Which ears the clench detector is listening to. */
export type ClenchMode = "both" | "left" | "right";

export interface SessionOptions {
  /** The electrode sample rate the earbuds stream at, Hz. A HELLO that says otherwise before any EEG wins. */
  fs: number;
  /** Electrodes per earbud, in the order each earbud sends them. */
  perEar: number;
  /** An attention decoder; it needs the earbuds' AUDIO_ENV frames as well, and EEG at its fsRaw. */
  model?: DecoderModel;
  /** Where the voices are in the room, degrees, 0 ahead and positive to the right. */
  azimuths?: number[];
  /** Milliseconds, the phone's clock. Default performance.now. */
  now?: () => number;
}

export interface EarStats {
  frames: number;
  lost: number;
  /** EEG samples a second over the last two seconds. */
  rate: number;
  /** The earbud's clock against the phone's, parts per million; null until the fit has enough time. */
  driftPpm: number | null;
  battery: number | null;
  /** Bit i set while electrode i has lost contact. */
  leadOff: number;
}

export interface SessionSnapshot {
  ears: Record<Ear, EarStats>;
  /** Head yaw from the motion sensors, degrees, positive to the right; null when none has reported lately. */
  yaw: number | null;
  /** The decoder's verdict over the last 10 seconds, when there is one. */
  eeg: { talker: number; margin: number } | null;
  /** Probability per voice that it is the attended one, head and EEG together. */
  posterior: number[];
  /** Which ears clench detection uses now; null before it has decided. */
  clench: ClenchMode | null;
  /** Something the session cannot do with what the earbuds sent, in words; null when all is well. */
  warning: string | null;
}

/** Seconds of EEG and envelope behind each attention verdict. */
const DECIDE_S = 10;
/** An ear with no sample for a moment is waited for this long before the other goes on alone. */
const WAIT_MS = 500;
/** Coverage is judged over this much of the timeline. */
const COVERAGE_S = 2;
/** An ear with signal on at least this share of the recent timeline is present... */
const PRESENT = 0.5;
/** ...and with at most this share, gone: the clench is handed to the other ear alone. */
const GONE = 0.1;
/** A run of missing samples longer than this pauses the clench detector rather than teaching it a flat floor. */
const BRIDGE_S = 0.25;
/** One ear alone needs more margin: no other side can veto a touch on that earbud. */
const ONE_EAR_K = 5;
/** Yaw older than this is from an earbud that has gone. */
const YAW_STALE_MS = 500;
/** How far the envelope timeline may be padded in one go; past it, the decoder starts over. */
const MAX_PAD_S = 60;
const RATE_WINDOW_MS = 2000;

/** One ear's samples on the phone's clock, waiting to be read out on the grid. */
class EarQueue {
  private times: number[] = [];
  private values: Float32Array[] = [];
  /** Index of the first sample still waiting; the arrays are compacted now and then, not per sample. */
  private start = 0;
  get length() {
    return this.times.length - this.start;
  }
  time(i: number) {
    return this.times[this.start + i];
  }
  value(i: number) {
    return this.values[this.start + i];
  }
  push(t: number, v: Float32Array) {
    this.times.push(t);
    this.values.push(v);
  }
  shift(n: number) {
    this.start += n;
    if (this.start > 4096 && this.start * 2 > this.times.length) {
      this.times = this.times.slice(this.start);
      this.values = this.values.slice(this.start);
      this.start = 0;
    }
  }
}

/** A sliding share of recent ticks on which an ear had signal. */
class Coverage {
  private readonly ring: Uint8Array;
  private pos = 0;
  private filled = 0;
  private sum = 0;
  /** Consecutive ticks without signal, up to now. */
  missingRun = 0;
  constructor(size: number) {
    this.ring = new Uint8Array(size);
  }
  push(live: boolean) {
    const v = live ? 1 : 0;
    if (this.filled === this.ring.length) this.sum -= this.ring[this.pos];
    else this.filled++;
    this.ring[this.pos] = v;
    this.sum += v;
    this.pos = (this.pos + 1) % this.ring.length;
    this.missingRun = live ? 0 : this.missingRun + 1;
  }
  get share(): number {
    return this.filled ? this.sum / this.filled : 0;
  }
  /** Has the window seen enough to judge? */
  get judged(): boolean {
    return this.filled >= this.ring.length / 4;
  }
}

export class PhoneSession {
  readonly perEar: number;
  readonly azimuths: number[];

  private rate: number;
  private readonly model: DecoderModel | null;
  private dec: AttentionDecoder | null;
  private detectors!: Record<ClenchMode, ClenchDetector>;
  private mode: ClenchMode | null = null;
  private coverage!: Record<Ear, Coverage>;
  private warn: string | null = null;

  private readonly now: () => number;
  private readonly ssp: Record<Ear, SspDecoder> = { left: new SspDecoder(), right: new SspDecoder() };
  /** Per earbud (or one for a dev kit carrying both ears): frames to a gap aware series. */
  private readonly streams = new Map<Side, EegStream>();
  private readonly hello = new Map<Side, { fs: number; channels: number; nv: number }>();
  /** Each earbud's clock mapped onto the phone's (one for a dev kit carrying both ears). */
  private readonly sync = new Map<Side, ClockSync>();
  /** Each earbud's AUDIO_ENV timestamps, unwrapped like its EEG. */
  private readonly envClock = new Map<Side, ClockUnwrap>();

  // The grid.
  private readonly queue: Record<Ear, EarQueue> = { left: new EarQueue(), right: new EarQueue() };
  /** Phone time of tick 0; null until the first sample. */
  private t0: number | null = null;
  /** The next tick to read out. */
  private tick = 0;
  /** The newest sample time seen from either ear. */
  private latest = -Infinity;

  private readonly arrivals: Record<Ear, number[]> = { left: [], right: [] };
  private readonly battery: Record<Ear, number | null> = { left: null, right: null };
  private readonly leadOff: Record<Ear, number> = { left: 0, right: 0 };
  private readonly head: Partial<Record<Ear, { yaw: number; at: number }>> = {};
  private readonly frame: Float64Array;
  private readonly listeners = new Set<(e: ClenchEvent, info: { latencyMs: number }) => void>();
  /** Frames the current clench detector has seen: its own timeline. */
  private fed = 0;
  private readonly tapListeners = new Set<(ear: Ear, uv: number[]) => void>();
  /** Ticks read out so far: the decoder's and the detector's shared clock, at fs. */
  processed = 0;

  constructor(opts: SessionOptions) {
    this.rate = opts.fs;
    this.perEar = opts.perEar;
    this.azimuths = opts.azimuths ?? [-90, 90];
    this.now = opts.now ?? (() => performance.now());
    this.frame = new Float64Array(2 * opts.perEar);
    this.model = opts.model ?? null;
    this.dec = null;
    this.configure(opts.fs);
  }

  /** The EEG rate everything runs at, Hz. */
  get fs(): number {
    return this.rate;
  }

  /** The attention decoder, when a model was given and the earbuds' rate matches it. */
  get decoder(): AttentionDecoder | null {
    return this.dec;
  }

  /** Both ears' detector: the usual one. */
  get clench(): ClenchDetector {
    return this.detectors.both;
  }

  /** Everything that depends on the EEG rate. */
  private configure(fs: number) {
    this.rate = fs;
    this.warn = null;
    const p = this.perEar;
    const left = Array.from({ length: p }, (_, i) => i);
    const right = Array.from({ length: p }, (_, i) => p + i);
    this.detectors = {
      both: new ClenchDetector({ fs, left, right }),
      // A one eared detector sees that ear's electrodes on both of its sides.
      left: new ClenchDetector({ fs, left, right: left, k: ONE_EAR_K }),
      right: new ClenchDetector({ fs, left: right, right, k: ONE_EAR_K }),
    };
    const size = Math.round(COVERAGE_S * fs);
    this.coverage = { left: new Coverage(size), right: new Coverage(size) };
    this.dec = null;
    if (this.model) {
      if (this.model.fsRaw === fs) this.dec = new AttentionDecoder(this.model, this.azimuths.length, { historySeconds: 30 });
      else this.warn = `the decoder model expects EEG at ${this.model.fsRaw} Hz, the earbuds send ${fs} Hz`;
    }
  }

  /**
   * Clenches as the detector finds them in the raw signal, with how long after
   * the jaw activity began it was reported, on the detector's own timeline.
   */
  onClench(cb: (e: ClenchEvent, info: { latencyMs: number }) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Every EEG sample as it arrives, per ear, in microvolts: for drawing. */
  onSamples(cb: (ear: Ear, uv: number[]) => void): () => void {
    this.tapListeners.add(cb);
    return () => this.tapListeners.delete(cb);
  }

  /** Bytes from one earbud, any chunking. A dev kit carrying both ears ("single") is split down the middle. */
  bytes(bytes: Uint8Array, side: Side): void {
    const ear: Ear = side === "right" ? "right" : "left";
    for (const f of this.ssp[ear].push(bytes)) this.frameIn(f, side);
    this.readOut();
  }

  private frameIn(f: SspFrame, side: Side) {
    const ear: Ear = side === "right" ? "right" : "left";
    switch (f.type) {
      case "hello": {
        const fs = f.eegRate || this.rate;
        this.hello.set(side, { fs, channels: f.labels.length, nv: f.nvPerLsb });
        if (fs !== this.rate) {
          // The earbuds decide their rate. Before any EEG everything is
          // rebuilt for it; after, two rates cannot share one timeline.
          if (this.t0 === null) this.configure(fs);
          else this.warn = `an earbud switched to ${fs} Hz while the session runs at ${this.rate} Hz`;
        }
        // Only a HELLO that opens a new stream starts the series afresh. One
        // asked for on a reconnect does not, so the outage before it is still
        // filled and every later sample keeps its place.
        if (f.flags & Flag.streamStart) {
          this.streams.delete(side);
          this.sync.delete(side);
          this.envClock.delete(side);
        }
        if (f.battery <= 100) this.battery[ear] = f.battery;
        break;
      }
      case "eeg":
        this.eegIn(side, f);
        break;
      case "imu": {
        const v = f.values;
        const o = (f.samples - 1) * 10;
        this.head[ear] = { yaw: yawDeg(v[o + 6] / QUAT_ONE, v[o + 7] / QUAT_ONE, v[o + 8] / QUAT_ONE, v[o + 9] / QUAT_ONE), at: this.now() };
        break;
      }
      case "audioEnv":
        this.envIn(side, f.timestamp, f.samples, f.talkers, f.envelopes);
        break;
      case "event":
        if (f.code === EventCode.battery && f.value <= 100) this.battery[ear] = f.value;
        if (f.code === EventCode.leadOff) this.leadOff[ear] = f.value;
        break;
      default:
        break;
    }
  }

  /**
   * Into the side's series, where frames lost on the air become NaN for
   * exactly the samples lost, then onto the phone's clock and into the ear's
   * queue for the grid.
   */
  private eegIn(side: Side, f: EegFrame) {
    let stream = this.streams.get(side);
    if (!stream) {
      const h = this.hello.get(side) ?? { fs: this.rate, channels: f.channels, nv: 22.35 };
      stream = new EegStream(h.fs, h.channels, h.nv);
      this.streams.set(side, stream);
    }
    const chunk = stream.push(f);
    if (!chunk) return;
    // A series that restarts (its clock stepped back without a HELLO) needs a fresh clock map.
    let sync = chunk.restart ? undefined : this.sync.get(side);
    if (!sync) {
      sync = new ClockSync();
      this.sync.set(side, sync);
    }
    const n = chunk.data[0]?.length ?? 0;
    const period = 1e6 / stream.fs;
    sync.observe(chunk.time + (n - 1) * period, this.now());
    const ears: [Ear, number][] = side === "single" ? [["left", 0], ["right", this.perEar]] : [[side === "right" ? "right" : "left", 0]];
    for (const [ear, offset] of ears) {
      const q = this.queue[ear];
      const sample = new Array<number>(this.perEar);
      for (let s = 0; s < n; s++) {
        const t = sync.toHost(chunk.time + s * period);
        const values = new Float32Array(this.perEar);
        for (let c = 0; c < this.perEar; c++) {
          const v = chunk.data[offset + c]?.[s] ?? NaN;
          values[c] = v;
          sample[c] = v;
        }
        q.push(t, values);
        if (t > this.latest) this.latest = t;
        if (this.t0 === null) this.t0 = t;
        for (const cb of this.tapListeners) cb(ear, sample);
      }
      this.arrivals[ear].push(this.now(), f.samples);
      if (this.arrivals[ear].length > 600) this.arrivals[ear].splice(0, 200);
    }
  }

  /**
   * The voices' envelopes onto the timeline: each sample's device time,
   * through the sending earbud's clock map, gives its place at the decoder's
   * rate. A place already filled (a duplicate, or the other earbud sending
   * the same moment) is skipped; a hole is NaN, which the decoder bridges.
   */
  private envIn(side: Side, timestamp: number, samples: number, talkers: number, values: Uint16Array) {
    const d = this.dec;
    const sync = this.sync.get(side);
    if (!d || !sync || this.t0 === null) return;
    let clock = this.envClock.get(side);
    if (!clock) {
      clock = new ClockUnwrap();
      this.envClock.set(side, clock);
    }
    const start = clock.push(timestamp);
    const period = 1e6 / d.fs;
    for (let s = 0; s < samples; s++) {
      const place = Math.round(((sync.toHost(start + s * period) - this.t0) * d.fs) / 1000);
      const have = d.envelopeCount(0);
      if (place < have) continue;
      if (place - have > MAX_PAD_S * d.fs) {
        // Far ahead of anything the decoder holds: start the decoder over on the current timeline.
        this.restartDecoder();
        return;
      }
      for (let i = have; i < place; i++) for (let k = 0; k < d.talkers; k++) d.pushEnvelope(k, NaN);
      for (let k = 0; k < d.talkers; k++) d.pushEnvelope(k, k < talkers ? values[s * talkers + k] : NaN);
    }
  }

  /** A fresh decoder whose sample 0 is the next tick, for EEG and envelopes alike. */
  private restartDecoder() {
    if (!this.dec || !this.model || this.t0 === null) return;
    this.dec = new AttentionDecoder(this.model, this.azimuths.length, { historySeconds: 30 });
    this.t0 += (this.tick * 1000) / this.rate;
    this.tick = 0;
    this.processed = 0;
  }

  /**
   * Reads the grid out up to where both ears have spoken, or where the
   * quieter one has been waited for long enough. Each tick takes from each
   * ear the sample within half a period of it; older samples are too late.
   */
  private readOut() {
    if (this.t0 === null) return;
    const period = 1000 / this.rate;
    const half = period / 2;
    const p = this.perEar;
    const L = this.queue.left;
    const R = this.queue.right;
    for (;;) {
      const t = this.t0 + this.tick * period;
      // Drop what is too late for this tick.
      let dl = 0;
      while (dl < L.length && L.time(dl) < t - half) dl++;
      if (dl) L.shift(dl);
      let dr = 0;
      while (dr < R.length && R.time(dr) < t - half) dr++;
      if (dr) R.shift(dr);
      // Ready when each ear has something at or past this tick, or has been waited for long enough.
      const lReady = L.length > 0 || this.latest - t >= WAIT_MS;
      const rReady = R.length > 0 || this.latest - t >= WAIT_MS;
      if (!lReady || !rReady || this.latest < t) break;
      const lHit = L.length > 0 && L.time(0) <= t + half;
      const rHit = R.length > 0 && R.time(0) <= t + half;
      const lv = lHit ? L.value(0) : null;
      const rv = rHit ? R.value(0) : null;
      for (let c = 0; c < p; c++) {
        this.frame[c] = lv ? lv[c] : NaN;
        this.frame[p + c] = rv ? rv[c] : NaN;
      }
      if (lHit) L.shift(1);
      if (rHit) R.shift(1);
      this.tick++;
      this.step();
    }
  }

  /**
   * One tick through the decoder, which bridges an ear that has nothing
   * there, and through the clench detector.
   *
   * The detector needs both ears to agree, and bridges a short gap itself.
   * An ear missing for longer than BRIDGE_S pauses it: a flat line would
   * teach it a floor of nothing, and the next real signal would read as a
   * clench that never ends. When one ear has mostly gone (one earbud in, or
   * the other out of range), a detector on the remaining ear alone takes
   * over, at a stricter threshold; when both are present again, the usual
   * one does. Each starts by learning the background afresh.
   */
  private step() {
    this.dec?.pushRaw(this.frame);
    this.processed++;
    const p = this.perEar;
    const has = (from: number) => {
      for (let c = from; c < from + p; c++) if (Number.isFinite(this.frame[c])) return true;
      return false;
    };
    const cl = this.coverage.left;
    const cr = this.coverage.right;
    cl.push(has(0));
    cr.push(has(p));
    if (!cl.judged || !cr.judged) return;
    const lp = cl.share >= PRESENT;
    const rp = cr.share >= PRESENT;
    const next: ClenchMode | null =
      lp && rp ? "both" : lp && cr.share <= GONE ? "left" : rp && cl.share <= GONE ? "right" : this.mode;
    if (!next) return;
    if (next !== this.mode) {
      this.detectors[next].reset();
      this.mode = next;
      this.fed = 0;
    }
    const bridge = BRIDGE_S * this.rate;
    const blocked = next === "both" ? cl.missingRun > bridge || cr.missingRun > bridge : (next === "left" ? cl : cr).missingRun > bridge;
    if (blocked) return;
    const e = this.detectors[next].push(this.frame);
    this.fed++;
    if (!e) return;
    const latencyMs = Math.round((this.fed / this.rate - e.time) * 1000);
    for (const cb of this.listeners) cb(e, { latencyMs });
  }

  /**
   * Head yaw from whichever motion sensors reported lately, averaged on the
   * circle: left at 179 degrees and right at -179 is the head turned all the
   * way round, not straight ahead.
   */
  get yaw(): number | null {
    const now = this.now();
    const ys = [this.head.left, this.head.right].filter((h): h is { yaw: number; at: number } => !!h && now - h.at <= YAW_STALE_MS).map((h) => h.yaw);
    if (!ys.length) return null;
    const r = Math.PI / 180;
    const x = ys.reduce((a, y) => a + Math.cos(y * r), 0);
    const y = ys.reduce((a, d) => a + Math.sin(d * r), 0);
    return Math.atan2(y, x) / r;
  }

  snapshot(): SessionSnapshot {
    const now = this.now();
    const ear = (e: Ear): EarStats => {
      const st = this.ssp[e].stats;
      const a = this.arrivals[e];
      let n = 0;
      for (let i = a.length - 2; i >= 0; i -= 2) {
        if (a[i] < now - RATE_WINDOW_MS) break;
        n += a[i + 1];
      }
      const sync = this.sync.get(e) ?? this.sync.get("single");
      // The fit holds the slope at exactly 1 until it has seen enough time.
      const driftPpm = !sync || sync.driftPpm === 0 ? null : sync.driftPpm;
      return { frames: st.frames, lost: st.lost, rate: Math.round((n * 1000) / RATE_WINDOW_MS), driftPpm, battery: this.battery[e], leadOff: this.leadOff[e] };
    };
    const d = this.dec?.decide(DECIDE_S) ?? null;
    const eeg = d ? { talker: d.talker, margin: d.margin } : null;
    const yaw = this.yaw;
    const posterior = fuseAttention({ azimuthsDeg: this.azimuths, yawDeg: yaw ?? undefined, eeg });
    return { ears: { left: ear("left"), right: ear("right") }, yaw, eeg, posterior, clench: this.mode, warning: this.warn };
  }

  /**
   * The STEER command for a posterior: bring the likeliest voice forward, by
   * up to maxGainDb as the posterior grows from even to certain. STEER is
   * relative to the head, so the voice's place in the room is turned by the
   * head's yaw. Written to every earbud ("single" in the header).
   */
  steer(posterior: number[], maxGainDb = 9): Uint8Array {
    let best = 0;
    for (let i = 1; i < posterior.length; i++) if (posterior[i] > posterior[best]) best = i;
    const even = 1 / posterior.length;
    // With one voice there is nothing to bring forward over another.
    const confidence = posterior.length > 1 ? Math.max(0, (posterior[best] - even) / (1 - even)) : 0;
    const gainDb = Math.round(confidence * maxGainDb * 10) / 10;
    const yaw = this.yaw ?? 0;
    const relative = ((((this.azimuths[best] ?? 0) - yaw + 180) % 360) + 360) % 360 - 180;
    return encodeCommand({ op: "steer", azimuthDeg: Math.round(relative * 10) / 10, gainDb }, { side: "single" });
  }
}
