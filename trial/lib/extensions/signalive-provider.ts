import type { ClenchEvent } from "@sense/clench";
import type { AnyDecoderModel } from "@sense/decoders";
import { NativeBridgeTransport, inNativeShell } from "@sense/native-bridge";
import { encodeCommand, type HostCommand, type Side } from "@sense/protocol";
import { PhoneSession, type ClenchMode, type Ear, type EarbudInfo, type SessionSnapshot } from "@sense/session";
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
 * - bluetooth: real earbuds over Web Bluetooth, one chooser pick per earbud,
 *   or, inside the Signalive app (mobile/), over the phone's own Bluetooth
 *   through window.SignaliveNative, both earbuds from one scan;
 * - cyton: an OpenBCI Cyton board over Web Serial, both ears on one board.
 *
 * The provider keeps the transport and the connection; everything from the
 * bytes on is one PhoneSession (lib/sense/session.ts), the phone side as it
 * will ship. It decodes each earbud's frames, puts both ears on one timeline
 * on the phone's clock, and runs the clench detector on both ears, or on one
 * ear alone while the other is weak or gone. A single clench goes out as
 * jaw_clench, a double as jaw_double_clench and a held one as jaw_hold,
 * through the same gesture bus as the J, K and H keys, so the bound commands
 * run exactly as they do for them. The session's head yaw, from the IMU, is
 * what the head tracker follows.
 *
 * When the earbuds also send speech envelopes (AUDIO_ENV) and a decoder
 * model is there, the session's attention decoder runs as well, its running
 * belief weighed against where the head points, and the provider steers the
 * earbuds' own audio (STEER). Real earbuds get the learned decoder
 * (lib/client/earbuds.ts fetches it as they connect, useDecoderModel hands
 * it over); the simulation and the board send no envelopes.
 *
 * Everything stays in this tab: samples are processed as they arrive and
 * then dropped, and the view holds only counts and the latest state.
 */

export type SignaliveTransport = "simulated" | "bluetooth" | "cyton";
export type SignaliveError = "unsupported" | "cancelled" | "blocked" | "not_found" | "failed";

/**
 * What an earbud has said about itself, as the session keeps it: its
 * electrodes and rates, battery, wear and lead off (each null until
 * reported), and whether its frames are simulated.
 */
export type EarbudState = EarbudInfo;

export interface SignaliveView {
  phase: "off" | "connecting" | "connected";
  /** Earbuds that have said hello, by side ("single" for one device carrying both ears). */
  earbuds: Partial<Record<Side, EarbudState>>;
  /** Frames decoded and frames lost on the way, all earbuds together. */
  frames: number;
  lost: number;
  /** Head yaw from the IMU, whole degrees, right positive; null when none has reported lately. */
  yaw: number | null;
  /** The clench detector has learned the background and is listening. */
  listening: boolean;
  /** Which ears it listens to: both, or one alone while the other is weak or gone; null while it learns. */
  clench: ClenchMode | null;
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
  /** A trained attention decoder (exported by research/aad), linear or learned; one can also come later, by useDecoderModel. */
  decoderModel?: AnyDecoderModel;
  /**
   * Where the talkers are in the room for the decoder, degrees, 0 ahead and
   * positive to the right. Default: the simulated earbuds' own, else the
   * session's (one voice on each side).
   */
  azimuths?: number[];
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
  clench: null,
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
/** Real earbuds run at the protocol's design target until their HELLO says otherwise. */
const EARBUD_RATE = 250;
/**
 * Electrodes per ear, the protocol's design target: the simulated earbuds
 * have four and a Cyton is wired four to each ear. The session reads that
 * many from each earbud, and splits a device carrying both ears down the
 * middle.
 */
const PER_EAR = 4;

const TRANSPORT: Record<SignaliveTransport, SensorCapabilities["transport"]> = {
  simulated: "simulated",
  bluetooth: "web-bluetooth",
  cyton: "web-serial",
};

/** The view's counts refresh this often; gestures and yaw go out as they happen. */
const PUBLISH_MS = 250;
/** An earbud that streams without having said hello is asked again, at most this often. */
const HELLO_RETRY_MS = 1000;
/** A stream() consumer that falls behind loses its oldest frames past this many. */
const STREAM_QUEUE = 2000;
/** Attention is read from the session, and the earbuds steered when it changes, this often. */
const DECIDE_MS = 1000;

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

/* ---- The provider ------------------------------------------------------------ */

type Subscriber = { push(s: SensorSample): void; end(): void };

function errorCode(err: unknown): SignaliveError {
  // The app's own scan found nothing: not a chooser the person closed.
  if ((err as { code?: unknown } | null)?.code === "not_found") return "not_found";
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

/** The electrodes the session reads from a side, in order: four from an earbud, eight from a device carrying both ears. */
function readOf(side: Side, labels: string[]): string[] {
  return labels.slice(0, side === "single" ? 2 * PER_EAR : PER_EAR);
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
  private model: AnyDecoderModel | null;
  /** Envelopes can come: the earbuds' microphones send them, the board has none, the twin only when given some. */
  private readonly envelopes: boolean;
  /** The EEG rate the session starts at; the earbuds' HELLO wins. */
  private readonly rate: number;
  private readonly azimuths: number[] | undefined;
  /** The phone side, from bytes to clenches, yaw and attention: a fresh one for every connection. */
  private session: PhoneSession;
  /** Every side bytes have come from, and when it was last asked for a HELLO. */
  private sides = new Map<Side, number>();
  /** The side whose bytes the session is reading: its callbacks name ears, the stream names sides. */
  private feeding: Side = "single";
  /** One delivery's EEG for stream(), per ear, interleaved by sample, with the first sample's time. */
  private pending: Record<Ear, { t: number; values: number[] } | null> = { left: null, right: null };
  private publishedAt = -Infinity;
  private decidedAt = -Infinity;
  private steered = "";
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
          ? !opts.bluetooth && inNativeShell()
            ? new NativeBridgeTransport()
            : new WebBluetoothTransport({ bluetooth: opts.bluetooth })
          : new CytonSerialTransport({ serial: opts.serial, labels: CYTON_LABELS });
    }
    const twin = this.twin;
    this.now = opts.now ?? (opts.clock && twin ? () => twin.time : () => performance.now());
    this.envelopes = opts.transport !== "cyton" && (opts.transport !== "simulated" || Boolean(opts.twin?.audio));
    this.rate =
      opts.transport === "simulated"
        ? Math.round(opts.twin?.eegRate ?? opts.twin?.recording?.fs ?? SIM_RATE)
        : opts.transport === "cyton"
          ? CYTON_RATE
          : EARBUD_RATE;
    this.azimuths = opts.azimuths ?? opts.twin?.audio?.azimuths;
    this.session = this.newSession();
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
    for (const [side, b] of Object.entries(this.session.earbuds) as [Side, EarbudState][]) {
      for (const label of readOf(side, b.labels)) channels.push({ id: `${side}:${label}`, kind: "eeg", rateHz: b.eegRate, unit: "uV" });
      if (b.imuRate > 0) channels.push({ id: `${side}:yaw`, kind: "imu", rateHz: b.imuRate, unit: "deg" });
    }
    return {
      channels: channels.length ? channels : this.expectedChannels(),
      gestures: ["jaw_clench", "jaw_double_clench", "jaw_hold"],
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

  /** Attention is decoded: a model is there and envelopes can come. */
  private get decodes(): boolean {
    return this.model !== null && this.envelopes;
  }

  /**
   * A decoder model that arrived after connecting (the learned one is
   * fetched while the earbuds connect, so the chooser never waits for it).
   * The session's decoder starts on the next tick.
   */
  useDecoderModel(model: AnyDecoderModel | null): void {
    this.model = model;
    this.session.setModel(this.decodes ? model : null);
  }

  /** Bluetooth: each earbud is its own device, so the second one needs a second pick, from another tap. */
  async addEarbud(): Promise<void> {
    const t = this.transport;
    if (!(t instanceof WebBluetoothTransport || t instanceof NativeBridgeTransport) || this.view.get().phase !== "connected") return;
    try {
      await t.addDevice();
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

  /** Head yaw now, degrees, right positive, both earbuds' motion sensors together; null when none has reported lately. */
  get yaw(): number | null {
    return this.session.yaw;
  }

  /** Called with that head yaw at every motion frame, from either earbud. */
  onYaw(listener: (deg: number) => void): () => void {
    this.yawListeners.add(listener);
    return () => this.yawListeners.delete(listener);
  }

  /* ---- Bytes in ------------------------------------------------------------ */

  private onBytes = (bytes: Uint8Array, side: Side) => {
    if (!this.sides.has(side)) this.sides.set(side, -Infinity);
    this.feeding = side;
    this.session.bytes(bytes, side);
    this.flush(side);
    this.publish();
  };

  private newSession(): PhoneSession {
    const session = new PhoneSession({
      fs: this.rate,
      perEar: PER_EAR,
      model: (this.decodes && this.model) || undefined,
      azimuths: this.azimuths,
      now: this.now,
    });
    session.onClench((e, { k }) => this.gesture(e, k));
    session.onSamples((ear, uv, t) => this.sample(ear, uv, t));
    session.onMotion((_ear, yaw, t) => this.motion(yaw, t));
    return session;
  }

  /**
   * Confidence is how far the clench cleared the threshold of the detector
   * that found it (k times the background, on the weaker side, and higher
   * for one ear alone): 0 at the threshold, 0.5 at twice it, nearing 1
   * beyond.
   */
  private gesture(e: ClenchEvent, k: number) {
    const confidence = Math.max(0, Math.min(1, 1 - k / e.strength));
    emitSensorGesture(e.kind === "single" ? "jaw_clench" : e.kind === "double" ? "jaw_double_clench" : "jaw_hold", this.id, Math.round(confidence * 100) / 100);
  }

  /** An earbud that streams without having said hello is asked again, at most once a second. */
  private askHello(earbuds: Partial<Record<Side, EarbudState>>, now: number) {
    for (const [side, askedAt] of this.sides) {
      if (earbuds[side] || now - askedAt < HELLO_RETRY_MS) continue;
      this.sides.set(side, now);
      this.command(side, { op: "hello" });
    }
  }

  private command(side: Side, command: HostCommand) {
    const bytes = encodeCommand(command, { side, seq: this.seq++ & 0xffff, timestamp: Math.round(this.now() * 1000) });
    void this.transport.send?.(side, bytes).catch(() => undefined);
  }

  /* ---- Attention, when a model and envelopes are both there --------------- */

  /**
   * The session's verdict, once its decoder has one over the electrodes the
   * model reads: the likeliest talker, EEG and head together, and its STEER
   * to both earbuds whenever the direction or the emphasis changes.
   */
  private attend(s: SessionSnapshot, earbuds: Partial<Record<Side, EarbudState>>) {
    if (!s.eeg || !this.fits(earbuds)) return;
    const p = s.posterior;
    let top = 0;
    for (let i = 1; i < p.length; i++) if (p[i]! > p[top]!) top = i;
    const azimuthDeg = this.session.azimuths[top] ?? 0;
    this.view.set({ attention: { talker: top, azimuthDeg, confidence: Math.round((p[top] ?? 0) * 100) / 100 } });
    const steer = this.session.steer(p);
    const key = steer.join(",");
    if (key === this.steered) return;
    this.steered = key;
    void this.transport.send?.("single", steer).catch(() => undefined);
  }

  /**
   * The model reads electrodes by name, in the order of the session's frames:
   * the left ear's four and then the right's, or the own order of a device
   * carrying both ears. Earbuds with other electrodes, or in another order,
   * are not decoded.
   */
  private fits(earbuds: Partial<Record<Side, EarbudState>>): boolean {
    const inputs = this.model?.inputs ?? [];
    const ear = (labels: string[] = []) => Array.from({ length: PER_EAR }, (_, i) => labels[i]);
    const frame = earbuds.single ? readOf("single", earbuds.single.labels) : [...ear(earbuds.left?.labels), ...ear(earbuds.right?.labels)];
    return inputs.length > 0 && inputs.every((name, i) => name === frame[i]);
  }

  /* ---- Out ---------------------------------------------------------------- */

  /** One ear's EEG sample, kept for stream() until the session has read the whole delivery. */
  private sample(ear: Ear, uv: number[], t: number) {
    if (!this.subscribers.size) return;
    const p = (this.pending[ear] ??= { t, values: [] });
    for (const v of uv) p.values.push(v);
  }

  /**
   * A delivery's EEG for stream(), one sample per channel, named as the
   * earbud named its electrodes; nothing before its HELLO. A device carrying
   * both ears sends its left half and then its right.
   */
  private flush(side: Side) {
    const { left, right } = this.pending;
    if (!left && !right) return;
    this.pending = { left: null, right: null };
    const labels = this.session.earbuds[side]?.labels;
    if (!labels) return;
    for (const [p, offset] of [
      [left, 0],
      [right, side === "single" ? PER_EAR : 0],
    ] as const) {
      if (!p) continue;
      const n = p.values.length / PER_EAR;
      for (let c = 0; c < PER_EAR; c++) {
        const label = labels[offset + c];
        if (label === undefined) continue;
        const values = new Float32Array(n);
        for (let s = 0; s < n; s++) values[s] = p.values[s * PER_EAR + c]!;
        this.offer({ channelId: `${side}:${label}`, t: p.t, values });
      }
    }
  }

  /** A motion frame: its yaw samples for stream(), and the session's yaw, both earbuds together, for the head tracker. */
  private motion(yaw: number[], t: number) {
    if (this.subscribers.size) this.offer({ channelId: `${this.feeding}:yaw`, t, values: Float32Array.from(yaw) });
    const deg = this.session.yaw;
    if (deg === null) return;
    for (const l of this.yawListeners) l(deg);
  }

  private offer(s: SensorSample) {
    for (const sub of this.subscribers) sub.push(s);
  }

  /**
   * The view, from the session's snapshot, as bytes arrive and at most this
   * often. The snapshot shows a device carrying both ears on both of them,
   * so its numbers count once.
   */
  private publish() {
    const now = this.now();
    if (now - this.publishedAt < PUBLISH_MS) return;
    this.publishedAt = now;
    const s = this.session.snapshot();
    const earbuds = this.session.earbuds;
    const both = !this.sides.has("single");
    const count = (k: "frames" | "lost") => s.ears.left[k] + (both ? s.ears.right[k] : 0);
    this.view.set({
      earbuds,
      frames: count("frames"),
      lost: count("lost"),
      yaw: s.yaw === null ? null : Math.round(s.yaw),
      listening: s.clench !== null,
      clench: s.clench,
    });
    this.askHello(earbuds, now);
    if (this.decodes && now - this.decidedAt >= DECIDE_MS) {
      this.decidedAt = now;
      this.attend(s, earbuds);
    }
  }

  private reset() {
    this.session = this.newSession();
    this.sides = new Map();
    this.pending = { left: null, right: null };
    this.publishedAt = -Infinity;
    this.decidedAt = -Infinity;
    this.steered = "";
  }
}
