/**
 * The phone side of a pair of earbuds, from bytes to decisions. Feed it what
 * a Transport delivers (SSP bytes, tagged with the earbud they came from) and
 * it decodes the frames, keeps the two ears lined up sample for sample even
 * when frames are lost on the air, runs the clench detector and, when the
 * earbuds send the voices' envelopes and a decoder model is given, the
 * attention decoder; it fuses that with the head direction from the motion
 * sensors and writes the STEER command that tells the earbuds which voice to
 * bring forward.
 *
 * It does not care where the bytes come from: the digital twin, an OpenBCI
 * board and the earbuds themselves all produce SSP, which is the point.
 */
import { ClenchDetector, type ClenchEvent } from "./clench";
import { AttentionDecoder, type DecoderModel } from "./decoder";
import { fuseAttention } from "./fusion";
import { ClockSync, EarAligner, EegStream, EventCode, Flag, QUAT_ONE, SspDecoder, encodeCommand, yawDeg, type EegFrame, type Side, type SspFrame } from "./protocol";

export type Ear = "left" | "right";

export interface SessionOptions {
  /** The electrode sample rate the earbuds stream at, Hz. */
  fs: number;
  /** Electrodes per earbud, in the order each earbud sends them. */
  perEar: number;
  /** An attention decoder; it needs the earbuds' AUDIO_ENV frames as well. */
  model?: DecoderModel;
  /** Where the voices are, degrees, 0 ahead and positive to the right. */
  azimuths?: number[];
  /** Milliseconds, for rates and clock drift. Default performance.now. */
  now?: () => number;
}

export interface EarStats {
  frames: number;
  lost: number;
  /** EEG samples a second over the last two seconds. */
  rate: number;
  /** The earbud's clock against the phone's, parts per million; null until two seconds have passed. */
  driftPpm: number | null;
  battery: number | null;
  /** Bit i set while electrode i has lost contact. */
  leadOff: number;
}

export interface SessionSnapshot {
  ears: Record<Ear, EarStats>;
  /** Head yaw from the motion sensors, degrees, positive to the right. */
  yaw: number | null;
  /** The decoder's verdict over the last 10 seconds, when there is one. */
  eeg: { talker: number; margin: number } | null;
  /** Probability per voice that it is the attended one, head and EEG together. */
  posterior: number[];
}

/** Seconds of EEG and envelope behind each attention verdict. */
const DECIDE_S = 10;
const RATE_WINDOW_MS = 2000;

export class PhoneSession {
  readonly fs: number;
  readonly perEar: number;
  readonly azimuths: number[];
  readonly decoder: AttentionDecoder | null;
  readonly clench: ClenchDetector;

  private readonly now: () => number;
  private readonly ssp: Record<Ear, SspDecoder> = { left: new SspDecoder(), right: new SspDecoder() };
  /** Per earbud (or one for a dev kit carrying both ears): frames to a gap aware series. */
  private readonly streams = new Map<Side, EegStream>();
  private readonly hello = new Map<Side, { fs: number; channels: number; nv: number }>();
  /** Each earbud's clock mapped onto the phone's (one for a dev kit carrying both ears). */
  private readonly sync = new Map<Side, ClockSync>();
  /** Pairs the ears by time on the phone's clock, not by sample count: the earbuds connect at different moments and their clocks drift. */
  private readonly aligner: EarAligner;
  private envPrev: { device: number; samples: number } | null = null;
  private readonly arrivals: Record<Ear, number[]> = { left: [], right: [] };
  private readonly battery: Record<Ear, number | null> = { left: null, right: null };
  private readonly leadOff: Record<Ear, number> = { left: 0, right: 0 };
  private readonly head: Partial<Record<Ear, number>> = {};
  private readonly frame: Float64Array;
  private readonly listeners = new Set<(e: ClenchEvent, info: { latencyMs: number }) => void>();
  /** Frames the clench detector has seen: its own timeline, which skips one eared instants. */
  private fed = 0;
  private readonly tapListeners = new Set<(ear: Ear, uv: number[]) => void>();
  /** Paired samples processed so far. */
  processed = 0;

  constructor(opts: SessionOptions) {
    this.fs = opts.fs;
    this.perEar = opts.perEar;
    this.azimuths = opts.azimuths ?? [-90, 90];
    this.now = opts.now ?? (() => performance.now());
    this.frame = new Float64Array(2 * opts.perEar);
    this.aligner = new EarAligner(opts.fs, [opts.perEar, opts.perEar]);
    this.decoder = opts.model ? new AttentionDecoder(opts.model, this.azimuths.length, { historySeconds: 30 }) : null;
    const left = Array.from({ length: opts.perEar }, (_, i) => i);
    const right = Array.from({ length: opts.perEar }, (_, i) => opts.perEar + i);
    this.clench = new ClenchDetector({ fs: opts.fs, left, right });
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
    this.pair();
  }

  private frameIn(f: SspFrame, side: Side) {
    const ear: Ear = side === "right" ? "right" : "left";
    switch (f.type) {
      case "hello":
        this.hello.set(side, { fs: f.eegRate || this.fs, channels: f.labels.length, nv: f.nvPerLsb });
        // Only a HELLO that opens a new stream starts the series afresh. One
        // asked for on a reconnect does not, so the outage before it is still
        // filled and every later sample keeps its place.
        if (f.flags & Flag.streamStart) {
          this.streams.delete(side);
          this.sync.delete(side);
        }
        if (f.battery <= 100) this.battery[ear] = f.battery;
        break;
      case "eeg":
        this.eegIn(side, f);
        break;
      case "imu": {
        const v = f.values;
        const o = (f.samples - 1) * 10;
        this.head[ear] = yawDeg(v[o + 6] / QUAT_ONE, v[o + 7] / QUAT_ONE, v[o + 8] / QUAT_ONE, v[o + 9] / QUAT_ONE);
        break;
      }
      case "audioEnv":
        this.envIn(f.timestamp, f.samples, f.talkers, f.envelopes);
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
   * exactly the samples lost (the decoder and the detector bridge them), then
   * onto the phone's clock, where the aligner pairs left with right by time.
   */
  private eegIn(side: Side, f: EegFrame) {
    let stream = this.streams.get(side);
    if (!stream) {
      const h = this.hello.get(side) ?? { fs: this.fs, channels: f.channels, nv: 22.35 };
      stream = new EegStream(h.fs, h.channels, h.nv);
      this.streams.set(side, stream);
    }
    const chunk = stream.push(f);
    if (!chunk) return;
    let sync = this.sync.get(side);
    if (!sync) {
      sync = new ClockSync();
      this.sync.set(side, sync);
    }
    const n = chunk.data[0]?.length ?? 0;
    sync.observe(chunk.time + ((n - 1) * 1e6) / stream.fs, this.now());
    const host = sync.toHost(chunk.time);
    const ears: [Ear, number][] = side === "single" ? [["left", 0], ["right", this.perEar]] : [[side === "right" ? "right" : "left", 0]];
    for (const [ear, offset] of ears) {
      const data = chunk.data.slice(offset, offset + this.perEar);
      this.aligner.push(ear, host, data);
      const sample = new Array<number>(this.perEar);
      for (let s = 0; s < n; s++) {
        for (let c = 0; c < this.perEar; c++) sample[c] = data[c]?.[s] ?? NaN;
        for (const cb of this.tapListeners) cb(ear, sample);
      }
      this.arrivals[ear].push(this.now(), f.samples);
      if (this.arrivals[ear].length > 600) this.arrivals[ear].splice(0, 200);
    }
  }

  private envIn(timestamp: number, samples: number, talkers: number, values: Uint16Array) {
    const d = this.decoder;
    if (!d) return;
    // The same rule for the voices' envelopes, at 64 Hz on the sending earbud's clock.
    if (this.envPrev) {
      const elapsed = (timestamp - this.envPrev.device + 2 ** 32) % 2 ** 32;
      const missing = Math.round((elapsed * d.fs) / 1e6) - this.envPrev.samples;
      if (missing > 1) for (let i = 0; i < missing; i++) for (let t = 0; t < d.talkers; t++) d.pushEnvelope(t, NaN);
    }
    this.envPrev = { device: timestamp, samples };
    for (let s = 0; s < samples; s++) {
      for (let t = 0; t < Math.min(d.talkers, talkers); t++) d.pushEnvelope(t, values[s * talkers + t]);
    }
  }

  /**
   * Every instant the aligner can pair goes through the decoder, which
   * bridges an ear that has nothing there and keeps its timeline. The clench
   * detector only sees instants where both ears have signal: a clench needs
   * both anyway, and an ear that is missing (not yet connected, or out of
   * range) would otherwise teach it a flat noise floor, and the next real
   * signal would read as a clench that never ends.
   */
  private pair() {
    const p = this.perEar;
    const live = (from: number) => {
      for (let c = from; c < from + p; c++) if (Number.isFinite(this.frame[c])) return true;
      return false;
    };
    for (const sample of this.aligner.pull()) {
      for (let c = 0; c < this.frame.length; c++) this.frame[c] = sample.values[c] ?? NaN;
      this.decoder?.pushRaw(this.frame);
      this.processed++;
      if (!live(0) || !live(p)) continue;
      const e = this.clench.push(this.frame);
      this.fed++;
      if (!e) continue;
      const latencyMs = Math.round((this.fed / this.fs - e.time) * 1000);
      for (const cb of this.listeners) cb(e, { latencyMs });
    }
  }

  /**
   * Head yaw from whichever motion sensors report, averaged on the circle:
   * left at 179 degrees and right at -179 is the head turned all the way
   * round, not straight ahead.
   */
  get yaw(): number | null {
    const ys = [this.head.left, this.head.right].filter((y): y is number => y !== undefined);
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
    const d = this.decoder?.decide(DECIDE_S) ?? null;
    const eeg = d ? { talker: d.talker, margin: d.margin } : null;
    const yaw = this.yaw;
    const posterior = fuseAttention({ azimuthsDeg: this.azimuths, yawDeg: yaw ?? undefined, eeg });
    return { ears: { left: ear("left"), right: ear("right") }, yaw, eeg, posterior };
  }

  /**
   * The STEER command for a posterior: bring the likeliest voice forward, by
   * up to maxGainDb as the posterior grows from even to certain. Written to
   * every earbud ("single" in the header).
   */
  steer(posterior: number[], maxGainDb = 9): Uint8Array {
    let best = 0;
    for (let i = 1; i < posterior.length; i++) if (posterior[i] > posterior[best]) best = i;
    const even = 1 / posterior.length;
    const confidence = Math.max(0, (posterior[best] - even) / (1 - even));
    const gainDb = Math.round(confidence * maxGainDb * 10) / 10;
    return encodeCommand({ op: "steer", azimuthDeg: this.azimuths[best], gainDb }, { side: "single" });
  }
}
