import { ClenchDetector, type ClenchEvent } from "@sense/clench";
import { AttentionDecoder, type DecoderModel } from "@sense/decoder";
import { fuseAttention } from "@sense/fusion";
import { GainController } from "@sense/gain";
import {
  ClockSync,
  ClockUnwrap,
  ENV_RATE,
  EarAligner,
  EegStream,
  EventCode,
  Flag,
  SspDecoder,
  encodeCommand,
  imuSamples,
  yawDeg,
  type AudioEnvFrame,
  type EegChunk,
  type EegFrame,
  type EventFrame,
  type HelloFrame,
  type HostCommand,
  type ImuFrame,
  type Side,
  type SspFrame,
} from "@sense/protocol";
import {
  CytonSerialTransport,
  TwinTransport,
  WebBluetoothTransport,
  type BluetoothLike,
  type SerialLike,
  type Transport,
} from "@sense/transport";
import { DigitalTwin, type TwinClock, type TwinOptions, type TwinRecording } from "@sense/twin";
import { createStore, type Store } from "@/lib/client/store";
import type { AttentionSignalProvider } from "./attention-provider";
import {
  emitSensorGesture,
  type SensorCapabilities,
  type SensorChannel,
  type SensorProvider,
  type SensorSample,
} from "./sensor-provider";

/**
 * The Signalive earbuds as a SensorProvider: the phone side software in
 * lib/sense (shared with the site, imported as @sense/*) behind the trial's
 * extension point. Three transports deliver the same SSP frames
 * (hardware/PROTOCOL.md at the repo root):
 *
 * - simulated: the digital twin, a pair of emulated earbuds playing a
 *   synthetic background, which clench and turn their head on request;
 * - bluetooth: real earbuds over Web Bluetooth, one chooser pick per earbud;
 * - cyton: an OpenBCI Cyton board over Web Serial, both ears on one board.
 *
 * Each earbud's bytes are decoded on their own, its clock is mapped onto the
 * phone's, and left and right samples are lined up by time into frames of
 * both ears. The clench detector reads those frames: a single clench goes out
 * as jaw_clench and a double as jaw_double_clench, through the same gesture
 * bus as the J and K keys, so the bound commands run exactly as they do for
 * them. A hold is detected but not published: no gesture is defined for it
 * yet. Head yaw comes from the IMU's quaternion, for the head tracker.
 *
 * When the earbuds also send speech envelopes (AUDIO_ENV) and a trained
 * decoder model is passed in, the attention decoder runs as well, weighed
 * against where the head points, and steers the earbuds' own audio (STEER).
 * The trial ships no model, so that path is off unless one is given.
 *
 * Everything stays in this tab: samples are processed as they arrive and
 * then dropped, and the view holds only counts and the latest state.
 */

export type SignaliveTransport = "simulated" | "bluetooth" | "cyton";
export type SignaliveError = "unsupported" | "cancelled" | "blocked" | "failed";

export interface EarbudState {
  /** Percent; null when not reported. */
  battery: number | null;
  /** In the ear, from the wear event; null when not reported. */
  worn: boolean | null;
  /** Bit i set while electrode i has no contact; null until the earbud reports lead off at all. */
  leadOff: number | null;
  labels: string[];
  eegRate: number;
  imuRate: number;
  /** Frames made by the digital twin, never by hardware. */
  simulated: boolean;
}

export interface SignaliveView {
  phase: "off" | "connecting" | "connected";
  /** Earbuds that have said hello, by side ("single" for one device carrying both ears). */
  earbuds: Partial<Record<Side, EarbudState>>;
  /** Frames decoded and frames lost on the way, all earbuds together. */
  frames: number;
  lost: number;
  /** Head yaw from the IMU, whole degrees, right positive; null without one. */
  yaw: number | null;
  /** The clench detector has learned the background and is listening. */
  listening: boolean;
  /** The decoder's latest choice, weighed with the head direction; only with a model and speech envelopes. */
  attention: { talker: number; azimuthDeg: number; confidence: number } | null;
  error: SignaliveError | null;
}

export interface SignaliveOptions {
  transport: SignaliveTransport;
  /** Simulated: the twin's clock. Tests pass manualClock and call twin.tick(). Default: real timers. */
  clock?: TwinClock;
  /** Simulated: anything else for the twin (a recording, speech envelopes, loss). */
  twin?: Partial<TwinOptions>;
  /** Simulated: the background's seed. */
  seed?: number;
  /** The phone's clock, ms. Default performance.now(); with a twin clock given, the twin's own time. */
  now?: () => number;
  /** A trained attention decoder (exported by research/aad). Without one, attention is never decoded. */
  decoderModel?: DecoderModel;
  /** Stand-ins for navigator.bluetooth and navigator.serial, for tests. */
  bluetooth?: BluetoothLike;
  serial?: SerialLike;
}

const OFF: SignaliveView = {
  phase: "off",
  earbuds: {},
  frames: 0,
  lost: 0,
  yaw: null,
  listening: false,
  attention: null,
  error: null,
};

/** The simulated earbuds: four electrodes each, at the protocol's higher rate. */
const SIM_RATE = 500;
const SIM_LABELS = ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4"];
const SIM_SIDES = { left: [0, 1, 2, 3], right: [4, 5, 6, 7] };
/** A whole number of seconds, so the 10 Hz rhythm meets itself where the loop starts again. */
const SIM_SECONDS = 180;
/** How a Cyton is wired for the trial: inputs 1 to 4 on the left ear, 5 to 8 on the right. */
const CYTON_LABELS = SIM_LABELS;
const CYTON_RATE = 250;

const TRANSPORT: Record<SignaliveTransport, SensorCapabilities["transport"]> = {
  simulated: "simulated",
  bluetooth: "web-bluetooth",
  cyton: "web-serial",
};

/** The view's counts refresh this often; gestures and yaw go out as they happen. */
const PUBLISH_MS = 250;
/**
 * A silent earbud holds the other one back this long, then its electrodes
 * count as missing. Missing for longer, an ear is kept away from the clench
 * detector, which learns the background again once both ears are back: a
 * floor learned from one silent ear would read the ear's return as a clench
 * that never ends.
 */
const PAIR_WAIT_MS = 250;
/**
 * Contiguous samples keep their spacing on the phone's clock; the earbud's
 * clock map moves them only when the two disagree by more than this. The map
 * shifts by a few ms at a time while it finds the earliest arrivals, and
 * following each shift would make the samples' times overlap.
 */
const SNAP_MS = 8;
/** IMU frames from the other earbud take over once the one in use has been quiet this long. */
const IMU_HANDOVER_MS = 500;
/** An earbud that streams without having said hello is asked again, at most this often. */
const HELLO_RETRY_MS = 1000;
/** A stream() consumer that falls behind loses its oldest frames past this many. */
const STREAM_QUEUE = 2000;
/** Attention: decide over this window, this often, and steer by this much at most (lib/sense/gain.ts). */
const DECISION_WINDOW_S = 5;
const DECIDE_EVERY_S = 1;
const GAIN_STEPS = 4;
const GAIN_MAX_DB = 9;
/** Speech envelopes missing for longer than this restart the decoder instead of being bridged. */
const MAX_ENV_GAP_S = 30;

/* ---- The simulated background ---------------------------------------------- */

/** Seeded standard normal samples: mulberry32 through Box and Muller. */
function gaussian(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

/**
 * What the simulated earbuds pick up at rest, on four electrodes per ear:
 * seeded noise of 5 uV RMS and a 10 Hz rhythm of 10 uV, at 500 Hz, three
 * minutes long. The twin loops it and adds jaw muscle activity on a clench.
 */
export function syntheticBackground(seed = 1, seconds = SIM_SECONDS): TwinRecording {
  const n = Math.round(seconds) * SIM_RATE;
  const noise = gaussian(seed);
  const data = SIM_LABELS.map((_, c) => {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = 5 * noise() + 10 * Math.sin((2 * Math.PI * 10 * i) / SIM_RATE + 0.3 * c);
    return d;
  });
  return { fs: SIM_RATE, labels: SIM_LABELS, data };
}

/* ---- Ears ------------------------------------------------------------------ */

/** A single device's electrodes by ear: labels starting with L or R, else the first half and the second. */
function earsOf(labels: string[]): { left: number[]; right: number[] } {
  const left: number[] = [];
  const right: number[] = [];
  labels.forEach((label, i) => {
    const c = label[0]?.toUpperCase();
    if (c === "L") left.push(i);
    else if (c === "R") right.push(i);
  });
  if (left.length && right.length) return { left, right };
  const half = labels.length >> 1;
  return { left: labels.slice(0, half).map((_, i) => i), right: labels.slice(half).map((_, i) => half + i) };
}

/* ---- The provider ------------------------------------------------------------ */

interface Ear {
  side: Side;
  decoder: SspDecoder;
  unwrap: ClockUnwrap;
  sync: ClockSync;
  hello: HelloFrame | null;
  eeg: EegStream | null;
  /** Phone time the next EEG sample is due, from the samples before it. */
  next: number;
  state: EarbudState;
  askedAt: number;
}

interface Layout {
  key: string;
  fs: number;
  /** The channels of a frame of both ears, in order, and which of them are on each ear. */
  labels: string[];
  ears: { left: number[]; right: number[] };
  /** Two earbuds, paired by time (lib/sense); null for one device carrying both ears. */
  aligner: EarAligner | null;
  frame: Float64Array;
  detector: ClenchDetector | null;
  /** Consecutive frames with an ear missing, and whether the detector must start over. */
  missing: number;
  stale: boolean;
}

interface Attention {
  decoder: AttentionDecoder;
  /** Frame channel of each model input. */
  order: number[];
  raw: Float64Array;
  azimuths: number[];
  /** Phone time of the first raw frame; envelopes join the decoder's timeline there. */
  start: number;
  /** Phone time the next envelope sample is due, for bridging gaps. */
  next: number;
  pending: { t0: number; frame: AudioEnvFrame }[];
  frames: number;
  gain: GainController;
  steered: string;
}

type Subscriber = { push(s: SensorSample): void; end(): void };

function errorCode(err: unknown): SignaliveError {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "NotFoundError" || name === "AbortError") return "cancelled";
  if (name === "SecurityError" || name === "NotAllowedError") return "blocked";
  if (err instanceof Error && /not available/i.test(err.message)) return "unsupported";
  return "failed";
}

/** The id a decoded talker would have in the SourceStage, once separated voices are registered there. */
export function talkerSourceId(talker: number): string {
  return `earbuds:talker${talker}`;
}

export class SignaliveSensorProvider implements SensorProvider {
  readonly id = "signalive";
  readonly kind: SignaliveTransport;
  readonly view: Store<SignaliveView> = createStore<SignaliveView>(OFF);
  /** The simulated earbuds, for the clench and head turn buttons; null on hardware. */
  readonly twin: DigitalTwin | null;
  /** What the earbuds decode, for an audio path that registers the talkers' voices. */
  readonly attention: AttentionSignalProvider;

  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly model: DecoderModel | null;
  private readonly decodes: boolean;
  private ears: Partial<Record<Side, Ear>> = {};
  private layout: Layout | null = null;
  private att: Attention | null = null;
  private yawNow: number | null = null;
  private imuSide: Side | null = null;
  private imuAt = -Infinity;
  private publishedAt = -Infinity;
  private seq = 0;
  private readonly yawListeners = new Set<(deg: number) => void>();
  private readonly subscribers = new Set<Subscriber>();

  constructor(opts: SignaliveOptions) {
    this.kind = opts.transport;
    this.model = opts.decoderModel ?? null;
    if (opts.transport === "simulated") {
      this.twin = new DigitalTwin({
        recording: syntheticBackground(opts.seed),
        sides: SIM_SIDES,
        seed: opts.seed,
        clock: opts.clock,
        ...opts.twin,
      });
      this.transport = new TwinTransport(this.twin);
    } else {
      this.twin = null;
      this.transport =
        opts.transport === "bluetooth"
          ? new WebBluetoothTransport({ bluetooth: opts.bluetooth })
          : new CytonSerialTransport({ serial: opts.serial, labels: CYTON_LABELS });
    }
    const twin = this.twin;
    this.now = opts.now ?? (opts.clock && twin ? () => twin.time : () => performance.now());
    // Envelopes come from the earbuds' microphones: the board has none, and the twin only plays them when given some.
    this.decodes = this.model !== null && opts.transport !== "cyton" && (opts.transport !== "simulated" || Boolean(opts.twin?.audio));
    this.attention = {
      id: "signalive-decoder",
      currentAttendedSource: () => {
        const a = this.view.get().attention;
        return a ? { sourceId: talkerSourceId(a.talker), confidence: a.confidence } : null;
      },
    };
  }

  /** What is coming in: the channels each earbud announced, or before that, what this transport carries. */
  get capabilities(): SensorCapabilities {
    const channels: SensorChannel[] = [];
    for (const ear of Object.values(this.ears)) {
      const h = ear.hello;
      if (!h) continue;
      for (const label of h.labels) channels.push({ id: `${ear.side}:${label}`, kind: "eeg", rateHz: h.eegRate, unit: "uV" });
      if (h.imuRate > 0) channels.push({ id: `${ear.side}:yaw`, kind: "imu", rateHz: h.imuRate, unit: "deg" });
    }
    return {
      channels: channels.length ? channels : this.expectedChannels(),
      gestures: ["jaw_clench", "jaw_double_clench"],
      attention: this.decodes,
      transport: TRANSPORT[this.kind],
    };
  }

  /** Real earbuds say what they carry in their HELLO; until then there is nothing to report. */
  private expectedChannels(): SensorChannel[] {
    if (this.kind === "bluetooth") return [];
    const rate = this.kind === "simulated" ? SIM_RATE : CYTON_RATE;
    const eeg = (side: Side, labels: string[]) => labels.map((l): SensorChannel => ({ id: `${side}:${l}`, kind: "eeg", rateHz: rate, unit: "uV" }));
    if (this.kind === "cyton") return eeg("single", CYTON_LABELS);
    const yaw = (side: Side): SensorChannel => ({ id: `${side}:yaw`, kind: "imu", rateHz: 100, unit: "deg" });
    return [...eeg("left", SIM_LABELS.slice(0, 4)), yaw("left"), ...eeg("right", SIM_LABELS.slice(4)), yaw("right")];
  }

  /**
   * Opens the transport: the twin starts at once; Bluetooth and Serial open
   * the browser's chooser, so this must run from a tap. Rejects when nothing
   * was connected; the view's error says why.
   */
  async connect(): Promise<void> {
    if (this.view.get().phase !== "off") return;
    this.reset();
    this.view.set({ ...OFF, phase: "connecting" });
    try {
      await this.transport.connect(this.onBytes);
    } catch (err) {
      await this.transport.disconnect().catch(() => undefined);
      this.view.set({ phase: "off", error: errorCode(err) });
      throw err;
    }
    // Disconnected while the chooser was open.
    if (this.view.get().phase !== "connecting") await this.transport.disconnect();
    else this.view.set({ phase: "connected" });
  }

  /** Bluetooth: each earbud is its own device, so the second one needs a second pick, from another tap. */
  async addEarbud(): Promise<void> {
    if (!(this.transport instanceof WebBluetoothTransport) || this.view.get().phase !== "connected") return;
    try {
      await this.transport.addDevice();
      this.view.set({ error: null });
    } catch (err) {
      this.view.set({ error: errorCode(err) });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.view.get().phase === "off") return;
    this.view.set({ phase: "off" });
    try {
      await this.transport.disconnect();
    } finally {
      for (const s of this.subscribers) s.end();
      this.reset();
      this.view.set({ ...OFF });
    }
  }

  /** Every channel's samples as they arrive, microvolts and degrees; ends at disconnect. */
  async *stream(): AsyncIterable<SensorSample> {
    const queue: SensorSample[] = [];
    let done = false;
    let wake: (() => void) | null = null;
    const sub: Subscriber = {
      push: (s) => {
        if (queue.push(s) > STREAM_QUEUE) queue.shift();
        wake?.();
      },
      end: () => {
        done = true;
        wake?.();
      },
    };
    this.subscribers.add(sub);
    try {
      for (;;) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (done) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    } finally {
      this.subscribers.delete(sub);
    }
  }

  /** Head yaw now, degrees, right positive; null before the first IMU frame. */
  get yaw(): number | null {
    return this.yawNow;
  }

  /** Called with every IMU frame's latest yaw, from one earbud at a time. */
  onYaw(listener: (deg: number) => void): () => void {
    this.yawListeners.add(listener);
    return () => this.yawListeners.delete(listener);
  }

  /* ---- Frames ------------------------------------------------------------- */

  private onBytes = (bytes: Uint8Array, side: Side) => {
    const ear = (this.ears[side] ??= this.newEar(side));
    for (const f of ear.decoder.push(bytes)) this.frame(ear, f);
    this.publish();
  };

  private newEar(side: Side): Ear {
    return {
      side,
      decoder: new SspDecoder(),
      unwrap: new ClockUnwrap(),
      sync: new ClockSync(),
      hello: null,
      eeg: null,
      next: NaN,
      state: { battery: null, worn: null, leadOff: null, labels: [], eegRate: 0, imuRate: 0, simulated: false },
      askedAt: -Infinity,
    };
  }

  /** Commands are the phone's own frames, so only these five come from an earbud. */
  private frame(ear: Ear, f: SspFrame) {
    if (f.type === "hello") this.hello(ear, f);
    else if (f.type === "eeg") this.eeg(ear, f);
    else if (f.type === "imu") this.imu(ear, f);
    else if (f.type === "event") this.event(ear, f);
    else if (f.type === "audioEnv") this.audioEnv(ear, f);
  }

  private hello(ear: Ear, f: HelloFrame) {
    const prev = ear.hello;
    ear.hello = f;
    if (!prev || f.flags & Flag.streamStart || prev.eegRate !== f.eegRate || prev.labels.length !== f.labels.length) {
      ear.eeg = new EegStream(f.eegRate, f.labels.length, f.nvPerLsb);
      ear.next = NaN;
    }
    ear.state = {
      ...ear.state,
      labels: f.labels,
      eegRate: f.eegRate,
      imuRate: f.imuRate,
      battery: f.battery <= 100 ? f.battery : ear.state.battery,
      simulated: (f.flags & Flag.simulated) !== 0,
    };
    this.relayout();
    this.publish(true);
  }

  private eeg(ear: Ear, f: EegFrame) {
    const h = ear.hello;
    if (!h || !ear.eeg) return this.askHello(ear);
    // One unwrap per earbud for every frame type, so EEG and IMU share a timeline.
    const t = ear.unwrap.push(f.timestamp);
    const periodUs = 1e6 / h.eegRate;
    ear.sync.observe(t + (f.samples - 1) * periodUs, this.now());
    const chunk = ear.eeg.push(f);
    if (!chunk) return;
    const period = 1000 / h.eegRate;
    const mapped = ear.sync.toHost(t - chunk.missing * periodUs);
    const t0 = !chunk.restart && Math.abs(mapped - ear.next) <= SNAP_MS ? ear.next : mapped;
    ear.next = t0 + (chunk.data[0]?.length ?? 0) * period;
    if (this.subscribers.size) {
      h.labels.forEach((label, c) => this.offer({ channelId: `${ear.side}:${label}`, t: t0, values: chunk.data[c]! }));
    }
    this.place(ear.side, chunk, t0, period);
  }

  private imu(ear: Ear, f: ImuFrame) {
    const h = ear.hello;
    if (!h) return this.askHello(ear);
    if (!(h.imuRate > 0)) return;
    const t = ear.unwrap.push(f.timestamp);
    const now = this.now();
    ear.sync.observe(t + ((f.samples - 1) * 1e6) / h.imuRate, now);
    const yaws = Float32Array.from(imuSamples(f), (s) => yawDeg(...s.quat));
    if (this.subscribers.size) this.offer({ channelId: `${ear.side}:yaw`, t: ear.sync.toHost(t), values: yaws });
    // Both earbuds see the same head; follow one, and switch only when it goes quiet.
    if (this.imuSide !== null && this.imuSide !== ear.side && now - this.imuAt < IMU_HANDOVER_MS) return;
    this.imuSide = ear.side;
    this.imuAt = now;
    const yaw = yaws[yaws.length - 1]!;
    this.yawNow = yaw;
    for (const l of this.yawListeners) l(yaw);
  }

  private event(ear: Ear, f: EventFrame) {
    if (f.code === EventCode.battery) ear.state = { ...ear.state, battery: f.value <= 100 ? f.value : null };
    else if (f.code === EventCode.wear) ear.state = { ...ear.state, worn: f.value === 1 };
    else if (f.code === EventCode.leadOff) ear.state = { ...ear.state, leadOff: f.value };
    // BUTTON is left alone: earbud buttons reach the app as media keys today.
    else return;
    this.publish(true);
  }

  private askHello(ear: Ear) {
    const now = this.now();
    if (now - ear.askedAt < HELLO_RETRY_MS) return;
    ear.askedAt = now;
    this.command(ear.side, { op: "hello" });
  }

  private command(side: Side, command: HostCommand) {
    const bytes = encodeCommand(command, { side, seq: this.seq++ & 0xffff, timestamp: Math.round(this.now() * 1000) });
    void this.transport.send?.(side, bytes).catch(() => undefined);
  }

  /* ---- Both ears, the clench ---------------------------------------------- */

  /**
   * The frame layout follows the earbuds that have said hello: a left and
   * right pair (at one rate), or one device carrying both ears.
   */
  private relayout() {
    const l = this.ears.left?.hello;
    const r = this.ears.right?.hello;
    const s = this.ears.single?.hello;
    const pair = l && r && l.eegRate === r.eegRate ? { l, r } : null;
    const key = pair ? `pair:${pair.l.eegRate}:${pair.l.labels}|${pair.r.labels}` : s ? `single:${s.eegRate}:${s.labels}` : "";
    if (key === (this.layout?.key ?? "")) return;
    this.att = null;
    if (!key) {
      this.layout = null;
      return;
    }
    const fs = pair ? pair.l.eegRate : s!.eegRate;
    const labels = pair ? [...pair.l.labels, ...pair.r.labels] : s!.labels;
    const nl = pair?.l.labels.length ?? 0;
    const ears = pair ? { left: pair.l.labels.map((_, i) => i), right: pair.r.labels.map((_, i) => nl + i) } : earsOf(labels);
    let detector: ClenchDetector | null = null;
    try {
      detector = new ClenchDetector({ fs, ...ears });
    } catch {
      // A rate too low for the muscle band: no clench from this device.
    }
    this.layout = {
      key,
      fs,
      labels,
      ears,
      aligner: pair ? new EarAligner(fs, [nl, pair.r.labels.length], PAIR_WAIT_MS) : null,
      frame: new Float64Array(labels.length),
      detector,
      missing: 0,
      stale: false,
    };
  }

  private place(side: Side, chunk: EegChunk, t0: number, period: number) {
    const layout = this.layout;
    if (!layout) return;
    const { frame } = layout;
    if (layout.aligner) {
      if (side === "single") return;
      layout.aligner.push(side, t0, chunk.data);
      for (const paired of layout.aligner.pull()) {
        frame.set(paired.values);
        this.both(frame, paired.time);
      }
    } else if (side === "single") {
      const n = chunk.data[0]?.length ?? 0;
      for (let s = 0; s < n; s++) {
        for (let c = 0; c < frame.length; c++) frame[c] = chunk.data[c]![s]!;
        this.both(frame, t0 + s * period);
      }
    }
  }

  /** One frame of both ears, at phone time t. */
  private both(frame: Float64Array, t: number) {
    const layout = this.layout!;
    const detector = layout.detector;
    if (detector) {
      const gone = (idx: number[]) => idx.every((i) => Number.isNaN(frame[i]));
      if (gone(layout.ears.left) || gone(layout.ears.right)) {
        if (++layout.missing * 1000 >= PAIR_WAIT_MS * layout.fs) layout.stale = true;
      } else {
        layout.missing = 0;
        if (layout.stale) {
          layout.stale = false;
          detector.reset();
        }
      }
      if (!layout.stale) {
        const event = detector.push(frame);
        if (event) this.gesture(event);
      }
    }
    if (this.att) this.attentionRaw(this.att, frame, t);
  }

  /**
   * Confidence is how far the clench cleared the detector's threshold (k
   * times the background, on the weaker side): 0 at the threshold, 0.5 at
   * twice it, nearing 1 beyond.
   */
  private gesture(e: ClenchEvent) {
    if (e.kind === "hold") return;
    const k = this.layout?.detector?.k ?? 4;
    const confidence = Math.max(0, Math.min(1, 1 - k / e.strength));
    emitSensorGesture(e.kind === "single" ? "jaw_clench" : "jaw_double_clench", this.id, Math.round(confidence * 100) / 100);
  }

  /* ---- Attention, when a model and envelopes are both there --------------- */

  private audioEnv(ear: Ear, f: AudioEnvFrame) {
    if (!this.decodes || !ear.hello) return;
    const t0 = ear.sync.toHost(ear.unwrap.push(f.timestamp));
    if (!Number.isFinite(t0)) return;
    let a = this.att;
    if (!a || a.decoder.talkers !== f.talkers) a = this.att = this.startAttention(f.talkers, f.azimuths);
    if (!a) return;
    a.azimuths = f.azimuths;
    a.pending.push({ t0, frame: f });
    this.feedEnvelopes(a);
  }

  /** A decoder for this many talkers, if the model reads the electrodes these earbuds have, at their rate. */
  private startAttention(talkers: number, azimuths: number[]): Attention | null {
    const layout = this.layout;
    const model = this.model;
    if (!layout || !model || model.fsRaw !== layout.fs) return null;
    const order = model.inputs.map((name) => layout.labels.indexOf(name));
    if (order.some((i) => i < 0)) return null;
    return {
      decoder: new AttentionDecoder(model, talkers),
      order,
      raw: new Float64Array(order.length),
      azimuths,
      start: NaN,
      next: NaN,
      pending: [],
      frames: 0,
      gain: new GainController({ talkers, steps: GAIN_STEPS, maxBoostDb: GAIN_MAX_DB }),
      steered: "",
    };
  }

  private attentionRaw(a: Attention, frame: Float64Array, t: number) {
    if (Number.isNaN(a.start)) {
      a.start = t;
      this.feedEnvelopes(a);
    }
    for (let i = 0; i < a.order.length; i++) a.raw[i] = frame[a.order[i]!]!;
    a.decoder.pushRaw(a.raw);
    if (++a.frames % Math.round((this.layout?.fs ?? 1) * DECIDE_EVERY_S) === 0) this.decide(a);
  }

  /**
   * The decoder indexes raw frames and envelopes from one instant: the first
   * raw frame. Envelope samples before it are dropped, and lost ones are
   * bridged with NaN (the decoder repeats the last good value) so that every
   * later sample keeps its place.
   */
  private feedEnvelopes(a: Attention) {
    if (Number.isNaN(a.start)) return;
    const step = 1000 / ENV_RATE;
    for (const { t0, frame } of a.pending) {
      const k = frame.talkers;
      for (let j = 0; j < frame.samples; j++) {
        const t = t0 + j * step;
        if (Number.isNaN(a.next)) {
          if (t < a.start - step / 2) continue;
          a.next = t;
        }
        const gap = Math.round((t - a.next) / step);
        if (gap < 0) continue;
        if (gap > MAX_ENV_GAP_S * ENV_RATE) {
          this.att = null;
          return;
        }
        for (let g = 0; g < gap; g++) for (let i = 0; i < k; i++) a.decoder.pushEnvelope(i, NaN);
        for (let i = 0; i < k; i++) a.decoder.pushEnvelope(i, frame.envelopes[j * k + i]!);
        a.next += (gap + 1) * step;
      }
    }
    a.pending.length = 0;
  }

  /**
   * One decision: the decoder's evidence times the prior of facing a talker.
   * The talkers' azimuths are relative to the head, so the head points at 0.
   * The gain walks toward the winner a step at a time, and the earbuds hear
   * about it only when the direction or the gain changes.
   */
  private decide(a: Attention) {
    const d = a.decoder.decide(DECISION_WINDOW_S);
    if (!d) return;
    const p = fuseAttention({ azimuthsDeg: a.azimuths, yawDeg: 0, eeg: { talker: d.talker, margin: d.margin } });
    let top = 0;
    for (let i = 1; i < p.length; i++) if (p[i]! > p[top]!) top = i;
    a.gain.update(top);
    const azimuthDeg = a.azimuths[top] ?? 0;
    const gainDb = Math.max(0, a.gain.gainsDb()[top] ?? 0);
    this.view.set({ attention: { talker: top, azimuthDeg, confidence: Math.round((p[top] ?? 0) * 100) / 100 } });
    const steer = `${azimuthDeg.toFixed(1)}:${gainDb.toFixed(1)}`;
    if (steer === a.steered) return;
    a.steered = steer;
    for (const ear of Object.values(this.ears)) if (ear.hello) this.command(ear.side, { op: "steer", azimuthDeg, gainDb });
  }

  /* ---- Out ---------------------------------------------------------------- */

  private offer(s: SensorSample) {
    for (const sub of this.subscribers) sub.push(s);
  }

  private publish(force = false) {
    const now = this.now();
    if (!force && now - this.publishedAt < PUBLISH_MS) return;
    this.publishedAt = now;
    let frames = 0;
    let lost = 0;
    const earbuds: Partial<Record<Side, EarbudState>> = {};
    for (const ear of Object.values(this.ears)) {
      frames += ear.decoder.stats.frames;
      lost += ear.decoder.stats.lost;
      if (ear.hello) earbuds[ear.side] = ear.state;
    }
    this.view.set({
      earbuds,
      frames,
      lost,
      yaw: this.yawNow === null ? null : Math.round(this.yawNow),
      listening: Boolean(this.layout?.detector?.ready && !this.layout.stale),
    });
  }

  private reset() {
    this.ears = {};
    this.layout = null;
    this.att = null;
    this.yawNow = null;
    this.imuSide = null;
    this.imuAt = -Infinity;
    this.publishedAt = -Infinity;
  }
}
