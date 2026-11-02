import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import {
  BleErrorCode,
  BleManager,
  ConnectionPriority,
  ScanMode,
  State,
  type BleError,
  type Device,
  type Subscription,
} from "react-native-ble-plx";
import {
  NativeBridgeError,
  SSP_COMMANDS_UUID,
  SSP_FRAMES_UUID,
  SSP_SERVICE_UUID,
  type NativeBleConnection,
  type NativeBleDevice,
  type NativeEventData,
  type NativeEventName,
  type NativeParams,
} from "../shared";
import { bleFailure } from "./ble-errors";

type Emit = <E extends NativeEventName>(event: E, data: NativeEventData[E]) => void;

/** The ATT MTU the protocol is sized for (hardware/PROTOCOL.md): one 244 byte frame per notification. Android asks for it; iOS negotiates by itself. */
const MTU = 247;
const CONNECT_TIMEOUT_MS = 15000;
/** Long enough for the person to answer the first Bluetooth prompt, which holds the state at Unknown. */
const POWER_WAIT_MS = 30000;

const failure = (e: unknown) => bleFailure(e, BleErrorCode);
const noop = () => undefined;

interface Link {
  device: Device;
  frames: Subscription | null;
  gone: Subscription | null;
  /** Let go of on purpose: its end is not news. */
  closing: boolean;
  /** Let go of because the page went: the next page is not told. */
  quiet: boolean;
  /** Why it is being torn down, when the shell decided it. */
  reason: string | null;
}

interface Scan {
  promise: Promise<NativeBleDevice[]>;
  stop: () => void;
}

/**
 * The earbuds' side of the bridge: scans for devices advertising the SSP
 * service, keeps one connection per earbud, forwards every frames
 * notification to the page as base64 (the form the library hands it over in)
 * and writes host commands to the commands characteristic. The Bluetooth
 * manager is made on first use, so the iOS Bluetooth prompt appears when the
 * page first asks for earbuds, not at launch.
 */
export class BleController {
  private manager: BleManager | null = null;
  private readonly links = new Map<string, Link>();
  private readonly connecting = new Map<string, Promise<NativeBleConnection>>();
  private scanning: Scan | null = null;
  /** Bumped when the page goes; work it started that finishes later is undone. */
  private page = 0;

  constructor(private readonly emit: Emit) {}

  /** The native module is in this build. Expo Go has none: Bluetooth needs a development build. */
  get available(): boolean {
    return NativeModules.BlePlx != null;
  }

  scan(params: NativeParams["ble.scan"]): Promise<NativeBleDevice[]> {
    if (this.scanning) return this.scanning.promise;
    const scan: Scan = { promise: Promise.resolve([]), stop: noop };
    this.scanning = scan;
    scan.promise = this.ready()
      .then((manager) => this.listen(manager, params.timeoutMs, scan))
      .finally(() => {
        if (this.scanning === scan) this.scanning = null;
      });
    return scan.promise;
  }

  /** One scan: every device advertising the SSP service, strongest first. */
  private listen(manager: BleManager, timeoutMs: number, scan: Scan): Promise<NativeBleDevice[]> {
    return new Promise((resolve, reject) => {
      const found = new Map<string, NativeBleDevice>();
      let over = false;
      const finish = (err?: unknown) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        manager.stopDeviceScan().catch(noop);
        if (err) reject(failure(err));
        else resolve([...found.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)));
      };
      scan.stop = () => finish();
      const timer = setTimeout(() => finish(), timeoutMs);
      manager
        .startDeviceScan([SSP_SERVICE_UUID], { allowDuplicates: false, scanMode: ScanMode.LowLatency }, (error, device) => {
          if (error) {
            finish(error);
            return;
          }
          if (!device) return;
          const before = found.get(device.id);
          found.set(device.id, {
            id: device.id,
            name: device.name ?? device.localName ?? before?.name ?? null,
            rssi: device.rssi ?? before?.rssi ?? null,
          });
        })
        .catch(finish);
    });
  }

  connect(params: NativeParams["ble.connect"]): Promise<NativeBleConnection> {
    const { id } = params;
    const link = this.links.get(id);
    if (link && !link.closing) return Promise.resolve(describe(link.device));
    const pending = this.connecting.get(id);
    if (pending) return pending;
    const attempt = this.open(id).finally(() => this.connecting.delete(id));
    this.connecting.set(id, attempt);
    return attempt;
  }

  private async open(id: string): Promise<NativeBleConnection> {
    const manager = await this.ready();
    const page = this.page;
    // Android connects badly while it scans; the scan ends with what it has found.
    this.scanning?.stop();
    const options = { requestMTU: MTU, timeout: CONNECT_TIMEOUT_MS };
    let device: Device;
    try {
      device = await manager.connectToDevice(id, options);
    } catch (e) {
      if ((e as BleError | null)?.errorCode !== BleErrorCode.DeviceAlreadyConnected) throw failure(e);
      // Left connected by a page that has gone: start afresh.
      await manager.cancelDeviceConnection(id).catch(noop);
      device = await manager.connectToDevice(id, options).catch((e2: unknown) => {
        throw failure(e2);
      });
    }
    const link: Link = { device, frames: null, gone: null, closing: false, quiet: false, reason: null };
    // Watched from the moment it connects: an earbud that drops while it is being set up is not
    // handed to the page as connected.
    let droppedDuringSetup = false;
    link.gone = manager.onDeviceDisconnected(id, (error) => {
      if (this.links.get(id) === link) this.ended(id, link, error, true);
      else droppedDuringSetup = true;
    });
    const abandon = async (err: NativeBridgeError) => {
      link.gone?.remove();
      await manager.cancelDeviceConnection(id).catch(noop);
      return err;
    };
    try {
      await device.discoverAllServicesAndCharacteristics();
      const uuids = (await device.characteristicsForService(SSP_SERVICE_UUID)).map((c) => c.uuid.toLowerCase());
      if (!uuids.includes(SSP_FRAMES_UUID) || !uuids.includes(SSP_COMMANDS_UUID)) {
        throw new NativeBridgeError("not_found", "This device has no Signalive frames and commands");
      }
      // A shorter connection interval: two earbuds' frames, with room to spare (hardware/PROTOCOL.md, Throughput).
      if (Platform.OS === "android") await device.requestConnectionPriority(ConnectionPriority.High).catch(noop);
    } catch (e) {
      throw await abandon(failure(e));
    }
    if (droppedDuringSetup) throw await abandon(new NativeBridgeError("not_connected", "The earbud disconnected while it was being set up"));
    if (page !== this.page) throw await abandon(new NativeBridgeError("failed", "The page that asked for this earbud has gone"));
    this.links.set(id, link);
    link.frames = device.monitorCharacteristicForService(
      SSP_SERVICE_UUID,
      SSP_FRAMES_UUID,
      (error, characteristic) => {
        if (error) {
          // The link going ends the subscription too; onDeviceDisconnected reports that. Any
          // other failure leaves a connection that delivers nothing, so it is closed.
          if (!link.closing && this.links.get(id) === link && !isLinkEnd(error)) {
            link.reason = `Frames stopped: ${error.message}`;
            manager.cancelDeviceConnection(id).catch(noop);
          }
          return;
        }
        const value = characteristic?.value;
        if (value) this.emit("ble.bytes", { id, bytes: value });
      },
      `ssp-frames-${id}`,
    );
    this.emit("ble.state", { id, state: "connected", reason: null });
    return describe(device);
  }

  async disconnect(params: NativeParams["ble.disconnect"]): Promise<null> {
    await this.close(params.id, true);
    return null;
  }

  async write(params: NativeParams["ble.write"]): Promise<null> {
    const manager = this.manager;
    if (!manager || !this.links.has(params.id)) throw new NativeBridgeError("not_connected", "That earbud is not connected");
    try {
      await manager.writeCharacteristicWithResponseForDevice(params.id, SSP_SERVICE_UUID, SSP_COMMANDS_UUID, params.bytes);
    } catch (e) {
      throw failure(e);
    }
    return null;
  }

  /** The page has gone (a reload, a navigation): its scan and its earbuds go with it, without a word to the next page. */
  async reset(): Promise<void> {
    this.page++;
    this.scanning?.stop();
    await Promise.all([...this.links.keys()].map((id) => this.close(id, false)));
  }

  /** The shell is going: lets go of everything, the manager included. */
  async destroy(): Promise<void> {
    await this.reset();
    const manager = this.manager;
    this.manager = null;
    await manager?.destroy().catch(noop);
  }

  private async close(id: string, tell: boolean) {
    const link = this.links.get(id);
    if (link) {
      link.closing = true;
      link.quiet = !tell;
    }
    const manager = this.manager;
    if (manager) await manager.cancelDeviceConnection(id).catch(noop);
    // In case the library does not report an end it was asked for.
    if (link && this.links.get(id) === link) this.ended(id, link, null, tell);
  }

  private ended(id: string, link: Link, error: BleError | null, tell: boolean) {
    if (this.links.get(id) !== link) return;
    this.links.delete(id);
    link.frames?.remove();
    link.gone?.remove();
    if (!tell || link.quiet) return;
    const reason = link.closing ? null : (link.reason ?? error?.message ?? "The earbud disconnected");
    this.emit("ble.state", { id, state: "disconnected", reason });
  }

  /** The manager, once the app may use Bluetooth and it is on. */
  private async ready(): Promise<BleManager> {
    if (!this.available) {
      throw new NativeBridgeError("unavailable", "Bluetooth is not available in this build of the app (Expo Go has none; a development build does)");
    }
    await androidPermissions();
    this.manager ??= new BleManager();
    await poweredOn(this.manager);
    return this.manager;
  }
}

function describe(device: Device): NativeBleConnection {
  return { id: device.id, name: device.name ?? device.localName ?? null, mtu: device.mtu };
}

function isLinkEnd(error: BleError): boolean {
  return (
    error.errorCode === BleErrorCode.DeviceDisconnected ||
    error.errorCode === BleErrorCode.OperationCancelled ||
    error.errorCode === BleErrorCode.BluetoothManagerDestroyed
  );
}

/** Android 12 and later ask for nearby devices; before that, Bluetooth scanning needed location. iOS asks by itself. */
async function androidPermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const api = typeof Platform.Version === "number" ? Platform.Version : parseInt(String(Platform.Version), 10);
  const wanted =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  if (!wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED)) {
    throw new NativeBridgeError("permission_denied", "Bluetooth permission was not given to the app");
  }
}

/** Resolves once Bluetooth is on; rejects when it is off, not allowed, or missing. */
function poweredOn(manager: BleManager): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: Subscription | null = null;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => settle(new NativeBridgeError("timeout", "Bluetooth did not become ready")), POWER_WAIT_MS);
    subscription = manager.onStateChange((state) => {
      if (state === State.PoweredOn) settle();
      else if (state === State.PoweredOff) settle(new NativeBridgeError("bluetooth_off", "Bluetooth is off"));
      else if (state === State.Unauthorized) settle(new NativeBridgeError("bluetooth_unauthorized", "Bluetooth is not allowed for this app in Settings"));
      else if (state === State.Unsupported) settle(new NativeBridgeError("unsupported", "This phone has no Bluetooth Low Energy"));
      // Unknown and Resetting: an update is on its way.
    }, true);
    if (settled) subscription.remove();
  });
}
