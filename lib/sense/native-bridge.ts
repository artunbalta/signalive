/**
 * Real earbuds through the Signalive app's native shell (mobile/). Safari on
 * iPhone has no Web Bluetooth, so inside the app the page asks the shell
 * instead: window.SignaliveNative.ble scans, connects and hands over every
 * notification of the frames characteristic with the id of the earbud it came
 * from (lib/sense/native-protocol.ts has the whole bridge). This transport
 * turns that into what every Transport delivers: SSP bytes tagged with the
 * side the earbud named in its HELLO, and host commands written to the earbud
 * of a side.
 *
 * The shell needs no chooser and no tap, so connect() finds the earbuds
 * itself: it scans for devices advertising the SSP service and connects the
 * strongest two (or the ids it was given, or whichever `choose` picks), each
 * as its own connection, then asks each for a HELLO and starts it streaming.
 * A dropped earbud is reconnected with growing waits, as WebBluetoothTransport
 * does; one that stays away is dropped from the list (onLost) and can be found
 * again with addDevice().
 *
 * No React Native here: this runs in the web page, like the rest of
 * lib/sense.
 */
import {
  NATIVE_GLOBAL,
  NATIVE_READY_EVENT,
  NATIVE_USER_AGENT_TOKEN,
  NativeBridgeError,
  SCAN_MS,
  decodeBase64,
  encodeBase64,
  isNativeErrorCode,
  type NativeBleDevice,
  type NativeBytesEvent,
  type NativeStateEvent,
  type SignaliveNativeApi,
} from "./native-protocol";
import { FrameType, MAGIC0, MAGIC1, decodeFrame, encodeCommand, type HostCommand, type Side } from "./protocol";
import type { OnBytes, Transport } from "./transport";

/** What these functions read from the page: window, or a stand-in in tests. */
export interface NativeScope {
  SignaliveNative?: unknown;
  navigator?: { userAgent?: string };
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

const pageScope = (): NativeScope => globalThis as unknown as NativeScope;

function isApi(v: unknown): v is SignaliveNativeApi {
  if (typeof v !== "object" || v === null) return false;
  const ble = (v as { ble?: Record<string, unknown> }).ble;
  return (
    typeof ble === "object" &&
    ble !== null &&
    ["scan", "connect", "disconnect", "write", "onBytes", "onState"].every((k) => typeof ble[k] === "function")
  );
}

/** The shell's bridge, when this page runs inside the Signalive app and the bridge is there. */
export function nativeBridge(scope: NativeScope = pageScope()): SignaliveNativeApi | null {
  const api = scope[NATIVE_GLOBAL];
  return isApi(api) ? api : null;
}

/** Feature check: can this page reach earbuds through the app's Bluetooth right now? */
export function hasNativeBridge(scope: NativeScope = pageScope()): boolean {
  return nativeBridge(scope) !== null;
}

/**
 * Does this page run inside the Signalive app? True from the page's first
 * script on, by the user agent, even in the moment before the bridge is
 * defined; use waitForNativeBridge() to get the bridge itself.
 */
export function inNativeShell(scope: NativeScope = pageScope()): boolean {
  return hasNativeBridge(scope) || (scope.navigator?.userAgent ?? "").includes(`${NATIVE_USER_AGENT_TOKEN}/`);
}

/** The bridge as soon as it is defined, or null after timeoutMs. */
export function waitForNativeBridge(timeoutMs = 2000, scope: NativeScope = pageScope()): Promise<SignaliveNativeApi | null> {
  const now = nativeBridge(scope);
  if (now || timeoutMs <= 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const settle = (api: SignaliveNativeApi | null) => {
      clearInterval(poll);
      clearTimeout(timer);
      scope.removeEventListener?.(NATIVE_READY_EVENT, check);
      resolve(api);
    };
    const check = () => {
      const api = nativeBridge(scope);
      if (api) settle(api);
    };
    // The ready event is the quick path; the poll covers a page that started listening too late.
    scope.addEventListener?.(NATIVE_READY_EVENT, check);
    const poll = setInterval(check, 50);
    const timer = setTimeout(() => settle(nativeBridge(scope)), timeoutMs);
  });
}

/** An error the bridge rejected with (already an Error, normally), as an Error with a bridge code. */
function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  const o = e as { code?: unknown; message?: unknown } | null;
  if (o && isNativeErrorCode(o.code)) return new NativeBridgeError(o.code, typeof o.message === "string" ? o.message : undefined);
  return new NativeBridgeError("failed", String(e));
}

/** Waits that grow after each failed reconnect, then it gives up: the same as WebBluetoothTransport's. */
const RECONNECT_MS = [500, 1000, 2000, 4000, 8000];
const SIDES: readonly Side[] = ["left", "right", "single"];

export interface NativeBridgeTransportOptions {
  /** The bridge; default window.SignaliveNative (tests pass a fake). */
  bridge?: SignaliveNativeApi;
  /** Connect to these devices (ids from an earlier scan) instead of scanning. */
  ids?: string[];
  /** How long each scan listens, ms. Default SCAN_MS.default. */
  scanMs?: number;
  /** At most this many earbuds from one connect(). Default 2: a left and a right. */
  maxEarbuds?: number;
  /** Picks which of a scan's finds to connect, in order. Default: the strongest signals first. */
  choose?: (found: NativeBleDevice[]) => NativeBleDevice[];
  /** Reconnect an earbud that drops. Default true. */
  reconnect?: boolean;
  /** Called when an earbud has said which side it is. */
  onSide?: (side: Side) => void;
  /** Called when an earbud is gone for good (side null if it never said). */
  onLost?: (side: Side | null) => void;
  /** How long connect() waits for the bridge to be defined when it is not there yet, ms. Default 2000. */
  waitMs?: number;
  /** Waits between reconnects (tests pass their own). */
  sleep?: (ms: number) => Promise<void>;
}

/** One earbud: its id on this phone, the side its HELLO named, and its own command count. */
class NativeEarbud {
  side: Side | null = null;
  name: string | null = null;
  /** Being let go of on purpose: its disconnect is not a loss. */
  closing = false;
  reconnecting = false;
  private seq = 0;

  constructor(
    readonly id: string,
    private readonly ble: SignaliveNativeApi["ble"],
  ) {}

  /** Asks who it is and starts it streaming, as WebBluetoothTransport does after connecting. */
  async start() {
    await this.command({ op: "hello" });
    await this.command({ op: "start" });
  }

  command(command: HostCommand): Promise<void> {
    return this.write(encodeCommand(command, { side: this.side ?? "single", seq: this.seq++ & 0xffff }));
  }

  write(bytes: Uint8Array): Promise<void> {
    return this.ble.write(this.id, encodeBase64(bytes));
  }

  /**
   * One notification is one frame; every header names its side, and a HELLO
   * settles it. Returns the side to deliver the bytes with (null until known)
   * and whether this frame changed it.
   */
  receive(bytes: Uint8Array): { side: Side | null; changed: boolean } {
    const isFrame = bytes.length > 4 && bytes[0] === MAGIC0 && bytes[1] === MAGIC1;
    const fromHeader = isFrame ? (SIDES[bytes[4]] ?? null) : null;
    let changed = false;
    if (isFrame && bytes[3] === FrameType.hello) {
      const hello = decodeFrame(bytes);
      if (hello && hello.side !== this.side) {
        this.side = hello.side;
        changed = true;
      }
    }
    return { side: this.side ?? fromHeader, changed };
  }
}

export class NativeBridgeTransport implements Transport {
  readonly name = "Bluetooth (Signalive app)";
  private readonly earbuds = new Map<string, NativeEarbud>();
  private onBytes: OnBytes | null = null;
  private ble: SignaliveNativeApi["ble"] | null = null;
  private unsubscribe: (() => void)[] = [];

  constructor(private readonly opts: NativeBridgeTransportOptions = {}) {}

  /** The sides connected so far, as their HELLOs named them. */
  get sides(): Side[] {
    return [...this.earbuds.values()].flatMap((e) => (e.side ? [e.side] : []));
  }

  /** The earbuds connected now, with the side each has named (null until its HELLO). */
  get devices(): { id: string; name: string | null; side: Side | null }[] {
    return [...this.earbuds.values()].map((e) => ({ id: e.id, name: e.name, side: e.side }));
  }

  /**
   * Finds the earbuds and starts them streaming. Rejects when not one could
   * be connected: a NotFoundError when none was found, otherwise the first
   * connection's error (each carries a bridge `code`).
   */
  async connect(onBytes: OnBytes): Promise<void> {
    if (this.ble) await this.disconnect();
    const api = this.opts.bridge ?? nativeBridge() ?? (await waitForNativeBridge(this.opts.waitMs ?? 2000));
    if (!api) throw new NativeBridgeError("unavailable", "The Signalive app's Bluetooth is not available on this page");
    this.ble = api.ble;
    this.onBytes = onBytes;
    // Listening before anything connects, so not even the first HELLO is missed.
    this.unsubscribe = [api.ble.onBytes(this.bytesIn), api.ble.onState(this.stateIn)];
    try {
      const max = Math.max(1, this.opts.maxEarbuds ?? 2);
      const ids = this.opts.ids?.length ? this.opts.ids.slice(0, max) : await this.pick(max);
      if (ids.length === 0) throw new NativeBridgeError("not_found", "No Signalive earbuds found nearby");
      await this.open(ids);
    } catch (e) {
      await this.disconnect();
      throw asError(e);
    }
  }

  /** Scans again and connects one more earbud, one not connected yet. */
  async addDevice(): Promise<void> {
    if (!this.ble) throw new Error("connect() first");
    const ids = await this.pick(1);
    if (ids.length === 0) throw new NativeBridgeError("not_found", "No other Signalive earbud found nearby");
    await this.open(ids);
  }

  async disconnect(): Promise<void> {
    const ble = this.ble;
    const earbuds = [...this.earbuds.values()];
    for (const e of earbuds) e.closing = true;
    this.earbuds.clear();
    this.ble = null;
    this.onBytes = null;
    if (ble) {
      await Promise.all(
        earbuds.map(async (e) => {
          try {
            await e.command({ op: "stop" });
          } catch {
            // Already gone: nothing to stop.
          }
          await ble.disconnect(e.id).catch(() => undefined);
        }),
      );
    }
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }

  async send(side: Side, bytes: Uint8Array): Promise<void> {
    const all = [...this.earbuds.values()];
    const targets = side === "single" ? all : all.filter((e) => e.side === side || e.side === "single");
    if (targets.length === 0) throw new Error(`no ${side} earbud connected`);
    await Promise.all(targets.map((e) => e.write(bytes)));
  }

  /** Up to n devices from a scan, leaving out those connected already. */
  private async pick(n: number): Promise<string[]> {
    const ble = this.ble;
    if (!ble) return [];
    const found = (await ble.scan(this.opts.scanMs ?? SCAN_MS.default)).filter((d) => !this.earbuds.has(d.id));
    const chosen = this.opts.choose ? this.opts.choose(found) : [...found].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    return chosen.slice(0, n).map((d) => d.id);
  }

  /** Connects and starts each in turn; rejects only when none of them could be. */
  private async open(ids: string[]) {
    const ble = this.ble;
    if (!ble) throw new Error("connect() first");
    let opened = 0;
    let first: unknown = null;
    for (const id of ids) {
      if (this.earbuds.has(id)) {
        opened++;
        continue;
      }
      const earbud = new NativeEarbud(id, ble);
      // Known before it connects, so its first bytes find it.
      this.earbuds.set(id, earbud);
      try {
        const link = await ble.connect(id);
        earbud.name = link.name;
        await earbud.start();
        opened++;
      } catch (e) {
        earbud.closing = true;
        if (this.earbuds.get(id) === earbud) this.earbuds.delete(id);
        await ble.disconnect(id).catch(() => undefined);
        first ??= e;
      }
    }
    if (opened === 0) throw asError(first ?? new NativeBridgeError("not_found", "No Signalive earbuds found nearby"));
  }

  private bytesIn = (e: NativeBytesEvent) => {
    const earbud = e && typeof e.id === "string" ? this.earbuds.get(e.id) : undefined;
    const onBytes = this.onBytes;
    if (!earbud || !onBytes || typeof e.bytes !== "string") return;
    const bytes = decodeBase64(e.bytes);
    if (!bytes || bytes.length === 0) return;
    const { side, changed } = earbud.receive(bytes);
    if (changed && earbud.side) this.opts.onSide?.(earbud.side);
    if (side) onBytes(bytes, side);
  };

  private stateIn = (e: NativeStateEvent) => {
    const earbud = e && typeof e.id === "string" ? this.earbuds.get(e.id) : undefined;
    if (!earbud || e.state !== "disconnected" || earbud.closing || earbud.reconnecting) return;
    void this.lost(earbud);
  };

  /** Tries again with growing waits; after the last one the earbud is given up, and addDevice() finds it afresh. */
  private async lost(earbud: NativeEarbud) {
    const still = () => !earbud.closing && this.earbuds.get(earbud.id) === earbud && this.ble !== null;
    if (this.opts.reconnect ?? true) {
      earbud.reconnecting = true;
      const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      for (const wait of RECONNECT_MS) {
        await sleep(wait);
        const ble = this.ble;
        if (!still() || !ble) return;
        try {
          await ble.connect(earbud.id);
          // It may have kept streaming: a HELLO says who it is again, and START changes nothing if so.
          await earbud.start();
          earbud.reconnecting = false;
          return;
        } catch {
          // Out of range or busy: wait longer and try again.
        }
      }
      earbud.reconnecting = false;
    }
    if (!still()) return;
    this.earbuds.delete(earbud.id);
    await this.ble?.disconnect(earbud.id).catch(() => undefined);
    this.opts.onLost?.(earbud.side);
  }
}
