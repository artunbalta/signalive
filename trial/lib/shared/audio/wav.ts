/**
 * 16 bit PCM WAV encoding and decoding. Isomorphic: the browser encodes what
 * it uploads, the server decodes it to measure it (and, for the mock STT, to
 * tell silence from speech).
 */

export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function int16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! / 0x8000;
  return out;
}

/** Little endian PCM16 bytes (as TTS providers send them) to samples. */
export function pcm16BytesToInt16(bytes: Uint8Array): Int16Array {
  const count = Math.floor(bytes.byteLength / 2);
  const out = new Int16Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function encodeWav(samples: Float32Array | Int16Array, sampleRate: number): Uint8Array {
  const pcm = samples instanceof Int16Array ? samples : floatToInt16(samples);
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // PCM fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i]!, true);
  return new Uint8Array(buf);
}

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  /** First channel only, as floats in [-1, 1]. */
  samples: Float32Array;
  durationMs: number;
}

/** Decodes 16 bit PCM WAV (any channel count; returns channel 0). */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let format = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = v.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === "data") {
      if (format !== 1 || bits !== 16 || channels < 1) throw new Error("only 16 bit PCM WAV is supported");
      const available = Math.min(size, bytes.byteLength - body);
      const frames = Math.floor(available / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = v.getInt16(body + i * 2 * channels, true) / 0x8000;
      return { sampleRate, channels, samples, durationMs: (frames / sampleRate) * 1000 };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** Root mean square level in dBFS; -Infinity for digital silence. */
export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export function peakDbfs(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
