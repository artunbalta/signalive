/**
 * SSP v0, the Signalive Sensor Protocol, on the phone's side. The earbuds
 * only sample, timestamp and packetize; this module reads their frames back
 * into values (SspDecoder), builds frames for the digital twin and the dev kit
 * bridge (encodeFrame), and writes the commands the phone sends to an earbud
 * (encodeCommand). hardware/PROTOCOL.md is the specification and
 * hardware/firmware/ssp.c the firmware's encoder; the tests hold this file to
 * that encoder's bytes, one for one.
 *
 * The last part is what the phone needs to turn frames into time series: the
 * device clock unwrapped, lost samples kept as NaN in their place, and each
 * earbud's clock mapped onto the phone's.
 */

/** GATT: one service per earbud, frames notified on one characteristic, commands written to another. */
export const SSP_SERVICE_UUID = "5a9a0001-282b-483b-bc7c-5ef1d6777a4d";
export const SSP_FRAMES_UUID = "5a9a0002-282b-483b-bc7c-5ef1d6777a4d";
export const SSP_COMMANDS_UUID = "5a9a0003-282b-483b-bc7c-5ef1d6777a4d";

export const SSP_VERSION = 0;
export const MAGIC0 = 0x53;
export const MAGIC1 = 0x4c;
export const HEADER_SIZE = 14;
/** Header plus CRC. */
export const OVERHEAD = 16;
/** No v0 frame is longer, on any transport. */
export const MAX_FRAME = 1024;
export const MAX_PAYLOAD = MAX_FRAME - OVERHEAD;
/** The link the protocol is sized for: ATT MTU 247 with data length extension, 244 bytes per notification. */
export const BLE_MTU = 247;
export const MAX_CHANNELS = 32;
export const MAX_TALKERS = 8;
export const LABEL_SIZE = 4;
export const INT24_MAX = 0x7fffff;
export const INT24_MIN = -0x800000;
/** AUDIO_ENV envelopes are always at this rate, the decoder's own. */
export const ENV_RATE = 64;
/** An IMU quaternion component of 1.0, in counts. */
export const QUAT_ONE = 16384;
/** An ADS1299 class front end at gain 24: 4.5 V / 24 / 2^23 per count, about 22.35 nV. */
export const ADS1299_NV_PER_LSB = 4.5e9 / 24 / 2 ** 23;

export const FrameType = { hello: 0x01, eeg: 0x02, imu: 0x03, event: 0x04, command: 0x05, audioEnv: 0x06 } as const;

/** Header flags. */
export const Flag = {
  /** First frame after streaming (re)starts: forget this side's sequence and timeline. */
  streamStart: 0x01,
  /** An electrode is off; the last lead off EVENT says which. */
  leadOff: 0x02,
  /** The earbud dropped frames itself before this one (its queue was full), not the radio. */
  deviceDrop: 0x04,
  /** Made by an emulator, never by hardware. */
  simulated: 0x80,
} as const;

export const EventCode = {
  /** value: 1 press, 2 double press, 3 long press. */
  button: 0x01,
  /** value: 1 in the ear, 0 out. */
  wear: 0x02,
  /** value: percent. */
  battery: 0x03,
  /** value: bit i set when channel i has lost contact. */
  leadOff: 0x04,
} as const;

export type Side = "left" | "right" | "single";
const SIDES: readonly Side[] = ["left", "right", "single"];
const SIDE_CODE: Record<Side, number> = { left: 0, right: 1, single: 2 };

export interface FrameHeader {
  side: Side;
  /** One counter per earbud across every frame type; wraps at 65536. */
  seq: number;
  /** The earbud's own microsecond clock at the frame's first sample; wraps at 2^32. */
  timestamp: number;
  flags: number;
}

export interface HelloFrame extends FrameHeader {
  type: "hello";
  firmware: [number, number, number];
  /** 8 bytes as 16 lowercase hex digits. */
  deviceId: string;
  /** One per channel, at most 4 ASCII characters; the channel count is labels.length. */
  labels: string[];
  eegRate: number;
  /** ADC nanovolts per count; a float32 on the wire. */
  nvPerLsb: number;
  /** 0 when there is no IMU. */
  imuRate: number;
  /** 0 to 100, 255 when unknown. */
  battery: number;
}

export interface EegFrame extends FrameHeader {
  type: "eeg";
  channels: number;
  samples: number;
  /** samples * channels raw ADC counts, interleaved by sample. */
  counts: Int32Array;
}

export interface ImuFrame extends FrameHeader {
  type: "imu";
  samples: number;
  /**
   * 10 per sample, in the head frame (x forward, y right, z down): accel x y z
   * in milli g, gyro x y z in 0.1 degree per second, quaternion w x y z with
   * QUAT_ONE as 1.0.
   */
  values: Int16Array;
}

export interface EventFrame extends FrameHeader {
  type: "event";
  code: number;
  value: number;
}

export type HostCommand =
  | { op: "start" }
  | { op: "stop" }
  | { op: "setEegRate"; rate: number }
  /**
   * Which voice the earbud's own audio should bring forward: a direction (0
   * ahead, positive to the right) and how much, both carried in tenths.
   */
  | { op: "steer"; azimuthDeg: number; gainDb: number }
  /** Ask for a HELLO now. */
  | { op: "hello" };

export interface CommandFrame extends FrameHeader {
  type: "command";
  command: HostCommand;
}

export interface AudioEnvFrame extends FrameHeader {
  type: "audioEnv";
  samples: number;
  talkers: number;
  /** Where each talker is, in degrees, 0 ahead, positive to the right; tenths on the wire. */
  azimuths: number[];
  /** samples * talkers speech envelope values at ENV_RATE, interleaved by sample. */
  envelopes: Uint16Array;
}

export type SspFrame = HelloFrame | EegFrame | ImuFrame | EventFrame | CommandFrame | AudioEnvFrame;

/** A frame without its header: what a sender fills in before numbering and stamping it. */
export type FrameBody = SspFrame extends infer F ? (F extends SspFrame ? Omit<F, keyof FrameHeader> : never) : never;

/* ---- CRC and int24 ------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final xor) of bytes[start, end). */
export function crc16(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) crc = ((crc << 8) & 0xffff) ^ CRC_TABLE[((crc >> 8) ^ bytes[i]) & 0xff];
  return crc;
}

/** Saturates rather than wraps, so a clipped electrode reads as clipped, not as the other rail. */
export function clampInt24(v: number): number {
  if (!(v >= INT24_MIN)) return Number.isNaN(v) ? 0 : INT24_MIN;
  return v > INT24_MAX ? INT24_MAX : Math.round(v);
}

export function writeInt24(bytes: Uint8Array, offset: number, value: number): void {
  const v = clampInt24(value) & 0xffffff;
  bytes[offset] = v & 0xff;
  bytes[offset + 1] = (v >> 8) & 0xff;
  bytes[offset + 2] = v >> 16;
}

export function readInt24(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) << 8) >> 8;
}

/* ---- Sizes --------------------------------------------------------------- */

function frameRoom(mtu: number) {
  return Math.min(mtu - 3, MAX_FRAME);
}

/** The most EEG samples of this many channels one notification can carry at this ATT MTU. */
export function maxEegSamples(channels: number, mtu = BLE_MTU): number {
  if (channels < 1 || channels > MAX_CHANNELS) return 0;
  return clampCount(Math.floor((frameRoom(mtu) - OVERHEAD - 2) / (3 * channels)));
}

export function maxImuSamples(mtu = BLE_MTU): number {
  return clampCount(Math.floor((frameRoom(mtu) - OVERHEAD - 1) / 20));
}

export function maxEnvSamples(talkers: number, mtu = BLE_MTU): number {
  if (talkers < 1 || talkers > MAX_TALKERS) return 0;
  return clampCount(Math.floor((frameRoom(mtu) - OVERHEAD - 2 - 2 * talkers) / (2 * talkers)));
}

function clampCount(n: number) {
  return Math.max(0, Math.min(255, n));
}

/* ---- Encoding ------------------------------------------------------------ */

const OP_CODE = { start: 0x01, stop: 0x02, setEegRate: 0x03, steer: 0x04, hello: 0x05 } as const;
const OP_NAME: Record<number, HostCommand["op"]> = { 1: "start", 2: "stop", 3: "setEegRate", 4: "steer", 5: "hello" };
/** Payload bytes each operation needs, its code included. */
const OP_SIZE = { start: 1, stop: 1, setEegRate: 3, steer: 5, hello: 1 } as const;

function fail(msg: string): never {
  throw new RangeError(`SSP: ${msg}`);
}

function intIn(v: number, lo: number, hi: number, what: string) {
  if (!Number.isInteger(v) || v < lo || v > hi) fail(`${what} must be an integer from ${lo} to ${hi}, got ${v}`);
}

/** Degrees or dB to the tenths the wire carries. */
function tenths(v: number, what: string) {
  const t = Math.round(v * 10);
  if (!(t >= -32768 && t <= 32767)) fail(`${what} out of range: ${v}`);
  return t;
}

function payloadSize(f: SspFrame): number {
  switch (f.type) {
    case "hello":
      intIn(f.labels.length, 1, MAX_CHANNELS, "channel count");
      return 21 + LABEL_SIZE * f.labels.length;
    case "eeg":
      intIn(f.channels, 1, MAX_CHANNELS, "channels");
      intIn(f.samples, 1, 255, "samples");
      if (f.counts.length !== f.samples * f.channels) fail("counts must hold samples * channels values");
      return 2 + 3 * f.samples * f.channels;
    case "imu":
      intIn(f.samples, 1, 255, "samples");
      if (f.values.length !== f.samples * 10) fail("IMU values must hold 10 per sample");
      return 1 + 20 * f.samples;
    case "event":
      return 5;
    case "command":
      if (!(f.command.op in OP_SIZE)) fail(`unknown command ${String(f.command.op)}`);
      return OP_SIZE[f.command.op];
    case "audioEnv":
      intIn(f.talkers, 1, MAX_TALKERS, "talkers");
      intIn(f.samples, 1, 255, "samples");
      if (f.azimuths.length !== f.talkers) fail("one azimuth per talker");
      if (f.envelopes.length !== f.samples * f.talkers) fail("envelopes must hold samples * talkers values");
      return 2 + 2 * f.talkers + 2 * f.samples * f.talkers;
  }
}

/**
 * One complete frame: header, payload, CRC. Throws a RangeError for a frame
 * the protocol cannot carry. A timestamp past 2^32 (an unwrapped one) is sent
 * modulo 2^32, as the earbud's own clock would be.
 */
export function encodeFrame(f: SspFrame): Uint8Array {
  const len = payloadSize(f);
  if (len > MAX_PAYLOAD) fail(`payload of ${len} bytes is over ${MAX_PAYLOAD}`);
  if (!(f.side in SIDE_CODE)) fail(`unknown side ${String(f.side)}`);
  const out = new Uint8Array(OVERHEAD + len);
  const v = new DataView(out.buffer);
  out[0] = MAGIC0;
  out[1] = MAGIC1;
  out[2] = SSP_VERSION;
  out[3] = FrameType[f.type];
  out[4] = SIDE_CODE[f.side];
  out[5] = f.flags & 0xff;
  v.setUint16(6, f.seq & 0xffff, true);
  v.setUint32(8, Math.floor(f.timestamp) >>> 0, true);
  v.setUint16(12, len, true);
  const p = HEADER_SIZE;
  switch (f.type) {
    case "hello": {
      f.firmware.forEach((x, i) => {
        intIn(x, 0, 255, "firmware version");
        out[p + i] = x;
      });
      out[p + 3] = f.labels.length;
      if (!/^[0-9a-fA-F]{16}$/.test(f.deviceId)) fail("deviceId must be 16 hex digits");
      for (let i = 0; i < 8; i++) out[p + 4 + i] = parseInt(f.deviceId.slice(2 * i, 2 * i + 2), 16);
      intIn(f.eegRate, 0, 0xffff, "eegRate");
      intIn(f.imuRate, 0, 0xffff, "imuRate");
      intIn(f.battery, 0, 255, "battery");
      v.setUint16(p + 12, f.eegRate, true);
      v.setFloat32(p + 14, f.nvPerLsb, true);
      v.setUint16(p + 18, f.imuRate, true);
      out[p + 20] = f.battery;
      f.labels.forEach((label, i) => writeLabel(out, p + 21 + LABEL_SIZE * i, label));
      break;
    }
    case "eeg":
      out[p] = f.samples;
      out[p + 1] = f.channels;
      for (let i = 0; i < f.counts.length; i++) writeInt24(out, p + 2 + 3 * i, f.counts[i]);
      break;
    case "imu":
      out[p] = f.samples;
      for (let i = 0; i < f.values.length; i++) v.setInt16(p + 1 + 2 * i, f.values[i], true);
      break;
    case "event":
      intIn(f.code, 0, 255, "event code");
      intIn(f.value, 0, 0xffffffff, "event value");
      out[p] = f.code;
      v.setUint32(p + 1, f.value, true);
      break;
    case "command": {
      const c = f.command;
      out[p] = OP_CODE[c.op];
      if (c.op === "setEegRate") {
        intIn(c.rate, 0, 0xffff, "rate");
        v.setUint16(p + 1, c.rate, true);
      } else if (c.op === "steer") {
        v.setInt16(p + 1, tenths(c.azimuthDeg, "azimuth"), true);
        v.setInt16(p + 3, tenths(c.gainDb, "gain"), true);
      }
      break;
    }
    case "audioEnv": {
      out[p] = f.samples;
      out[p + 1] = f.talkers;
      f.azimuths.forEach((a, i) => v.setInt16(p + 2 + 2 * i, tenths(a, "talker azimuth"), true));
      const e = p + 2 + 2 * f.talkers;
      for (let i = 0; i < f.envelopes.length; i++) v.setUint16(e + 2 * i, f.envelopes[i], true);
      break;
    }
  }
  v.setUint16(p + len, crc16(out, 0, p + len), true);
  return out;
}

/** Printable ASCII only, NUL padded, cut at 4; the same rule as the firmware's. */
function writeLabel(out: Uint8Array, at: number, label: string) {
  for (let j = 0; j < LABEL_SIZE; j++) {
    const c = j < label.length ? label.charCodeAt(j) : 0;
    if (c === 0) return;
    out[at + j] = c >= 0x20 && c <= 0x7e ? c : 0x3f;
  }
}

/** A host command as one frame, ready to write to the commands characteristic. */
export function encodeCommand(command: HostCommand, header: Partial<FrameHeader> = {}): Uint8Array {
  return encodeFrame({
    type: "command",
    side: header.side ?? "single",
    seq: header.seq ?? 0,
    timestamp: header.timestamp ?? 0,
    flags: header.flags ?? 0,
    command,
  });
}

/* ---- Decoding ------------------------------------------------------------ */

/**
 * The payload of a frame whose header and CRC have been checked, or null when
 * this version cannot read it (an unknown type, or a payload too short for its
 * own counts). A payload longer than needed is fine: later versions append.
 */
function parseFrame(b: Uint8Array, at: number, len: number): SspFrame | null {
  const v = new DataView(b.buffer, b.byteOffset + at, HEADER_SIZE + len);
  const head: FrameHeader = {
    side: SIDES[b[at + 4]],
    seq: v.getUint16(6, true),
    timestamp: v.getUint32(8, true),
    flags: b[at + 5],
  };
  const p = HEADER_SIZE;
  const q = at + p;
  switch (b[at + 3]) {
    case FrameType.hello: {
      if (len < 21) return null;
      const c = b[q + 3];
      if (c < 1 || c > MAX_CHANNELS || len < 21 + LABEL_SIZE * c) return null;
      let deviceId = "";
      for (let i = 0; i < 8; i++) deviceId += b[q + 4 + i].toString(16).padStart(2, "0");
      const labels: string[] = [];
      for (let i = 0; i < c; i++) {
        let s = "";
        for (let j = 0; j < LABEL_SIZE; j++) {
          const ch = b[q + 21 + LABEL_SIZE * i + j];
          if (ch === 0) break;
          s += String.fromCharCode(ch);
        }
        labels.push(s);
      }
      return {
        ...head,
        type: "hello",
        firmware: [b[q], b[q + 1], b[q + 2]],
        deviceId,
        labels,
        eegRate: v.getUint16(p + 12, true),
        nvPerLsb: v.getFloat32(p + 14, true),
        imuRate: v.getUint16(p + 18, true),
        battery: b[q + 20],
      };
    }
    case FrameType.eeg: {
      if (len < 2) return null;
      const n = b[q];
      const c = b[q + 1];
      if (n < 1 || c < 1 || c > MAX_CHANNELS || len < 2 + 3 * n * c) return null;
      const counts = new Int32Array(n * c);
      for (let i = 0; i < counts.length; i++) counts[i] = readInt24(b, q + 2 + 3 * i);
      return { ...head, type: "eeg", channels: c, samples: n, counts };
    }
    case FrameType.imu: {
      if (len < 1) return null;
      const n = b[q];
      if (n < 1 || len < 1 + 20 * n) return null;
      const values = new Int16Array(10 * n);
      for (let i = 0; i < values.length; i++) values[i] = v.getInt16(p + 1 + 2 * i, true);
      return { ...head, type: "imu", samples: n, values };
    }
    case FrameType.event:
      if (len < 5) return null;
      return { ...head, type: "event", code: b[q], value: v.getUint32(p + 1, true) };
    case FrameType.command: {
      const op = OP_NAME[b[q]];
      if (!op || len < OP_SIZE[op]) return null;
      let command: HostCommand;
      if (op === "setEegRate") command = { op, rate: v.getUint16(p + 1, true) };
      else if (op === "steer") command = { op, azimuthDeg: v.getInt16(p + 1, true) / 10, gainDb: v.getInt16(p + 3, true) / 10 };
      else command = { op };
      return { ...head, type: "command", command };
    }
    case FrameType.audioEnv: {
      if (len < 2) return null;
      const n = b[q];
      const k = b[q + 1];
      if (n < 1 || k < 1 || k > MAX_TALKERS || len < 2 + 2 * k + 2 * n * k) return null;
      const azimuths: number[] = [];
      for (let i = 0; i < k; i++) azimuths.push(v.getInt16(p + 2 + 2 * i, true) / 10);
      const envelopes = new Uint16Array(n * k);
      const e = p + 2 + 2 * k;
      for (let i = 0; i < envelopes.length; i++) envelopes[i] = v.getUint16(e + 2 * i, true);
      return { ...head, type: "audioEnv", samples: n, talkers: k, azimuths, envelopes };
    }
    default:
      return null;
  }
}

/** Could a v0 frame start at b[at]? Rejecting impossible headers early keeps a stray "SL" in noise from stalling the stream. */
function plausibleHeader(b: Uint8Array, at: number) {
  return b[at + 2] === SSP_VERSION && b[at + 4] <= 2 && (b[at + 12] | (b[at + 13] << 8)) <= MAX_PAYLOAD;
}

/** Exactly one complete frame, as one BLE notification or write carries it; null when it is not a valid v0 frame. */
export function decodeFrame(bytes: Uint8Array): SspFrame | null {
  if (bytes.length < OVERHEAD || bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1 || !plausibleHeader(bytes, 0)) return null;
  const len = bytes[12] | (bytes[13] << 8);
  if (bytes.length < OVERHEAD + len) return null;
  const crc = bytes[HEADER_SIZE + len] | (bytes[HEADER_SIZE + len + 1] << 8);
  if (crc !== crc16(bytes, 0, HEADER_SIZE + len)) return null;
  return parseFrame(bytes, 0, len);
}

/** A host command as the earbud reads it; null for anything else. */
export function decodeCommand(bytes: Uint8Array): CommandFrame | null {
  const f = decodeFrame(bytes);
  return f && f.type === "command" ? f : null;
}

export interface DecoderStats {
  /** Frames decoded. */
  frames: number;
  /** Candidate frames whose CRC did not match. */
  crcErrors: number;
  /** Breaks in a side's sequence numbers. */
  gaps: number;
  /** Frames those breaks cost. */
  lost: number;
  /** Bytes thrown away while looking for the next frame. */
  skipped: number;
  /** Frames with a good CRC this version cannot read: an unknown type, or a short payload. */
  unreadable: number;
}

/**
 * A streaming decoder: bytes in, in chunks of any size, frames out. A frame
 * may be split across chunks and a chunk may hold several. After a CRC
 * failure it rescans from the byte after the bad frame's magic, not from the
 * end the bad length claimed, so a corrupted length cannot hide the frames
 * behind it. Use one decoder per byte source: two sources' partial frames
 * must not interleave.
 */
export class SspDecoder {
  readonly stats: DecoderStats = { frames: 0, crcErrors: 0, gaps: 0, lost: 0, skipped: 0, unreadable: 0 };
  private buf = new Uint8Array(4096);
  private start = 0;
  private end = 0;
  private readonly lastSeq: (number | null)[] = [null, null, null];

  push(chunk: Uint8Array): SspFrame[] {
    this.append(chunk);
    return this.drain(false);
  }

  /**
   * The end of the stream, as when a recording has been read to its end: a
   * frame still waiting for bytes will never get them, so the length it
   * claimed was corrupt, and anything whole behind it is decoded. The buffer
   * is empty afterwards.
   */
  flush(): SspFrame[] {
    const out = this.drain(true);
    this.stats.skipped += this.end - this.start;
    this.start = this.end = 0;
    return out;
  }

  private drain(final: boolean): SspFrame[] {
    const out: SspFrame[] = [];
    const b = this.buf;
    for (;;) {
      let i = this.start;
      while (i + 1 < this.end && !(b[i] === MAGIC0 && b[i + 1] === MAGIC1)) i++;
      if (i + 1 >= this.end) {
        // No magic yet. A last "S" may be the first half of one.
        const keep = this.end > this.start && b[this.end - 1] === MAGIC0 ? this.end - 1 : this.end;
        this.stats.skipped += keep - this.start;
        this.start = keep;
        break;
      }
      this.stats.skipped += i - this.start;
      this.start = i;
      const haveHeader = this.end - i >= HEADER_SIZE;
      const plausible = haveHeader && plausibleHeader(b, i);
      const len = plausible ? b[i + 12] | (b[i + 13] << 8) : 0;
      const whole = plausible && this.end - i >= OVERHEAD + len;
      // A candidate that may yet be a frame waits for more bytes; at the end of the stream none will come.
      if (!whole && !final && (!haveHeader || plausible)) break;
      if (!whole) {
        this.start++;
        this.stats.skipped++;
        continue;
      }
      const crcAt = i + HEADER_SIZE + len;
      if ((b[crcAt] | (b[crcAt + 1] << 8)) !== crc16(b, i, crcAt)) {
        this.stats.crcErrors++;
        this.start++;
        this.stats.skipped++;
        continue;
      }
      const frame = parseFrame(b, i, len);
      if (b[i + 3] !== FrameType.command) this.track(b[i + 4], b[i + 6] | (b[i + 7] << 8), b[i + 5]);
      this.start = i + OVERHEAD + len;
      if (frame) {
        this.stats.frames++;
        out.push(frame);
      } else {
        this.stats.unreadable++;
      }
    }
    if (this.start === this.end) this.start = this.end = 0;
    return out;
  }

  /** Forgets buffered bytes and sequence state, as after a reconnect. Stats are kept. */
  reset(): void {
    this.start = this.end = 0;
    this.lastSeq.fill(null);
  }

  private append(chunk: Uint8Array) {
    if (this.end + chunk.length > this.buf.length) {
      const live = this.end - this.start;
      if (live + chunk.length <= this.buf.length) {
        this.buf.copyWithin(0, this.start, this.end);
      } else {
        const next = new Uint8Array(Math.max(this.buf.length * 2, live + chunk.length));
        next.set(this.buf.subarray(this.start, this.end));
        this.buf = next;
      }
      this.start = 0;
      this.end = live;
    }
    this.buf.set(chunk, this.end);
    this.end += chunk.length;
  }

  /** Commands are the phone's own frames and keep their own count, so only earbud frames are tracked. */
  private track(side: number, seq: number, flags: number) {
    const last = this.lastSeq[side];
    if (last !== null && !(flags & Flag.streamStart)) {
      const expect = (last + 1) & 0xffff;
      if (seq !== expect) {
        this.stats.gaps++;
        const missing = (seq - expect) & 0xffff;
        if (missing < 0x8000) this.stats.lost += missing;
      }
    }
    this.lastSeq[side] = seq;
  }
}

/* ---- Physical units ------------------------------------------------------ */

/** An EEG frame in microvolts, one array per channel. */
export function eegMicrovolts(frame: EegFrame, nvPerLsb: number): Float32Array[] {
  const k = nvPerLsb / 1000;
  const out = Array.from({ length: frame.channels }, () => new Float32Array(frame.samples));
  for (let s = 0; s < frame.samples; s++) {
    for (let c = 0; c < frame.channels; c++) out[c][s] = frame.counts[s * frame.channels + c] * k;
  }
  return out;
}

export interface ImuSample {
  /** g, head frame. */
  accel: [number, number, number];
  /** Degrees per second, head frame. */
  gyro: [number, number, number];
  /** w, x, y, z. */
  quat: [number, number, number, number];
}

export function imuSamples(frame: ImuFrame): ImuSample[] {
  const out: ImuSample[] = [];
  const v = frame.values;
  for (let i = 0; i < frame.samples; i++) {
    const o = i * 10;
    out.push({
      accel: [v[o] / 1000, v[o + 1] / 1000, v[o + 2] / 1000],
      gyro: [v[o + 3] / 10, v[o + 4] / 10, v[o + 5] / 10],
      quat: [v[o + 6] / QUAT_ONE, v[o + 7] / QUAT_ONE, v[o + 8] / QUAT_ONE, v[o + 9] / QUAT_ONE],
    });
  }
  return out;
}

/**
 * Yaw in degrees of a head frame quaternion (x forward, y right, z down), so
 * positive when the head has turned right: the same sense as a STEER azimuth.
 */
export function yawDeg(w: number, x: number, y: number, z: number): number {
  return (Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180) / Math.PI;
}

/** The quaternion (w, x, y, z) of a head turned by this many degrees of yaw. */
export function yawQuat(deg: number): [number, number, number, number] {
  const h = (deg * Math.PI) / 360;
  return [Math.cos(h), 0, 0, Math.sin(h)];
}

/* ---- Time series on the phone ---------------------------------------------- */

const WRAP = 2 ** 32;

/**
 * Unwraps one earbud's 32 bit microsecond clock. Frames of different types
 * are stamped at their first sample, so they can arrive slightly out of time
 * order; any step back smaller than half the range is taken as that, not as a
 * wrap.
 */
export class ClockUnwrap {
  private last = -1;
  private base = 0;

  push(raw: number): number {
    if (this.last < 0) {
      this.last = raw;
      return raw;
    }
    const d = raw - this.last;
    if (d < -WRAP / 2) this.base += WRAP;
    else if (d > WRAP / 2) return this.base - WRAP + raw;
    this.last = raw;
    return this.base + raw;
  }
}

export interface EegChunk {
  /** Position of data[c][0] in the side's series. */
  index: number;
  /** Unwrapped device microseconds of data[c][0]. */
  time: number;
  /** How many leading values are NaN standing in for lost samples. */
  missing: number;
  /** The series restarts at index (a gap too long to fill, or the earbud's clock went back): nothing before it is continuous with it. */
  restart: boolean;
  /** Microvolts, one array per channel. */
  data: Float32Array[];
}

/**
 * One side's EEG frames as one continuous series. Every EEG frame says when
 * its first sample was taken, so when frames go missing the series gets NaN
 * for exactly the samples lost and every later sample keeps its true place;
 * nothing after a gap is ever shifted. Sequence numbers cannot do this alone:
 * they count frames of every type, not samples. The sample period is measured
 * from the timestamps rather than assumed, in case the ADC and the clock that
 * stamps it run off different crystals. Start a new stream at every HELLO
 * that carries the stream start flag.
 */
export class EegStream {
  private readonly clock = new ClockUnwrap();
  private period: number;
  private next = 0;
  private lastTime = NaN;
  private lastSamples = 0;

  constructor(
    readonly fs: number,
    readonly channels: number,
    readonly nvPerLsb: number,
    /** Longer gaps restart the series instead of filling it. */
    private readonly maxGapSeconds = 30,
  ) {
    this.period = 1e6 / fs;
  }

  /** The series so far, NaN included. */
  get length(): number {
    return this.next;
  }

  /** null for a frame that does not belong (another channel count) or that arrived twice. */
  push(frame: EegFrame): EegChunk | null {
    if (frame.channels !== this.channels) return null;
    const t = this.clock.push(frame.timestamp);
    let missing = 0;
    let restart = false;
    if (!Number.isNaN(this.lastTime)) {
      const step = (t - this.lastTime) / this.period;
      const gap = Math.round(step) - this.lastSamples;
      if (gap === 0) {
        // Contiguous: refine the period from it.
        this.period += (((t - this.lastTime) / this.lastSamples) - this.period) * 0.05;
      } else if (gap < 0) {
        // The same frame twice is dropped. Any other step back means the
        // earbud's clock restarted and its HELLO never arrived.
        if (Math.abs(t - this.lastTime) < this.period / 2) return null;
        restart = true;
      } else if (gap > this.maxGapSeconds * this.fs) {
        restart = true;
        this.next += gap;
      } else {
        missing = gap;
      }
    }
    this.lastTime = t;
    this.lastSamples = frame.samples;
    const n = missing + frame.samples;
    const k = this.nvPerLsb / 1000;
    const data = Array.from({ length: this.channels }, () => new Float32Array(n).fill(NaN));
    for (let s = 0; s < frame.samples; s++) {
      for (let c = 0; c < this.channels; c++) data[c][missing + s] = frame.counts[s * this.channels + c] * k;
    }
    const index = this.next;
    this.next += n;
    return { index, time: t - missing * this.period, missing, restart, data };
  }
}

/**
 * Maps one earbud's device microseconds (unwrapped) onto the phone's
 * milliseconds. The rate ratio of the two crystals is a least squares slope
 * over a sliding window, held at exactly 1 until the window spans enough time
 * to beat the jitter. The offset rides the lower envelope of the arrival
 * delays: a frame is never early but often late (a connection interval, a busy
 * radio), so the earliest arrivals are the truest. Left and right each get
 * one; mapping both onto the phone's clock is what aligns them, well inside
 * the 10 ms the decoder needs.
 */
export class ClockSync {
  private xs: number[] = [];
  private ys: number[] = [];
  private x0 = NaN;
  private slope = 1;
  private offset = NaN;

  private readonly windowMs: number;
  private readonly minSpanMs: number;
  private readonly maxDrift: number;

  constructor(
    opts: {
      /** Arrivals older than this, by device time, are forgotten. Default 60 s. */
      windowMs?: number;
      /** The slope stays at 1 until the window spans this long. Default 10 s. */
      minSpanMs?: number;
      /**
       * The largest clock error believed. Default 10000 ppm: earbud crystals
       * are within 50, but a dev kit clocked by its ADC's internal oscillator
       * may be 0.5% out.
       */
      maxDriftPpm?: number;
    } = {},
  ) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.minSpanMs = opts.minSpanMs ?? 10_000;
    this.maxDrift = (opts.maxDriftPpm ?? 10_000) * 1e-6;
  }

  /** A frame's arrival: device time of its last sample (unwrapped microseconds), and the phone's clock when it arrived. */
  observe(deviceUs: number, hostMs: number): void {
    const x = deviceUs / 1000;
    if (Number.isNaN(this.x0)) this.x0 = x;
    this.xs.push(x - this.x0);
    this.ys.push(hostMs);
    let drop = 0;
    while (this.xs.length - drop > 2 && this.xs[this.xs.length - 1] - this.xs[drop] > this.windowMs) drop++;
    if (drop) {
      this.xs = this.xs.slice(drop);
      this.ys = this.ys.slice(drop);
    }
    this.fit();
  }

  /** Phone milliseconds for a device time; NaN before the first observation. */
  toHost(deviceUs: number): number {
    return this.offset + this.slope * (deviceUs / 1000 - this.x0);
  }

  /** How fast the earbud's clock runs against the phone's, in parts per million. */
  get driftPpm(): number {
    return (1 / this.slope - 1) * 1e6;
  }

  /**
   * The slope goes through the earliest arrival in each eighth of the window,
   * which traces the lower envelope: a least squares line through every
   * arrival would carry the jitter into the slope. It is the median of the
   * slopes between those points (Theil and Sen), so a stretch where every
   * frame came late, a stalled phone, cannot tilt it.
   */
  private fit() {
    const xs = this.xs;
    const ys = this.ys;
    const n = xs.length;
    const span = n > 0 ? xs[n - 1] - xs[0] : 0;
    let b = 1;
    if (n > 2 && span >= this.minSpanMs) {
      const px: number[] = [];
      const py: number[] = [];
      // Earliest relative to the slope so far: at a dev kit's 0.4% the clocks part
      // by as much across one eighth as the jitter itself.
      const ref = this.slope;
      for (let p = 0, i = 0; p < 8; p++) {
        const end = p === 7 ? Infinity : xs[0] + (span * (p + 1)) / 8;
        let best = -1;
        for (; i < n && xs[i] <= end; i++) if (best < 0 || ys[i] - ref * xs[i] < ys[best] - ref * xs[best]) best = i;
        if (best >= 0) {
          px.push(xs[best]);
          py.push(ys[best]);
        }
      }
      if (px.length >= 3) {
        const slopes: number[] = [];
        for (let i = 0; i < px.length; i++) {
          for (let j = i + 1; j < px.length; j++) slopes.push((py[j] - py[i]) / (px[j] - px[i]));
        }
        slopes.sort((u, v) => u - v);
        const m = slopes.length;
        const median = m % 2 ? slopes[(m - 1) / 2] : (slopes[m / 2 - 1] + slopes[m / 2]) / 2;
        b = Math.min(1 + this.maxDrift, Math.max(1 - this.maxDrift, median));
      }
    }
    let a = Infinity;
    for (let i = 0; i < n; i++) a = Math.min(a, ys[i] - b * xs[i]);
    this.slope = b;
    this.offset = a;
  }
}

export interface PairedSample {
  /** Phone milliseconds of the instant. */
  time: number;
  /** Left channels then right channels; NaN for an ear with nothing at this instant. */
  values: number[];
}

/**
 * Pairs the two earbuds' series by time, never by count. The earbuds start
 * streaming at different moments (each is its own connection) and their
 * crystals part by tens of ppm (35 ppm is one sample every two minutes at
 * 250 Hz), so the n-th left sample is not the n-th right sample. Each ear's
 * samples are placed on the phone's clock, through that ear's ClockSync, and
 * a sample pairs with the other ear's sample within half a period of it; an
 * instant one ear has no sample for gets NaN there. An ear that has gone
 * quiet is waited for at most maxWaitMs before the other ear goes on alone.
 */
export class EarAligner {
  private readonly t: [number[], number[]] = [[], []];
  private readonly v: [number[][], number[][]] = [[], []];
  private latest = -Infinity;
  private readonly period: number;

  constructor(
    readonly fs: number,
    /** Channels per ear: left, right. */
    readonly channels: [number, number],
    private readonly maxWaitMs = 500,
  ) {
    this.period = 1000 / fs;
  }

  /** One ear's chunk (EegStream), with the phone time of its first value: sync.toHost(chunk.time). */
  push(ear: "left" | "right", hostMs: number, data: Float32Array[]): void {
    const e = ear === "left" ? 0 : 1;
    const n = data[0]?.length ?? 0;
    for (let s = 0; s < n; s++) {
      this.t[e].push(hostMs + s * this.period);
      this.v[e].push(Array.from({ length: this.channels[e] }, (_, c) => data[c]?.[s] ?? NaN));
    }
    this.latest = Math.max(this.latest, hostMs + (n - 1) * this.period);
  }

  /** Every instant that can be paired now, in time order. */
  pull(): PairedSample[] {
    const out: PairedSample[] = [];
    const [tl, tr] = this.t;
    const half = this.period / 2;
    const nan = (e: 0 | 1) => new Array<number>(this.channels[e]).fill(NaN);
    let i = 0;
    let j = 0;
    for (;;) {
      const l = i < tl.length ? tl[i] : undefined;
      const r = j < tr.length ? tr[j] : undefined;
      if (l === undefined && r === undefined) break;
      if (l !== undefined && r !== undefined) {
        if (Math.abs(l - r) <= half) {
          out.push({ time: (l + r) / 2, values: [...this.v[0][i++], ...this.v[1][j++]] });
        } else if (l < r) {
          out.push({ time: l, values: [...this.v[0][i++], ...nan(1)] });
        } else {
          out.push({ time: r, values: [...nan(0), ...this.v[1][j++]] });
        }
        continue;
      }
      // One ear has nothing queued: it may still deliver this instant.
      const t = (l ?? r)!;
      if (this.latest - t < this.maxWaitMs) break;
      if (l !== undefined) out.push({ time: l, values: [...this.v[0][i++], ...nan(1)] });
      else out.push({ time: t, values: [...nan(0), ...this.v[1][j++]] });
    }
    tl.splice(0, i);
    this.v[0].splice(0, i);
    tr.splice(0, j);
    this.v[1].splice(0, j);
    return out;
  }
}
