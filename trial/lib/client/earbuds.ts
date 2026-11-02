"use client";

import type { ClenchKind, DigitalTwin } from "@sense/twin";
import { NullSensorProvider, type SensorProvider } from "@/lib/extensions/sensor-provider";
import type {
  SignaliveOptions,
  SignaliveSensorProvider,
  SignaliveTransport,
  SignaliveView,
} from "@/lib/extensions/signalive-provider";
import { createStore } from "./store";

/**
 * The earbuds, for the whole app. Settings connects them with a tap and
 * disconnects them; in between they stay with the page across screens, so
 * a clench reaches the gesture bus from anywhere and Focus can steer with the
 * earbuds' head yaw. While nothing is connected the sensor provider is
 * NullSensorProvider. The provider's code (and lib/sense with it) loads only
 * when the Earbuds section asks for it, so screens that never connect never
 * fetch it.
 */

export interface EarbudsView extends SignaliveView {
  transport: SignaliveTransport | null;
}

const OFF: EarbudsView = {
  phase: "off",
  transport: null,
  earbuds: {},
  frames: 0,
  lost: 0,
  yaw: null,
  listening: false,
  clench: null,
  attention: null,
  error: null,
};

const NONE = new NullSensorProvider();

/** Each press turns the simulated head to the next of these: right, ahead, left, ahead. */
export const SIMULATED_TURNS = [30, 0, -30, 0] as const;

type ProviderModule = typeof import("@/lib/extensions/signalive-provider");

class EarbudsController {
  readonly view = createStore<EarbudsView>(OFF);
  private provider: SignaliveSensorProvider | null = null;
  private release: () => void = () => {};
  private module: Promise<ProviderModule> | null = null;
  private turns = 0;
  private readonly yawListeners = new Set<(deg: number) => void>();

  /**
   * Fetches the provider's code before the tap that connects, so the
   * browser's device chooser opens while the tap still counts as one.
   */
  preload(): Promise<ProviderModule> {
    this.module ??= import("@/lib/extensions/signalive-provider");
    this.module.catch(() => (this.module = null));
    return this.module;
  }

  /** The connected earbuds, or NullSensorProvider. */
  get sensor(): SensorProvider {
    return this.provider ?? NONE;
  }

  /** The simulated earbuds while they are connected; null otherwise. */
  get twin(): DigitalTwin | null {
    return this.provider?.twin ?? null;
  }

  /** Head yaw from the connected earbuds, degrees, right positive. */
  get yaw(): number | null {
    return this.provider?.yaw ?? null;
  }

  /** Called with each new head yaw from whichever earbuds are connected. */
  onYaw(listener: (deg: number) => void): () => void {
    this.yawListeners.add(listener);
    return () => this.yawListeners.delete(listener);
  }

  /** Call from a tap: Bluetooth and USB open the browser's chooser. Failures land in the view. */
  async connect(transport: SignaliveTransport, opts: Omit<SignaliveOptions, "transport"> = {}) {
    await this.disconnect();
    this.view.set({ ...OFF, phase: "connecting", transport });
    let mod: ProviderModule;
    try {
      mod = await this.preload();
    } catch {
      this.view.set({ ...OFF, transport, error: "failed" });
      return;
    }
    const p = new mod.SignaliveSensorProvider({ transport, ...opts });
    this.provider = p;
    this.turns = 0;
    const offView = p.view.subscribe(() => this.view.set({ ...p.view.get(), transport }));
    const offYaw = p.onYaw((deg) => {
      for (const l of this.yawListeners) l(deg);
    });
    this.release = () => {
      offView();
      offYaw();
    };
    try {
      await p.connect();
    } catch {
      // The provider's view already says why; keep that on screen and let the provider go.
      if (this.provider === p) this.drop();
    }
  }

  /** Bluetooth: the other earbud, from a second tap. */
  async addEarbud() {
    await this.provider?.addEarbud().catch(() => undefined);
  }

  async disconnect() {
    const p = this.provider;
    if (!p) return;
    this.drop();
    await p.disconnect();
    this.view.set(OFF);
  }

  /** Simulated earbuds: jaw muscle activity on every electrode of both. */
  clench(kind: ClenchKind) {
    this.twin?.clench(kind);
  }

  /** Simulated earbuds: the head turns, at a head's pace, to the next of SIMULATED_TURNS. */
  turnHead() {
    const twin = this.twin;
    if (!twin) return;
    twin.setYaw(SIMULATED_TURNS[this.turns % SIMULATED_TURNS.length]!);
    this.turns++;
  }

  private drop() {
    this.release();
    this.release = () => {};
    this.provider = null;
  }
}

export const earbuds = new EarbudsController();
