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
import { ClenchDetector, type ClenchEvent, type ClenchWithdrawal } from "./clench";
import { createDecoder, fusionWeight, type AnyDecoderModel, type StreamingDecoder } from "./decoders";
import { AttentionBelief, fuseAttention } from "./fusion";
import { ClockSync, EegStream, EventCode, Flag, QUAT_ONE, SspDecoder, encodeCommand, yawDeg, type EegFrame, type ImuFrame, type Side, type SspFrame } from "./protocol";

export type Ear = "left" | "right";

/** Which ears the clench detector is listening to. */
export type ClenchMode = "both" | "left" | "right";

export interface SessionOptions {
  /** The electrode sample rate the earbuds stream at, Hz. A HELLO that says otherwise before any EEG wins. */
  fs: number;
  /** Electrodes per earbud, in the order each earbud sends them. */
  perEar: number;
  /** An attention decoder, linear or learned; it needs the earbuds' AUDIO_ENV frames as well, and EEG at its fsRaw. */
  model?: AnyDecoderModel;
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

/** What one earbud (or a dev kit carrying both ears) has said about itself. */
export interface EarbudInfo {
  /** Its electrodes' names, in the order it sends them. */
  labels: string[];
  /** Its EEG and motion sensor rates as its HELLO announced them, Hz; imuRate is 0 without a motion sensor. */
  eegRate: number;
  imuRate: number;
  /** Its frames are made by an emulator, such as the digital twin, never by hardware. */
  simulated: boolean;
  /** Percent; null when not reported. */
  battery: number | null;
  /** In the ear, from its last wear EVENT; null until it sends one. */
  worn: boolean | null;
  /** Bit i set while its electrode i has lost contact; null until it reports lead off at all. */
  leadOff: number | null;
}

/** What onClench says about a clench besides the clench itself. */
export interface ClenchInfo {
  /** How long after the jaw activity began it was reported. */
  latencyMs: number;
  /** Which ears the detector that found it listens to. */
  ears: ClenchMode;
  /** That detector's threshold, as a multiple of the background (ClenchDetector.k): higher for one ear alone. */
  k: number;
}

/** One 10 second decision of the attention decoder, as the belief takes it in. */
export interface AttentionDecision {
  /** The window, phone ms: from its first sample to just after its last. */
  startMs: number;
  endMs: number;
  /** The talker whose envelope scored best, and by how much over the next. */
  talker: number;
  margin: number;
  /** The belief per talker after this decision. */
  belief: number[];
}

export interface SessionSnapshot {
  ears: Record<Ear, EarStats>;
  /** Head yaw from the motion sensors, degrees, positive to the right; null when none has reported lately. */
  yaw: number | null;
  /** The decoder's verdict over the last 10 seconds, when there is one. */
  eeg: { talker: number; margin: number } | null;
  /** The EEG's running belief per voice, built from every 10 second decision so far; null without a decoder. */
  belief: number[] | null;
  /** Probability per voice that it is the attended one, head and the EEG's belief together. */
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
/** An ear that has sent nothing for this long is not waited for at all. */
const SILENT_MS = 1000;
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
/** Both ears silent longer than this: the grid jumps to where they resume instead of stepping through the gap. */
const JUMP_MS = 60_000;
/** The earbud sending envelopes is replaced by the other only after this long without them. */
const ENV_FAILOVER_MS = 2000;
/** The clench detector's muscle band needs at least this rate. */
const MIN_FS = 250;
/** A clock that steps back further than this restarted; less is a frame delivered out of order. */
const CLOCK_RESTART_US = 1e6;
/** How far back each detector's frames keep their phone times: past the longest gesture. */
const FEED_TIMES_S = 10;
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
  reset() {
    this.ring.fill(0);
    this.pos = 0;
    this.filled = 0;
    this.sum = 0;
    this.missingRun = 0;
  }
}

export class PhoneSession {
  readonly perEar: number;
  readonly azimuths: number[];

  private rate: number;
  private model: AnyDecoderModel | null;
  private dec: StreamingDecoder | null;
  /** Every non overlapping 10 second decision so far, weighed by what it is worth; it outlives a decoder restart. */
  private belief: AttentionBelief | null = null;
  /** The decoder sample the belief has taken decisions up to. */
  private judged = 0;
  private detectors!: Record<ClenchMode, ClenchDetector>;
  /** Frames each detector has seen: its own timeline. */
  private fed: Record<ClenchMode, number> = { both: 0, left: 0, right: 0 };
  /** Phone time of each frame each detector has seen, recent ones: turns its timeline back into the phone's. */
  private feedTimes!: Record<ClenchMode, Float64Array>;
  /** When the last clench was reported, phone ms: a gesture that began before it is that same gesture, seen again. */
  private lastReport = -Infinity;
  /** The detector that speaks for the earbuds now. */
  private mode: ClenchMode | null = null;
  private coverage!: Record<Ear, Coverage>;
  /** An ear away longer than the bridge: its detectors relearn the background when it is back. */
  private readonly away: Record<Ear, boolean> = { left: true, right: true };
  private warn: string | null = null;
  /** Every EEG rate the earbuds have announced, per side. */
  private readonly announced = new Map<Side, number>();

  private readonly now: () => number;
  private readonly ssp: Record<Ear, SspDecoder> = { left: new SspDecoder(), right: new SspDecoder() };
  /** Per earbud (or one for a dev kit carrying both ears): frames to a gap aware series. */
  private readonly streams = new Map<Side, EegStream>();
  private readonly hello = new Map<Side, { fs: number; channels: number; nv: number }>();
  /** Each earbud's clock mapped onto the phone's (one for a dev kit carrying both ears). */
  private readonly sync = new Map<Side, ClockSync>();
  /** Each side's newest EEG time, unwrapped device microseconds: AUDIO_ENV timestamps are unwrapped against it. */
  private readonly eegDevice = new Map<Side, number>();
  /** The earbud whose envelopes are used, and when it last sent one (phone ms). */
  private envSource: Side | "phone" | null = null;
  private envSourceAt = -Infinity;

  // The grid.
  private readonly queue: Record<Ear, EarQueue> = { left: new EarQueue(), right: new EarQueue() };
  /** Phone time of tick 0; null until the first sample. */
  private t0: number | null = null;
  /** The next tick to read out. */
  private tick = 0;
  /** The newest sample time seen from either ear. */
  private latest = -Infinity;
  /** The newest sample time each ear has sent, used on the grid or not. */
  private readonly heard: Record<Ear, number> = { left: -Infinity, right: -Infinity };

  private readonly arrivals: Record<Ear, number[]> = { left: [], right: [] };
  private readonly battery: Record<Ear, number | null> = { left: null, right: null };
  private readonly leadOff: Record<Ear, number> = { left: 0, right: 0 };
  private readonly head: Partial<Record<Ear, { yaw: number; at: number }>> = {};
  /** What each earbud announced in its latest HELLO, by the side it named. */
  private readonly devices = new Map<Side, { labels: string[]; eegRate: number; imuRate: number; simulated: boolean }>();
  /** Each side's wear and lead off, as it last reported them. */
  private readonly worn = new Map<Side, boolean>();
  private readonly contact = new Map<Side, number>();
  private readonly frame: Float64Array;
  private readonly listeners = new Set<(e: ClenchEvent, info: ClenchInfo) => void>();
  private readonly withdrawListeners = new Set<(w: ClenchWithdrawal) => void>();
  private readonly decisionListeners = new Set<(d: AttentionDecision) => void>();
  private readonly tapListeners = new Set<(ear: Ear, uv: number[], t: number) => void>();
  private readonly motionListeners = new Set<(ear: Ear, yaw: number[], t: number) => void>();
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
  get decoder(): StreamingDecoder | null {
    return this.dec;
  }

  /**
   * A decoder model that arrived after the session started (the learned one
   * is fetched while the earbuds connect), or null to stop decoding. The
   * decoder starts on the next tick; the belief starts even.
   */
  setModel(model: AnyDecoderModel | null): void {
    this.model = model;
    this.dec = null;
    this.belief = null;
    this.judged = 0;
    this.warn = null;
    if (!model) return;
    if (model.fsRaw !== this.rate) {
      this.warn = `the decoder model expects EEG at ${model.fsRaw} Hz, the earbuds send ${this.rate} Hz`;
      return;
    }
    // Sample 0 of the new decoder is the next tick, as after a restart.
    this.dec = createDecoder(model, this.azimuths.length, { historySeconds: 30 });
    this.belief = new AttentionBelief({ talkers: this.azimuths.length, weight: fusionWeight(model) });
    if (this.t0 !== null) {
      this.t0 += (this.tick * 1000) / this.rate;
      this.tick = 0;
      this.processed = 0;
    }
  }

  /** Both ears' detector: the usual one. */
  get clench(): ClenchDetector {
    return this.detectors.both;
  }

  /** Everything that depends on the EEG rate. */
  private configure(fs: number) {
    const p = this.perEar;
    const left = Array.from({ length: p }, (_, i) => i);
    const right = Array.from({ length: p }, (_, i) => p + i);
    this.detectors = {
      both: new ClenchDetector({ fs, left, right }),
      // A one eared detector sees that ear's electrodes on both of its sides.
      left: new ClenchDetector({ fs, left, right: left, k: ONE_EAR_K }),
      right: new ClenchDetector({ fs, left: right, right, k: ONE_EAR_K }),
    };
    this.fed = { both: 0, left: 0, right: 0 };
    const keep = Math.round(FEED_TIMES_S * fs);
    this.feedTimes = { both: new Float64Array(keep), left: new Float64Array(keep), right: new Float64Array(keep) };
    this.rate = fs;
    this.warn = null;
    const size = Math.round(COVERAGE_S * fs);
    this.coverage = { left: new Coverage(size), right: new Coverage(size) };
    this.dec = null;
    if (this.model) {
      if (this.model.fsRaw === fs) {
        this.dec = createDecoder(this.model, this.azimuths.length, { historySeconds: 30 });
        this.belief = new AttentionBelief({ talkers: this.azimuths.length, weight: fusionWeight(this.model) });
        this.judged = 0;
      } else this.warn = `the decoder model expects EEG at ${this.model.fsRaw} Hz, the earbuds send ${fs} Hz`;
    }
  }

  /**
   * Clenches as the detector finds them in the raw signal, with how long after
   * the jaw activity began it was reported, on the detector's own timeline,
   * and which detector found it.
   */
  onClench(cb: (e: ClenchEvent, info: ClenchInfo) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Gestures reported a moment ago that chewing has since explained: the
   * detector that reported them takes them back (ClenchDetector.takeWithdrawals),
   * with the kind and onset they were reported with.
   */
  onClenchWithdrawn(cb: (w: ClenchWithdrawal) => void): () => void {
    this.withdrawListeners.add(cb);
    return () => this.withdrawListeners.delete(cb);
  }

  /** Every 10 second decision of the attention decoder, as the running belief takes it in. */
  onDecision(cb: (d: AttentionDecision) => void): () => void {
    this.decisionListeners.add(cb);
    return () => this.decisionListeners.delete(cb);
  }

  /**
   * The voices' envelopes from the phone itself, for a board that sends
   * none: the phone is playing the voices, so it knows them exactly.
   * values[k] is talker k's envelope (linear amplitude, any scale) at the
   * decoder's rate, its sample s heard at phone time startMs + s / fs.
   * Envelopes from earbuds win while they arrive.
   */
  envelopesAt(startMs: number, values: ArrayLike<number>[]): void {
    const d = this.dec;
    if (!d || this.t0 === null) return;
    const now = this.now();
    if (this.envSource !== null && this.envSource !== "phone" && now - this.envSourceAt < ENV_FAILOVER_MS) return;
    this.envSource = "phone";
    this.envSourceAt = now;
    const n = values[0]?.length ?? 0;
    for (let s = 0; s < n; s++) {
      const place = Math.round(((startMs + (s * 1000) / d.fs - this.t0) * d.fs) / 1000);
      const have = d.envelopeCount(0);
      if (place < have) continue;
      if (place - have > MAX_PAD_S * d.fs) {
        this.restartDecoder();
        return;
      }
      for (let i = have; i < place; i++) for (let k = 0; k < d.talkers; k++) d.pushEnvelope(k, NaN);
      for (let k = 0; k < d.talkers; k++) d.pushEnvelope(k, k < values.length ? values[k][s] : NaN);
    }
    this.advanceBelief();
  }

  /**
   * Every EEG sample as it arrives, per ear, in microvolts, with its time on
   * the phone's clock in ms: for drawing. The array is reused from one sample
   * to the next, so copy what you keep.
   */
  onSamples(cb: (ear: Ear, uv: number[], t: number) => void): () => void {
    this.tapListeners.add(cb);
    return () => this.tapListeners.delete(cb);
  }

  /**
   * Every motion sensor frame as it arrives, per ear: the head's yaw at each
   * of its samples, degrees, positive to the right, and the phone time of the
   * first in ms. yaw already includes it when this is called.
   */
  onMotion(cb: (ear: Ear, yaw: number[], t: number) => void): () => void {
    this.motionListeners.add(cb);
    return () => this.motionListeners.delete(cb);
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
        this.announced.set(side, fs);
        this.devices.set(side, { labels: [...f.labels], eegRate: fs, imuRate: f.imuRate, simulated: (f.flags & Flag.simulated) !== 0 });
        // The earbuds decide their rate. Before any EEG everything is rebuilt
        // for it, if both agree and the clench detector can work at it;
        // otherwise the session says so rather than guessing.
        const rates = [...new Set(this.announced.values())];
        if (rates.length > 1) this.warn = `the earbuds announce different EEG rates (${rates.join(" and ")} Hz)`;
        else if (fs !== this.rate) {
          if (this.t0 !== null) this.warn = `an earbud switched to ${fs} Hz while the session runs at ${this.rate} Hz`;
          else if (fs < MIN_FS) this.warn = `${fs} Hz is too slow for clench detection, which needs ${MIN_FS} Hz`;
          else this.configure(fs);
        }
        // Only a HELLO that opens a new stream starts the series afresh. One
        // asked for on a reconnect does not, so the outage before it is still
        // filled and every later sample keeps its place.
        if (f.flags & Flag.streamStart) {
          this.streams.delete(side);
          this.sync.delete(side);
          this.eegDevice.delete(side);
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
        if (this.motionListeners.size) this.motionIn(side, f);
        break;
      }
      case "audioEnv":
        this.envIn(side, f.timestamp, f.samples, f.talkers, f.envelopes);
        break;
      case "event":
        if (f.code === EventCode.battery && f.value <= 100) this.battery[ear] = f.value;
        if (f.code === EventCode.leadOff) {
          this.leadOff[ear] = f.value;
          this.contact.set(side, f.value);
        }
        if (f.code === EventCode.wear) this.worn.set(side, f.value === 1);
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
    // A series that restarts because the earbud's clock stepped back (it
    // rebooted without a HELLO) needs a fresh clock map. A long gap or a
    // frame delivered out of order also restarts the series, but the clock
    // behind it is the same, and its map stays.
    const previous = this.eegDevice.get(side);
    const stepBack = previous !== undefined && chunk.time < previous - CLOCK_RESTART_US;
    let sync = chunk.restart && stepBack ? undefined : this.sync.get(side);
    if (!sync) {
      sync = new ClockSync();
      this.sync.set(side, sync);
    }
    if (previous === undefined || chunk.time > previous || stepBack) this.eegDevice.set(side, chunk.time);
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
        if (t > this.heard[ear]) this.heard[ear] = t;
        if (this.t0 === null) this.t0 = t;
        for (const cb of this.tapListeners) cb(ear, sample, t);
      }
      this.arrivals[ear].push(this.now(), f.samples);
      if (this.arrivals[ear].length > 600) this.arrivals[ear].splice(0, 200);
    }
  }

  /**
   * A motion frame for whoever follows the head: each sample's yaw, timed on
   * the phone's clock through that earbud's clock map once its EEG has given
   * it one (unwrapped against its EEG, as envelopes are), else by arrival.
   */
  private motionIn(side: Side, f: ImuFrame) {
    const ear: Ear = side === "right" ? "right" : "left";
    const v = f.values;
    const yaw = Array.from({ length: f.samples }, (_, i) => yawDeg(v[i * 10 + 6] / QUAT_ONE, v[i * 10 + 7] / QUAT_ONE, v[i * 10 + 8] / QUAT_ONE, v[i * 10 + 9] / QUAT_ONE));
    const sync = this.sync.get(side);
    const ref = this.eegDevice.get(side);
    const t = sync && ref !== undefined ? sync.toHost(f.timestamp + Math.round((ref - f.timestamp) / 2 ** 32) * 2 ** 32) : this.now();
    for (const cb of this.motionListeners) cb(ear, yaw, t);
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
    const ref = this.eegDevice.get(side);
    if (!d || !sync || ref === undefined || this.t0 === null) return;
    // One earbud's envelopes at a time: two would be spliced by arrival, and
    // each ear hears the voices at its own level. The other takes over only
    // when the first has gone quiet.
    const now = this.now();
    if (this.envSource !== null && side !== this.envSource && now - this.envSourceAt < ENV_FAILOVER_MS) return;
    this.envSource = side;
    this.envSourceAt = now;
    // The 32 bit timestamp, unwrapped to the turn of the clock nearest that
    // earbud's EEG, so a long pause in envelopes cannot be read as a wrap.
    const start = timestamp + Math.round((ref - timestamp) / 2 ** 32) * 2 ** 32;
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
    this.advanceBelief();
  }

  /**
   * Each 10 second window, once, into the belief, as soon as the decoder can
   * decide it: windows that do not overlap, on the decoder's own timeline,
   * so every decision is fresh evidence.
   */
  private advanceBelief() {
    const d = this.dec;
    const b = this.belief;
    if (!d || !b) return;
    const length = Math.round(DECIDE_S * d.fs);
    while (this.judged + length <= d.decidable) {
      const v = d.decideRange(this.judged, length);
      if (v) b.update(v);
      if (v && this.t0 !== null && this.decisionListeners.size) {
        const startMs = this.t0 + (this.judged * 1000) / d.fs;
        const decision: AttentionDecision = { startMs, endMs: startMs + DECIDE_S * 1000, talker: v.talker, margin: v.margin, belief: [...b.probabilities] };
        for (const cb of this.decisionListeners) cb(decision);
      }
      this.judged += length;
    }
  }

  /** A fresh decoder whose sample 0 is the next tick, for EEG and envelopes alike. */
  private restartDecoder() {
    if (!this.dec || !this.model || this.t0 === null) return;
    this.dec = createDecoder(this.model, this.azimuths.length, { historySeconds: 30 });
    this.judged = 0;
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
      let t = this.t0 + this.tick * period;
      // Both ears silent for a long time: jump to where they resume rather than step through the gap.
      const next = Math.min(L.length ? L.time(0) : Infinity, R.length ? R.time(0) : Infinity);
      if (Number.isFinite(next) && next - t > JUMP_MS) {
        this.jump(next);
        t = next;
      }
      // Drop what is too late for this tick.
      let dl = 0;
      while (dl < L.length && L.time(dl) < t - half) dl++;
      if (dl) L.shift(dl);
      let dr = 0;
      while (dr < R.length && R.time(dr) < t - half) dr++;
      if (dr) R.shift(dr);
      // Ready when each ear has something at or past this tick, or has been waited for long enough.
      // An ear that has stopped sending is not waited for: it would delay the
      // other's every clench. Judged by arrivals, not by what made it onto the
      // grid: an ear whose samples come late must still be waited for, or
      // they would all be too late and it would look gone for good.
      const lGone = this.latest - this.heard.left > SILENT_MS;
      const rGone = this.latest - this.heard.right > SILENT_MS;
      const lReady = L.length > 0 || this.latest - t >= WAIT_MS || lGone;
      const rReady = R.length > 0 || this.latest - t >= WAIT_MS || rGone;
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
      this.step(t);
    }
  }

  /** Starts the timeline over at a phone time: a fresh decoder, coverage and detectors. */
  private jump(at: number) {
    this.t0 = at;
    this.tick = 0;
    this.processed = 0;
    if (this.model && this.dec) {
      this.dec = createDecoder(this.model, this.azimuths.length, { historySeconds: 30 });
      this.judged = 0;
    }
    this.coverage.left.reset();
    this.coverage.right.reset();
    this.away.left = true;
    this.away.right = true;
    this.mode = null;
  }

  /**
   * One tick through the decoder, which bridges an ear that has nothing
   * there, and through the clench detectors.
   *
   * Three detectors run side by side: both ears, which needs the two to
   * agree, and each ear alone, at a stricter threshold since nothing on the
   * other side can veto a touch on that earbud. Each is fed only while its
   * own ears have signal (a short gap it bridges itself; past BRIDGE_S it
   * pauses, because a flat line would teach it a floor of nothing), and an
   * ear back from a long absence has its detectors learn the background
   * afresh. One of them speaks for the earbuds: both ears while both are
   * present, otherwise the ear that is. Since all of them keep learning, a
   * handover never waits for one to warm up.
   */
  private step(tickTime: number) {
    this.dec?.pushRaw(this.frame);
    this.advanceBelief();
    this.processed++;
    const p = this.perEar;
    const has = (from: number) => {
      for (let c = from; c < from + p; c++) if (Number.isFinite(this.frame[c])) return true;
      return false;
    };
    const cl = this.coverage.left;
    const cr = this.coverage.right;
    const lHas = has(0);
    const rHas = has(p);
    cl.push(lHas);
    cr.push(rHas);
    const bridge = BRIDGE_S * this.rate;
    for (const [ear, cov, live] of [["left", cl, lHas], ["right", cr, rHas]] as const) {
      if (cov.missingRun > bridge) this.away[ear] = true;
      else if (live && this.away[ear]) {
        this.away[ear] = false;
        this.detectors.both.reset();
        this.fed.both = 0;
        this.detectors[ear].reset();
        this.fed[ear] = 0;
      }
    }
    const leftOk = !this.away.left;
    const rightOk = !this.away.right;
    const events: Partial<Record<ClenchMode, ClenchEvent>> = {};
    const fedNow: Partial<Record<ClenchMode, boolean>> = {};
    const feed = (mode: ClenchMode) => {
      const times = this.feedTimes[mode];
      times[this.fed[mode] % times.length] = tickTime;
      const e = this.detectors[mode].push(this.frame);
      this.fed[mode]++;
      fedNow[mode] = true;
      if (e) events[mode] = e;
    };
    if (leftOk && rightOk) feed("both");
    if (leftOk) feed("left");
    if (rightOk) feed("right");
    // Who speaks: both ears while both are present and that detector has learned, else an ear that is.
    const lp = cl.judged && cl.share >= PRESENT && leftOk;
    const rp = cr.judged && cr.share >= PRESENT && rightOk;
    const d = this.detectors;
    const next: ClenchMode | null = lp && rp && d.both.ready ? "both" : lp && d.left.ready ? "left" : rp && d.right.ready ? "right" : null;
    // A gesture already under way finishes on the detector that heard it
    // start, as long as that detector is still being fed: handing over in
    // the middle would lose it, or split a double into two singles.
    const finishing = this.mode !== null && next !== this.mode && fedNow[this.mode] && d[this.mode].busy;
    // This tick's report comes from whoever spoke as it began, so a gesture
    // that completes on the very tick of a handover is not lost.
    const was = this.mode;
    if (!finishing) this.mode = next;
    // Withdrawals from the detector that speaks; the others' never reached anyone.
    const speaking = was ?? this.mode;
    for (const m of ["both", "left", "right"] as const) {
      const ws = this.detectors[m].takeWithdrawals();
      if (m === speaking) for (const w of ws) for (const cb of this.withdrawListeners) cb(w);
    }
    const source = was && events[was] ? was : this.mode && events[this.mode] ? this.mode : null;
    const e = source ? events[source] : undefined;
    if (!e || !source) return;
    // A detector that joined late may report the tail of a gesture another
    // one already reported: if it began before that report, it is the same
    // gesture, seen again.
    const times = this.feedTimes[source];
    const onsetIndex = Math.round(e.time * this.rate);
    const onset = this.fed[source] - onsetIndex <= times.length ? times[onsetIndex % times.length] : -Infinity;
    if (onset < this.lastReport) return;
    this.lastReport = tickTime;
    // Reported on the detector's own timeline, plus how far the read out trails the phone's clock.
    const lag = Math.max(0, this.now() - tickTime);
    const latencyMs = Math.round((this.fed[source] / this.rate - e.time) * 1000 + lag);
    for (const cb of this.listeners) cb(e, { latencyMs, ears: source, k: this.detectors[source].k });
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

  /**
   * Each earbud that has said hello, by the side it named ("single" for a
   * dev kit carrying both ears): what its HELLO announced, and the battery,
   * wear and lead off it last reported.
   */
  get earbuds(): Partial<Record<Side, EarbudInfo>> {
    const out: Partial<Record<Side, EarbudInfo>> = {};
    for (const [side, d] of this.devices) {
      out[side] = {
        ...d,
        labels: [...d.labels],
        battery: this.battery[side === "right" ? "right" : "left"],
        worn: this.worn.get(side) ?? null,
        leadOff: this.contact.get(side) ?? null,
      };
    }
    return out;
  }

  snapshot(): SessionSnapshot {
    const now = this.now();
    // A dev kit carries both ears through one decoder: its numbers are both ears'.
    const kit = this.streams.has("single") || this.sync.has("single");
    const ear = (e: Ear): EarStats => {
      const st = this.ssp[kit ? "left" : e].stats;
      const a = this.arrivals[e];
      let n = 0;
      for (let i = a.length - 2; i >= 0; i -= 2) {
        if (a[i] < now - RATE_WINDOW_MS) break;
        n += a[i + 1];
      }
      const sync = this.sync.get(e) ?? this.sync.get("single");
      // The fit holds the slope at exactly 1 until it has seen enough time.
      const driftPpm = !sync || sync.driftPpm === 0 ? null : sync.driftPpm;
      return { frames: st.frames, lost: st.lost, rate: Math.round((n * 1000) / RATE_WINDOW_MS), driftPpm, battery: this.battery[kit ? "left" : e], leadOff: this.leadOff[kit ? "left" : e] };
    };
    const d = this.dec?.decide(DECIDE_S) ?? null;
    const eeg = d ? { talker: d.talker, margin: d.margin } : null;
    const yaw = this.yaw;
    const belief = this.dec && this.belief ? this.belief.probabilities : null;
    const posterior = fuseAttention({ azimuthsDeg: this.azimuths, yawDeg: yaw ?? undefined, belief });
    return { ears: { left: ear("left"), right: ear("right") }, yaw, eeg, belief, posterior, clench: this.mode, warning: this.warn };
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
