/**
 * Where SSP bytes come from. The digital twin, real earbuds over Web
 * Bluetooth and an OpenBCI Cyton dev kit over Web Serial all hand the phone
 * the same frames through the same interface, so everything downstream is
 * identical whichever is connected. Give each side its own SspDecoder.
 *
 * The browser's Bluetooth and Serial APIs are not in TypeScript's DOM types,
 * so the few members used here are declared locally; tests pass fakes
 * through the same shapes.
 */
import {
  Flag,
  SSP_COMMANDS_UUID,
  SSP_FRAMES_UUID,
  SSP_SERVICE_UUID,
  decodeCommand,
  decodeFrame,
  encodeCommand,
  encodeFrame,
  maxEegSamples,
  type FrameBody,
  type HostCommand,
  type Side,
  type SspFrame,
} from "./protocol";
import { DigitalTwin, type TwinOptions } from "./twin";

export type OnBytes = (bytes: Uint8Array, side: Side) => void;

export interface Transport {
  readonly name: string;
  connect(onBytes: OnBytes): Promise<void>;
  disconnect(): Promise<void>;
  /** Writes a host command frame (encodeCommand) to one earbud. */
  send?(side: Side, bytes: Uint8Array): Promise<void>;
}

/* ---- Digital twin ---------------------------------------------------------- */

/** The twin on real timers: frames arrive as they would from hardware, in time. */
export class TwinTransport implements Transport {
  readonly name = "Digital twin";
  readonly twin: DigitalTwin;

  constructor(twin: DigitalTwin | TwinOptions) {
    this.twin = twin instanceof DigitalTwin ? twin : new DigitalTwin(twin);
  }

  async connect(onBytes: OnBytes): Promise<void> {
    this.twin.start(onBytes);
  }

  async disconnect(): Promise<void> {
    this.twin.stop();
  }

  async send(side: Side, bytes: Uint8Array): Promise<void> {
    this.twin.command(side, bytes);
  }
}

/* ---- Web Bluetooth --------------------------------------------------------- */

export interface BleCharacteristic extends EventTarget {
  readonly value?: DataView | null;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  writeValueWithResponse?(value: Uint8Array): Promise<void>;
  writeValue(value: Uint8Array): Promise<void>;
}

export interface BleService {
  getCharacteristic(uuid: string): Promise<BleCharacteristic>;
}

export interface BleServer {
  readonly connected: boolean;
  connect(): Promise<BleServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BleService>;
}

export interface BleDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BleServer;
}

export interface BluetoothLike {
  requestDevice(options: { filters: { services?: string[]; namePrefix?: string }[]; optionalServices?: string[] }): Promise<BleDevice>;
}

/** Waits that grow after each failed reconnect, then it gives up. */
const RECONNECT_MS = [500, 1000, 2000, 4000, 8000];

/** One earbud: its connection, its two characteristics, and the side it said it is. */
class Earbud {
  side: Side | null = null;
  private frames: BleCharacteristic | null = null;
  private commands: BleCharacteristic | null = null;
  private seq = 0;
  private closing = false;
  /** GATT takes one operation at a time (a second fails "already in progress"), so they queue here. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly device: BleDevice,
    private readonly onBytes: OnBytes,
    private readonly events: { side(e: Earbud): void; gone(e: Earbud): void },
    private readonly reconnect: boolean,
  ) {
    device.addEventListener("gattserverdisconnected", this.lost);
  }

  /** Connects, subscribes, asks who it is and starts it streaming. */
  async open() {
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(SSP_SERVICE_UUID);
    this.frames = await service.getCharacteristic(SSP_FRAMES_UUID);
    this.commands = await service.getCharacteristic(SSP_COMMANDS_UUID);
    const frames = this.frames;
    frames.removeEventListener("characteristicvaluechanged", this.value);
    frames.addEventListener("characteristicvaluechanged", this.value);
    await this.gatt(() => frames.startNotifications());
    await this.command({ op: "hello" });
    await this.command({ op: "start" });
  }

  async command(command: HostCommand) {
    await this.write(encodeCommand(command, { side: this.side ?? "single", seq: this.seq++ }));
  }

  write(bytes: Uint8Array): Promise<void> {
    return this.gatt(() => {
      const c = this.commands;
      if (!c) throw new Error("earbud not connected");
      return c.writeValueWithResponse ? c.writeValueWithResponse(bytes) : c.writeValue(bytes);
    });
  }

  async close() {
    this.closing = true;
    try {
      await this.command({ op: "stop" });
      const frames = this.frames;
      if (frames) await this.gatt(() => frames.stopNotifications());
    } catch {
      // Already gone: nothing to stop.
    }
    this.dispose();
    this.device.gatt?.disconnect();
  }

  /** Lets go of the device's events, for good. */
  dispose() {
    this.device.removeEventListener("gattserverdisconnected", this.lost);
    this.frames?.removeEventListener("characteristicvaluechanged", this.value);
  }

  private gatt<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.catch(() => {});
    return run;
  }

  /** One notification is one frame; every header names its side, and a HELLO settles it. */
  private value = (ev: Event) => {
    const v = (ev.target as BleCharacteristic).value;
    if (!v) return;
    const bytes = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    const fromHeader: Side | null = bytes.length > 4 && bytes[0] === 0x53 && bytes[1] === 0x4c ? (["left", "right", "single"] as const)[bytes[4]] ?? null : null;
    if (bytes[3] === 0x01) {
      const hello = decodeFrame(bytes);
      if (hello && hello.side !== this.side) {
        this.side = hello.side;
        this.events.side(this);
      }
    }
    const side = this.side ?? fromHeader;
    if (side) this.onBytes(bytes, side);
  };

  /** Tries again with growing waits; after the last one the earbud is given up, and picking it again starts afresh. */
  private lost = async () => {
    if (this.closing) return;
    if (this.reconnect) {
      for (const wait of RECONNECT_MS) {
        await new Promise((r) => setTimeout(r, wait));
        if (this.closing) return;
        try {
          await this.open();
          return;
        } catch {
          // Out of range or busy: wait longer and try again.
        }
      }
    }
    if (!this.closing) this.events.gone(this);
  };
}

/**
 * Real earbuds. Each earbud is its own peripheral, so each needs its own
 * pick in the browser's chooser, and a chooser only opens from a tap:
 * connect() asks for the first, and addDevice() from a second tap asks for
 * the other. A dev kit that is both sides needs only connect(). Each earbud
 * says which side it is in its HELLO; sends go to the earbud of that side.
 * A dropped earbud is reconnected with growing waits; one that stays away is
 * dropped from the list (onLost) and can simply be picked again.
 */
export class WebBluetoothTransport implements Transport {
  readonly name = "Web Bluetooth";
  private readonly earbuds: Earbud[] = [];
  private onBytes: OnBytes | null = null;

  constructor(
    private readonly opts: {
      bluetooth?: BluetoothLike;
      /** Optional chooser narrowing, such as "Signalive". */
      namePrefix?: string;
      /** Reconnect an earbud that drops. Default true. */
      reconnect?: boolean;
      /** Called when an earbud has said which side it is. */
      onSide?: (side: Side) => void;
      /** Called when an earbud is gone for good (side null if it never said). */
      onLost?: (side: Side | null) => void;
    } = {},
  ) {}

  /** The sides connected so far, as their HELLOs named them. */
  get sides(): Side[] {
    return this.earbuds.flatMap((e) => (e.side ? [e.side] : []));
  }

  async connect(onBytes: OnBytes): Promise<void> {
    this.onBytes = onBytes;
    await this.addDevice();
  }

  /** Asks for one more earbud (call from a tap) and starts it streaming. */
  async addDevice(): Promise<void> {
    if (!this.onBytes) throw new Error("connect() first");
    const bt = this.opts.bluetooth ?? (globalThis.navigator as { bluetooth?: BluetoothLike } | undefined)?.bluetooth;
    if (!bt) throw new Error("Web Bluetooth is not available in this browser");
    const filter: { services: string[]; namePrefix?: string } = { services: [SSP_SERVICE_UUID] };
    if (this.opts.namePrefix) filter.namePrefix = this.opts.namePrefix;
    const device = await bt.requestDevice({ filters: [filter], optionalServices: [SSP_SERVICE_UUID] });
    if (this.earbuds.some((e) => e.device.id === device.id)) return;
    const earbud = new Earbud(
      device,
      this.onBytes,
      {
        side: (e) => e.side && this.opts.onSide?.(e.side),
        gone: (e) => {
          this.forget(e);
          this.opts.onLost?.(e.side);
        },
      },
      this.opts.reconnect ?? true,
    );
    this.earbuds.push(earbud);
    try {
      await earbud.open();
    } catch (e) {
      this.forget(earbud);
      await earbud.close();
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.earbuds.map((e) => e.close()));
    this.earbuds.length = 0;
    this.onBytes = null;
  }

  async send(side: Side, bytes: Uint8Array): Promise<void> {
    const targets = side === "single" ? this.earbuds : this.earbuds.filter((e) => e.side === side || e.side === "single");
    if (targets.length === 0) throw new Error(`no ${side} earbud connected`);
    await Promise.all(targets.map((e) => e.write(bytes)));
  }

  private forget(e: Earbud) {
    const i = this.earbuds.indexOf(e);
    if (i >= 0) this.earbuds.splice(i, 1);
    e.dispose();
  }
}

/* ---- OpenBCI Cyton over Web Serial ----------------------------------------- */

export interface SerialPortLike {
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}

export interface SerialLike {
  requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<SerialPortLike>;
}

export const CYTON_PACKET = 33;
export const CYTON_RATE = 250;
/** OpenBCI's own scale for the Cyton at gain 24. */
export const CYTON_UV_PER_COUNT = (4.5 / 24 / (2 ** 23 - 1)) * 1e6;
/** The OpenBCI USB dongle's FTDI chip. */
const FTDI = { usbVendorId: 0x0403, usbProductId: 0x6015 };

export interface CytonPacket {
  /** The board's 8 bit sample counter. */
  sample: number;
  /** Eight channels of raw 24 bit counts. */
  counts: Int32Array;
  microvolts: Float32Array;
  /** Six aux bytes (accelerometer for footer 0xC0), as sent. */
  aux: Uint8Array;
  footer: number;
}

/** One 33 byte Cyton packet at bytes[at]: 0xA0, counter, 8 x int24 big endian, 6 aux bytes, footer 0xC0 to 0xC6. */
export function parseCytonPacket(bytes: Uint8Array, at = 0): CytonPacket | null {
  if (bytes.length - at < CYTON_PACKET || bytes[at] !== 0xa0) return null;
  const footer = bytes[at + 32];
  if (footer < 0xc0 || footer > 0xc6) return null;
  const counts = new Int32Array(8);
  const microvolts = new Float32Array(8);
  for (let c = 0; c < 8; c++) {
    const o = at + 2 + 3 * c;
    counts[c] = (((bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2]) << 8) >> 8;
    microvolts[c] = counts[c] * CYTON_UV_PER_COUNT;
  }
  return { sample: bytes[at + 1], counts, microvolts, aux: bytes.slice(at + 26, at + 32), footer };
}

/**
 * Cyton packets out of a serial byte stream. The board also sends text (its
 * banner, replies to commands), and a lone 0xA0 ... 0xCn pattern in it would
 * pass the header and footer check by chance, so after any skipped byte a
 * packet also needs the next packet's header behind it before it counts.
 */
export class CytonParser {
  readonly stats = { packets: 0, skipped: 0 };
  private buf = new Uint8Array(0);
  private synced = false;

  push(chunk: Uint8Array): CytonPacket[] {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf);
    b.set(chunk, this.buf.length);
    const out: CytonPacket[] = [];
    let i = 0;
    for (;;) {
      let j = i;
      while (j < b.length && b[j] !== 0xa0) j++;
      if (j > i) this.skip(j - i);
      i = j;
      if (b.length - i < CYTON_PACKET + (this.synced ? 0 : 1)) break;
      const p = parseCytonPacket(b, i);
      if (!p || (!this.synced && b[i + CYTON_PACKET] !== 0xa0)) {
        this.skip(1);
        i++;
        continue;
      }
      out.push(p);
      this.stats.packets++;
      this.synced = true;
      i += CYTON_PACKET;
    }
    this.buf = b.slice(i);
    return out;
  }

  private skip(n: number) {
    this.stats.skipped += n;
    this.synced = false;
  }
}

const defaultNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Re-encodes Cyton packets as SSP: a HELLO, then EEG frames of side "single"
 * at 250 Hz, as full as a notification allows, with the board's raw counts
 * and its scale in the HELLO, so nothing is requantized.
 *
 * The device clock counts the board's samples, 4000 us each. Where the
 * board's 8 bit counter skips, its radio lost packets: the frame after says
 * so (device drop, a missing sequence number) and its timestamp leaves the
 * hole in place. The same counter twice is one packet delivered twice and is
 * dropped. The counter cannot tell 1 lost sample from 257, so after more than
 * about a second of silence the host's clock decides how many times it
 * wrapped; and while the board is stopped the host's clock keeps the device
 * clock running, as an earbud's crystal would.
 */
export class CytonBridge {
  private seq = 0;
  private index = 0;
  private last = -1;
  private lastAt = 0;
  private streaming = false;
  private stoppedAt: number | null = null;
  private readonly perFrame = maxEegSamples(8);
  private readonly pending: number[] = [];
  private first = 0;
  private dropped = false;
  private parser = new CytonParser();

  constructor(
    private readonly onBytes: OnBytes,
    private readonly labels: string[] = ["1", "2", "3", "4", "5", "6", "7", "8"],
    /** The host's clock in milliseconds. */
    private readonly now: () => number = defaultNow,
  ) {}

  get running(): boolean {
    return this.streaming;
  }

  get stats() {
    return this.parser.stats;
  }

  /** Streaming (re)starts: a HELLO with the stream start flag, and the counter read afresh. */
  start(): void {
    if (this.stoppedAt !== null) this.index += Math.round(((this.now() - this.stoppedAt) * CYTON_RATE) / 1000);
    this.stoppedAt = null;
    this.streaming = true;
    this.seq = 0;
    this.last = -1;
    this.pending.length = 0;
    this.dropped = false;
    this.parser = new CytonParser();
    this.hello(Flag.streamStart);
  }

  /** Streaming stops: what is pending goes out, and stray bytes after it are ignored. */
  stop(): void {
    if (!this.streaming) return;
    this.flush();
    this.streaming = false;
    this.stoppedAt = this.now();
  }

  hello(flags = 0): void {
    this.emit(
      {
        type: "hello",
        firmware: [0, 0, 0],
        // "CYTON" in ASCII: a dev kit stream re-encoded on the phone.
        deviceId: "4359544f4e000000",
        labels: this.labels,
        eegRate: CYTON_RATE,
        nvPerLsb: CYTON_UV_PER_COUNT * 1000,
        imuRate: 0,
        battery: 255,
      },
      this.index * 4000,
      flags,
    );
  }

  /** Raw serial bytes in. */
  push(chunk: Uint8Array): void {
    if (!this.streaming) return;
    const at = this.now();
    for (const p of this.parser.push(chunk)) this.packet(p, at);
  }

  private packet(p: CytonPacket, at: number) {
    if (this.last >= 0) {
      // 1 when contiguous; 0 is the same packet twice, or exactly one wrap.
      let step = (p.sample - this.last) & 0xff || 256;
      const elapsed = ((at - this.lastAt) * CYTON_RATE) / 1000;
      if (step === 256 && elapsed < 128) return;
      if (step > 1 && elapsed >= 192) step += 256 * Math.max(0, Math.round((elapsed - step) / 256));
      if (step > 1) {
        this.flush();
        this.index += step - 1;
        this.seq = (this.seq + 1) & 0xffff;
        this.dropped = true;
      }
    }
    this.last = p.sample;
    this.lastAt = at;
    if (this.pending.length === 0) this.first = this.index;
    this.pending.push(...p.counts);
    this.index++;
    if (this.pending.length === 8 * this.perFrame) this.flush();
  }

  private flush() {
    const n = this.pending.length / 8;
    if (n === 0) return;
    this.emit({ type: "eeg", channels: 8, samples: n, counts: Int32Array.from(this.pending) }, this.first * 4000, 0);
    this.pending.length = 0;
  }

  private emit(body: FrameBody, timestamp: number, flags: number) {
    if (this.dropped && body.type === "eeg") {
      flags |= Flag.deviceDrop;
      this.dropped = false;
    }
    const frame = { ...body, side: "single", seq: this.seq, timestamp: timestamp % 2 ** 32, flags } as SspFrame;
    this.seq = (this.seq + 1) & 0xffff;
    this.onBytes(encodeFrame(frame), "single");
  }
}

/**
 * The OpenBCI Cyton dev kit over Web Serial, 115200 baud: "b" starts it
 * streaming and "s" stops it. Its packets come out as SSP frames of side
 * "single" through CytonBridge. SSP commands map onto the board: START and
 * STOP onto "b" and "s" (START while streaming changes nothing), HELLO and
 * SET_EEG_RATE answer with a HELLO (the board stays at 250 Hz), and STEER
 * has nothing to steer.
 *
 * Web Serial replaces port.readable after an error it can recover from (an
 * overrun, a framing or parity error, a break), so reading carries on with
 * the new stream; it ends only when the port is gone. An exception thrown
 * by the consumer does not stop it either: it goes to onError.
 */
export class CytonSerialTransport implements Transport {
  readonly name = "OpenBCI Cyton (Web Serial)";
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reading: Promise<void> | null = null;
  private bridge: CytonBridge | null = null;
  private closing = false;

  constructor(
    private readonly opts: {
      serial?: SerialLike;
      /** An already chosen port, skipping the chooser. */
      port?: SerialPortLike;
      /** Names for the eight channels, at most 4 characters each. */
      labels?: string[];
      /** Read errors, the port going away, and exceptions from the consumer. Default: rethrown outside the read loop. */
      onError?: (error: unknown) => void;
      /** The host's clock in milliseconds (tests). */
      now?: () => number;
    } = {},
  ) {}

  async connect(onBytes: OnBytes): Promise<void> {
    let port = this.opts.port;
    if (!port) {
      const serial = this.opts.serial ?? (globalThis.navigator as { serial?: SerialLike } | undefined)?.serial;
      if (!serial) throw new Error("Web Serial is not available in this browser");
      port = await serial.requestPort({ filters: [FTDI] });
    }
    // 64 KB, eight seconds of the board, rather than the default 255 bytes, 31 ms.
    await port.open({ baudRate: 115200, bufferSize: 65536 });
    if (!port.readable || !port.writable) throw new Error("serial port is not readable and writable");
    this.port = port;
    this.closing = false;
    this.writer = port.writable.getWriter();
    const report = this.opts.onError ?? ((e: unknown) => queueMicrotask(() => {
      throw e;
    }));
    const bridge = new CytonBridge(
      (bytes, side) => {
        try {
          onBytes(bytes, side);
        } catch (e) {
          report(e);
        }
      },
      this.opts.labels,
      this.opts.now,
    );
    this.bridge = bridge;
    this.reading = this.read(port, bridge, report);
    await this.start();
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    try {
      await this.stop();
    } catch {
      // Unplugged: nothing to stop.
    }
    await this.reader?.cancel().catch(() => {});
    await this.reading;
    this.writer?.releaseLock();
    await this.port?.close().catch(() => {});
    this.port = this.reader = this.writer = this.reading = this.bridge = null;
  }

  async send(_side: Side, bytes: Uint8Array): Promise<void> {
    const f = decodeCommand(bytes);
    if (!f || !this.bridge) return;
    const op = f.command.op;
    if (op === "start") await this.start();
    else if (op === "stop") await this.stop();
    else if (op === "hello" || op === "setEegRate") this.bridge.hello(0);
  }

  private async start() {
    if (!this.bridge || this.bridge.running) return;
    this.bridge.start();
    await this.text("b");
  }

  private async stop() {
    if (!this.bridge?.running) return;
    await this.text("s");
    this.bridge.stop();
  }

  private async read(port: SerialPortLike, bridge: CytonBridge, report: (e: unknown) => void) {
    while (port.readable && !this.closing) {
      const reader = port.readable.getReader();
      this.reader = reader;
      let ended = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            ended = true;
            break;
          }
          if (value) bridge.push(value);
        }
      } catch (e) {
        if (!this.closing) report(e);
      } finally {
        reader.releaseLock();
      }
      if (ended) break;
    }
  }

  private async text(s: string) {
    if (!this.writer) throw new Error("not connected");
    await this.writer.write(new TextEncoder().encode(s));
  }
}
