import { gestureBus } from "@/lib/gestures/bus";
import type { GestureType } from "@/lib/gestures/types";

/**
 * Extension point: earbud sensors.
 *
 * A later Signalive earbud carries sensors the web trial cannot reach today:
 * an IMU, a bone conduction pickup, EMG electrodes for jaw gestures, and in
 * ear EEG electrodes for attention. Each kind arrives through a
 * SensorProvider. The trial ships only NullSensorProvider, which connects to
 * nothing and emits nothing; no sensing of any kind happens in this version.
 *
 * How a real provider plugs in (see docs/EXTENSIONS.md):
 *  - Web Bluetooth: requestDevice({ filters: [{ services: [SERVICE_UUID] }] }),
 *    then startNotifications() on a characteristic and decode each
 *    notification's DataView into SensorSample frames. Chrome and Edge only;
 *    not available in Safari or Firefox.
 *  - WebHID: navigator.hid.requestDevice({ filters: [{ vendorId }] }) and the
 *    device's "inputreport" events, for wired or dongle prototypes. Chromium
 *    desktop only.
 *  - Either way, gesture classification (a jaw clench from EMG, for example)
 *    happens in the provider or in a classifier behind it, and recognized
 *    gestures are published with emitSensorGesture() below, so the assistant
 *    and the recorder react to them exactly as they react to earbud taps.
 */

export type SensorKind = "imu" | "bone_conduction" | "emg" | "eeg" | "ppg";

export interface SensorChannel {
  id: string;
  kind: SensorKind;
  /** Samples per second. */
  rateHz: number;
  /** SI unit of the values, e.g. "m/s^2", "uV". */
  unit: string;
}

export interface SensorCapabilities {
  /** What the device can deliver. Empty means nothing. */
  channels: SensorChannel[];
  /** Gestures the provider can classify on its own. */
  gestures: GestureType[];
  /** The provider supplies the attention signal (see attention-provider.ts). */
  attention: boolean;
  transport: "none" | "web-bluetooth" | "webhid" | "simulated";
}

export interface SensorSample {
  channelId: string;
  /** performance.now() of the first value in this frame. */
  t: number;
  values: Float32Array;
}

export interface SensorProvider {
  readonly id: string;
  readonly capabilities: SensorCapabilities;
  /** Must be called from a user gesture: device pickers require one. */
  connect(): Promise<void>;
  /** Frames as they arrive; ends when the provider disconnects. */
  stream(): AsyncIterable<SensorSample>;
  disconnect(): Promise<void>;
}

/** The only provider in v0. */
export class NullSensorProvider implements SensorProvider {
  readonly id = "none";
  readonly capabilities: SensorCapabilities = { channels: [], gestures: [], attention: false, transport: "none" };

  async connect(): Promise<void> {}

  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<SensorSample> {
    return;
  }

  async disconnect(): Promise<void> {}
}

/** Where a sensor classifier publishes a recognized gesture. */
export function emitSensorGesture(type: GestureType, sensorId: string, confidence: number) {
  gestureBus.emit({ type, source: "sensor", at: performance.now(), detail: { sensorId, confidence } });
}
