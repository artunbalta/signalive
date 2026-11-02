/**
 * The messages between the Signalive web app and the native shell that shows
 * it on iPhone and Android (mobile/, an Expo app). The shell gives the page
 * what a browser cannot, above all Bluetooth to the earbuds on iPhone, where
 * Safari has no Web Bluetooth.
 *
 * One module for both sides: the shell imports this file through a relative
 * path (mobile/src/shared.ts), and the page reaches it through lib/sense like
 * the rest of the earbud software. It imports nothing, so it runs unchanged in
 * the browser, in the shell's Hermes runtime and in Node for the tests.
 *
 * The page calls window.SignaliveNative (SignaliveNativeApi below), which the
 * shell defines before the page's own scripts run. Each call is one JSON
 * message posted to the shell (a NativeCall: an id, a method, its params);
 * the shell answers with a NativeResult for that id, or a NativeFailure with
 * an error code, and pushes events (earbud bytes, connection changes) as
 * NativeEvents. The shell sends several messages at once as a NativeBatch.
 * Bytes cross as base64, the form the native Bluetooth library hands them over
 * in, so a notification is never decoded or copied on the native side.
 *
 * The shell checks every call against validateParams and ignores anything
 * that is not a call at all.
 */

/** Every message carries this, so other users of the WebView's message channel are ignored. */
export const NATIVE_CHANNEL = "signalive-native";
/** Bumped on a breaking change; a call of another version is refused with "unsupported". */
export const NATIVE_PROTOCOL_VERSION = 1;
/** The page finds the bridge at window[NATIVE_GLOBAL]. */
export const NATIVE_GLOBAL = "SignaliveNative";
/** Dispatched on window once the bridge is defined, for a page that looked before it was. */
export const NATIVE_READY_EVENT = "signalivenativeready";
/**
 * Appended to the WebView's user agent ("SignaliveApp/0.1.0"), so the page can
 * tell it runs inside the shell from its first line of script, even before
 * the bridge is defined (on Android it can arrive a moment after the page's
 * first scripts).
 */
export const NATIVE_USER_AGENT_TOKEN = "SignaliveApp";
/** Messages from the page longer than this are not even parsed. */
export const MAX_MESSAGE_CHARS = 65536;
/** One write to the commands characteristic. A host command is at most 21 bytes; this is the most one ATT write can carry. */
export const MAX_WRITE_BYTES = 512;
/** Scan length bounds and default, ms. */
export const SCAN_MS = { min: 500, default: 4000, max: 30000 } as const;
export const MAX_TITLE_CHARS = 500;
export const MAX_LOCATION_CHARS = 1000;
export const MAX_NOTES_CHARS = 10000;
/** The earliest alert before an event: four weeks. */
export const MAX_ALARM_MINUTES = 40320;

export const NATIVE_METHODS = [
  "info",
  "ble.scan",
  "ble.connect",
  "ble.disconnect",
  "ble.write",
  "calendar.addEvent",
  "calendar.addReminder",
  "haptics.impact",
  "location.current",
] as const;
export type NativeMethod = (typeof NATIVE_METHODS)[number];

export const NATIVE_EVENTS = ["ble.bytes", "ble.state"] as const;
export type NativeEventName = (typeof NATIVE_EVENTS)[number];

export const HAPTIC_STYLES = ["light", "medium", "heavy", "soft", "rigid"] as const;
export type HapticStyle = (typeof HAPTIC_STYLES)[number];

export const LOCATION_ACCURACIES = ["low", "balanced", "high"] as const;
export type LocationAccuracy = (typeof LOCATION_ACCURACIES)[number];

/* ---- Errors -------------------------------------------------------------- */

export const NATIVE_ERROR_CODES = [
  /** The call's params did not validate. */
  "bad_request",
  /** No such method in this shell. */
  "unknown_method",
  /** This shell or this phone cannot do it (another bridge version, reminders on Android without a due time). */
  "unsupported",
  /** The native part is missing from this build (Bluetooth in Expo Go). */
  "unavailable",
  /** The person said no to the system prompt, now or before. */
  "permission_denied",
  "bluetooth_off",
  /** Bluetooth permission is off for this app in the phone's settings. */
  "bluetooth_unauthorized",
  "location_off",
  /** No such device, no earbud advertising the service, no calendar that takes new events. */
  "not_found",
  "not_connected",
  "busy",
  "timeout",
  "failed",
] as const;
export type NativeErrorCode = (typeof NATIVE_ERROR_CODES)[number];

export interface NativeErrorInfo {
  code: NativeErrorCode;
  message: string;
}

/**
 * The DOMException style name an error of each code carries on the page, so
 * code written for Web Bluetooth (which looks at err.name) reads them the same
 * way: NotFoundError when no earbud was found, as when a chooser finds none;
 * NotAllowedError when permission is refused.
 */
export const NATIVE_ERROR_NAMES: Record<NativeErrorCode, string> = {
  bad_request: "TypeError",
  unknown_method: "NotSupportedError",
  unsupported: "NotSupportedError",
  unavailable: "NotSupportedError",
  permission_denied: "NotAllowedError",
  bluetooth_off: "InvalidStateError",
  bluetooth_unauthorized: "NotAllowedError",
  location_off: "InvalidStateError",
  not_found: "NotFoundError",
  not_connected: "NetworkError",
  busy: "InvalidStateError",
  timeout: "TimeoutError",
  failed: "OperationError",
};

/**
 * How long the page waits for an answer before it gives the call up, ms. Long
 * where a system prompt may be waiting on the person; a scan waits this plus
 * its own length.
 */
export const NATIVE_CALL_TIMEOUT_MS: Record<NativeMethod, number> = {
  info: 5000,
  "ble.scan": 10000,
  "ble.connect": 45000,
  "ble.disconnect": 10000,
  "ble.write": 10000,
  "calendar.addEvent": 300000,
  "calendar.addReminder": 300000,
  "haptics.impact": 5000,
  "location.current": 120000,
};

/** An Error with a bridge error code, and the matching name. */
export class NativeBridgeError extends Error {
  readonly code: NativeErrorCode;

  constructor(code: NativeErrorCode, message?: string) {
    super(message || code);
    this.code = code;
    this.name = NATIVE_ERROR_NAMES[code];
  }
}

export function isNativeErrorCode(v: unknown): v is NativeErrorCode {
  return typeof v === "string" && (NATIVE_ERROR_CODES as readonly string[]).includes(v);
}

/* ---- What the methods take and give --------------------------------------- */

export interface NativeInfo {
  platform: "ios" | "android";
  /** The app's version, as in the store. */
  version: string;
  /** The OS version. */
  os: string;
  /** NATIVE_PROTOCOL_VERSION of this shell. */
  bridge: number;
  /** Bluetooth can be used: false in a build without the native module, such as Expo Go. */
  ble: boolean;
  /** The methods this shell answers. */
  methods: NativeMethod[];
}

/** An earbud a scan found: it advertises the SSP service. */
export interface NativeBleDevice {
  /** The platform's id for it: a UUID on iOS, a MAC address on Android. Stable on one phone, not across phones. */
  id: string;
  name: string | null;
  /** Signal strength, dBm; null when unknown. */
  rssi: number | null;
}

export interface NativeBleConnection {
  id: string;
  name: string | null;
  /** The ATT MTU in effect. */
  mtu: number;
}

/** A notification on the frames characteristic: one SSP frame. */
export interface NativeBytesEvent {
  id: string;
  /** The frame, base64. */
  bytes: string;
}

export interface NativeStateEvent {
  id: string;
  state: "connected" | "disconnected";
  /** Why it went, when it was not asked to; null otherwise. */
  reason: string | null;
}

/** A time: epoch milliseconds, or an ISO 8601 string (a Date sent through JSON becomes one). */
export type NativeTime = number | string;

export interface CalendarEventInput {
  title: string;
  start: NativeTime;
  /** Exclusive. For an all day event, the midnight after its last day (as an .ics DTEND). */
  end: NativeTime;
  /** Whole days: start and end are local midnights. Default false. */
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
  /** Minutes before the start to alert, 0 at the start; null or absent for no alert. */
  alarmMinutes?: number | null;
}

export interface ReminderInput {
  title: string;
  /** When it is due. Optional on iPhone; on Android, where there are no reminders, it becomes an event at this time and is required. */
  due?: NativeTime | null;
  notes?: string | null;
}

export interface CalendarItemResult {
  id: string;
  /** What was made: Android has no reminders, so a reminder there is an event with an alert. */
  kind: "event" | "reminder";
}

export interface LocationOptions {
  /** Default "balanced". */
  accuracy?: LocationAccuracy;
}

export interface NativeLocation {
  latitude: number;
  longitude: number;
  /** Metres; null when unknown. */
  accuracy: number | null;
  altitude: number | null;
  /** Epoch ms of the fix. */
  timestamp: number;
}

/** Params as the shell uses them once validated: times as epoch ms, absent text as null, defaults filled in. */
export interface NativeParams {
  info: Record<string, never>;
  "ble.scan": { timeoutMs: number };
  "ble.connect": { id: string };
  "ble.disconnect": { id: string };
  "ble.write": { id: string; bytes: string };
  "calendar.addEvent": {
    title: string;
    start: number;
    end: number;
    allDay: boolean;
    location: string | null;
    notes: string | null;
    alarmMinutes: number | null;
  };
  "calendar.addReminder": { title: string; due: number | null; notes: string | null };
  "haptics.impact": { style: HapticStyle };
  "location.current": { accuracy: LocationAccuracy };
}

export interface NativeResults {
  info: NativeInfo;
  "ble.scan": NativeBleDevice[];
  "ble.connect": NativeBleConnection;
  "ble.disconnect": null;
  "ble.write": null;
  "calendar.addEvent": CalendarItemResult;
  "calendar.addReminder": CalendarItemResult;
  "haptics.impact": null;
  "location.current": NativeLocation;
}

export interface NativeEventData {
  "ble.bytes": NativeBytesEvent;
  "ble.state": NativeStateEvent;
}

/** window.SignaliveNative, as the page sees it. Every call returns a promise; a failure is a NativeBridgeError like error. */
export interface SignaliveNativeApi {
  readonly version: number;
  readonly platform: "ios" | "android";
  info(): Promise<NativeInfo>;
  readonly ble: {
    /** Earbuds advertising the SSP service, strongest first, after listening this long (default SCAN_MS.default). */
    scan(timeoutMs?: number): Promise<NativeBleDevice[]>;
    /** Connects, finds the SSP service and subscribes to its frames. Connecting twice to one device is harmless. */
    connect(id: string): Promise<NativeBleConnection>;
    disconnect(id: string): Promise<void>;
    /** One write to the commands characteristic: a Uint8Array, or base64. */
    write(id: string, bytes: Uint8Array | string): Promise<void>;
    /** Every frame from every connected earbud; returns the unsubscribe. */
    onBytes(listener: (event: NativeBytesEvent) => void): () => void;
    onState(listener: (event: NativeStateEvent) => void): () => void;
  };
  readonly calendar: {
    addEvent(event: CalendarEventInput): Promise<CalendarItemResult>;
    addReminder(reminder: ReminderInput): Promise<CalendarItemResult>;
  };
  readonly haptics: {
    impact(style?: HapticStyle): Promise<void>;
  };
  readonly location: {
    current(options?: LocationOptions): Promise<NativeLocation>;
  };
}

/* ---- Wire messages -------------------------------------------------------- */

interface Envelope {
  channel: typeof NATIVE_CHANNEL;
  v: number;
}

/** Page to shell. */
export interface NativeCall extends Envelope {
  kind: "call";
  id: number;
  method: string;
  params?: unknown;
}

/** Shell to page. */
export interface NativeResult extends Envelope {
  kind: "result";
  id: number;
  ok: true;
  value: unknown;
}

export interface NativeFailure extends Envelope {
  kind: "result";
  id: number;
  ok: false;
  error: NativeErrorInfo;
}

export interface NativeEvent<E extends NativeEventName = NativeEventName> extends Envelope {
  kind: "event";
  event: E;
  data: NativeEventData[E];
}

export type NativeOutgoing = NativeResult | NativeFailure | NativeEvent;

export interface NativeBatch extends Envelope {
  kind: "batch";
  messages: NativeOutgoing[];
}

export function nativeResult(id: number, value: unknown): NativeResult {
  return { channel: NATIVE_CHANNEL, v: NATIVE_PROTOCOL_VERSION, kind: "result", id, ok: true, value: value === undefined ? null : value };
}

export function nativeFailure(id: number, code: NativeErrorCode, message: string): NativeFailure {
  return { channel: NATIVE_CHANNEL, v: NATIVE_PROTOCOL_VERSION, kind: "result", id, ok: false, error: { code, message } };
}

export function nativeEvent<E extends NativeEventName>(event: E, data: NativeEventData[E]): NativeEvent<E> {
  return { channel: NATIVE_CHANNEL, v: NATIVE_PROTOCOL_VERSION, kind: "event", event, data };
}

export function nativeBatch(messages: NativeOutgoing[]): NativeBatch {
  return { channel: NATIVE_CHANNEL, v: NATIVE_PROTOCOL_VERSION, kind: "batch", messages };
}

/** A call as the page builds it. */
export function nativeCall(id: number, method: string, params?: unknown): NativeCall {
  return { channel: NATIVE_CHANNEL, v: NATIVE_PROTOCOL_VERSION, kind: "call", id, method, params };
}

/* ---- Validation ------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCallId(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

export function isNativeMethod(v: unknown): v is NativeMethod {
  return typeof v === "string" && (NATIVE_METHODS as readonly string[]).includes(v);
}

/**
 * A raw message from the page (the string the WebView delivered) as a call,
 * or null for anything that is not one: not a string, too long, not JSON, not
 * on this channel, or without a usable id. Those are ignored: there is no id
 * to answer. The method and params are checked later, so that a call with a
 * usable id is always answered.
 */
export function parseCall(raw: unknown): NativeCall | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_CHARS) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(m) || m.channel !== NATIVE_CHANNEL || m.kind !== "call") return null;
  if (!isCallId(m.id) || typeof m.v !== "number") return null;
  if (typeof m.method !== "string" || m.method.length === 0 || m.method.length > 64) return null;
  return { channel: NATIVE_CHANNEL, v: m.v, kind: "call", id: m.id, method: m.method, params: m.params };
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const valid = <T>(value: T): Validation<T> => ({ ok: true, value });
const invalid = (error: string): Validation<never> => ({ ok: false, error });

/** iOS peripheral UUIDs, Android MAC addresses, and whatever else a platform uses, within reason. */
const DEVICE_ID = /^[A-Za-z0-9:._-]{1,128}$/;

function deviceId(p: Record<string, unknown>): Validation<string> {
  return typeof p.id === "string" && DEVICE_ID.test(p.id) ? valid(p.id) : invalid("id must be a device id from ble.scan");
}

/** Optional text: absent or null is null; otherwise a string of at most max characters. */
function optionalText(v: unknown, what: string, max: number): Validation<string | null> {
  if (v === undefined || v === null) return valid(null);
  if (typeof v !== "string") return invalid(`${what} must be a string`);
  if (v.length > max) return invalid(`${what} is longer than ${max} characters`);
  return valid(v);
}

function title(v: unknown): Validation<string> {
  if (typeof v !== "string" || v.trim().length === 0) return invalid("title must be a non-empty string");
  if (v.length > MAX_TITLE_CHARS) return invalid(`title is longer than ${MAX_TITLE_CHARS} characters`);
  return valid(v.trim());
}

/** Epoch ms or an ISO 8601 date (with a time, if any, in UTC or with an offset). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseNativeTime(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) <= 8.64e15 ? v : null;
  if (typeof v !== "string" || !ISO_DATE.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function time(v: unknown, what: string): Validation<number> {
  const t = parseNativeTime(v);
  return t === null ? invalid(`${what} must be epoch milliseconds or an ISO 8601 date`) : valid(t);
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T, what: string): Validation<T> {
  if (v === undefined || v === null) return valid(fallback);
  return typeof v === "string" && (options as readonly string[]).includes(v) ? valid(v as T) : invalid(`${what} must be one of ${options.join(", ")}`);
}

/**
 * A known method's params, checked and normalized; an error in words when
 * they do not hold. Absent params count as {}.
 */
export function validateParams<M extends NativeMethod>(method: M, params: unknown): Validation<NativeParams[M]>;
export function validateParams(method: NativeMethod, params: unknown): Validation<NativeParams[NativeMethod]> {
  if (params === undefined || params === null) params = {};
  if (!isRecord(params)) return invalid("params must be an object");
  const p = params;
  switch (method) {
    case "info":
      return valid({});
    case "ble.scan": {
      const t = p.timeoutMs;
      if (t === undefined || t === null) return valid({ timeoutMs: SCAN_MS.default });
      if (typeof t !== "number" || !Number.isFinite(t)) return invalid("timeoutMs must be a number");
      return valid({ timeoutMs: Math.round(Math.min(SCAN_MS.max, Math.max(SCAN_MS.min, t))) });
    }
    case "ble.connect":
    case "ble.disconnect": {
      const id = deviceId(p);
      return id.ok ? valid({ id: id.value }) : id;
    }
    case "ble.write": {
      const id = deviceId(p);
      if (!id.ok) return id;
      if (typeof p.bytes !== "string") return invalid("bytes must be base64");
      const n = base64Length(p.bytes);
      if (n === null) return invalid("bytes must be base64");
      if (n < 1 || n > MAX_WRITE_BYTES) return invalid(`a write carries 1 to ${MAX_WRITE_BYTES} bytes`);
      return valid({ id: id.value, bytes: p.bytes });
    }
    case "calendar.addEvent": {
      const t = title(p.title);
      if (!t.ok) return t;
      const start = time(p.start, "start");
      if (!start.ok) return start;
      const end = time(p.end, "end");
      if (!end.ok) return end;
      if (end.value < start.value) return invalid("end is before start");
      const location = optionalText(p.location, "location", MAX_LOCATION_CHARS);
      if (!location.ok) return location;
      const notes = optionalText(p.notes, "notes", MAX_NOTES_CHARS);
      if (!notes.ok) return notes;
      if (p.allDay !== undefined && p.allDay !== null && typeof p.allDay !== "boolean") return invalid("allDay must be true or false");
      let alarmMinutes: number | null = null;
      if (p.alarmMinutes !== undefined && p.alarmMinutes !== null) {
        const a = p.alarmMinutes;
        if (typeof a !== "number" || !Number.isFinite(a) || a < 0 || a > MAX_ALARM_MINUTES) {
          return invalid(`alarmMinutes must be from 0 to ${MAX_ALARM_MINUTES}, or null`);
        }
        alarmMinutes = Math.round(a);
      }
      return valid({
        title: t.value,
        start: start.value,
        end: end.value,
        allDay: p.allDay === true,
        location: location.value,
        notes: notes.value,
        alarmMinutes,
      });
    }
    case "calendar.addReminder": {
      const t = title(p.title);
      if (!t.ok) return t;
      let due: number | null = null;
      if (p.due !== undefined && p.due !== null) {
        const d = time(p.due, "due");
        if (!d.ok) return d;
        due = d.value;
      }
      const notes = optionalText(p.notes, "notes", MAX_NOTES_CHARS);
      if (!notes.ok) return notes;
      return valid({ title: t.value, due, notes: notes.value });
    }
    case "haptics.impact": {
      const style = oneOf(p.style, HAPTIC_STYLES, "medium", "style");
      return style.ok ? valid({ style: style.value }) : style;
    }
    case "location.current": {
      const accuracy = oneOf(p.accuracy, LOCATION_ACCURACIES, "balanced", "accuracy");
      return accuracy.ok ? valid({ accuracy: accuracy.value }) : accuracy;
    }
  }
}

/**
 * A message from the shell as the page reads it, or null when it is not one.
 * The injected bridge applies the same rules in plain JavaScript; the shell's
 * tests hold both to them.
 */
export function parseOutgoing(m: unknown): NativeOutgoing | NativeBatch | null {
  if (!isRecord(m) || m.channel !== NATIVE_CHANNEL || typeof m.v !== "number") return null;
  if (m.kind === "batch") {
    if (!Array.isArray(m.messages)) return null;
    const messages: NativeOutgoing[] = [];
    for (const x of m.messages) {
      const one = parseOutgoing(x);
      if (!one || one.kind === "batch") return null;
      messages.push(one);
    }
    return nativeBatch(messages);
  }
  if (m.kind === "result") {
    if (!isCallId(m.id)) return null;
    if (m.ok === true) return nativeResult(m.id, m.value);
    if (m.ok !== false || !isRecord(m.error) || !isNativeErrorCode(m.error.code) || typeof m.error.message !== "string") return null;
    return nativeFailure(m.id, m.error.code, m.error.message);
  }
  if (m.kind === "event" && isRecord(m.data) && typeof m.data.id === "string") {
    const d = m.data;
    const id = d.id as string;
    if (m.event === "ble.bytes" && typeof d.bytes === "string") return nativeEvent("ble.bytes", { id, bytes: d.bytes });
    if (m.event === "ble.state" && (d.state === "connected" || d.state === "disconnected")) {
      return nativeEvent("ble.state", { id, state: d.state, reason: typeof d.reason === "string" ? d.reason : null });
    }
  }
  return null;
}

/* ---- Base64 ---------------------------------------------------------------- */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2,3})?$/;

/** Standard base64, padded. Written out rather than taken from btoa, which not every runtime here has. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + "=";
  }
  return out;
}

/** How many bytes a base64 string holds, or null when it is not base64 (standard alphabet, padding optional). */
export function base64Length(s: string): number | null {
  if (!BASE64.test(s)) return null;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const chars = s.length - pad;
  return Math.floor((chars * 3) / 4);
}

/** The bytes of a base64 string, or null when it is not base64. */
export function decodeBase64(s: string): Uint8Array | null {
  const n = base64Length(s);
  if (n === null) return null;
  const out = new Uint8Array(n);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 61) break; // "="
    acc = ((acc << 6) | LOOKUP[c]) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
