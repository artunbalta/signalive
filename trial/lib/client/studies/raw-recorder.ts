import type { SensorProvider } from "@/lib/extensions/sensor-provider";

/**
 * Keeps every sample a sensor provider streams, for a study's raw file: the
 * clench detector's thresholds and the attention decoder can then be tuned
 * offline on the very session that was scored, without asking the person to
 * come back.
 *
 * The file (.ssr, "Signalive study recording") is "SSR1", the header's
 * length as a little endian uint32, the header as UTF-8 JSON, then every
 * channel's samples as little endian float32, channel after channel in the
 * header's order. The header lists each channel's chunks as they arrived:
 * the phone time of a chunk's first sample (ms, performance.now()) and its
 * length, so time is kept even across lost frames.
 * research/aad/study_read.py reads it.
 */

interface Chunk {
  t: number;
  values: Float32Array;
}

export class RawRecorder {
  private readonly channels = new Map<string, Chunk[]>();
  private running = false;
  private count = 0;

  constructor(private readonly provider: SensorProvider) {}

  get samples(): number {
    return this.count;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void (async () => {
      for await (const s of this.provider.stream()) {
        if (!this.running) break;
        let list = this.channels.get(s.channelId);
        if (!list) this.channels.set(s.channelId, (list = []));
        list.push({ t: s.t, values: s.values.slice() });
        this.count += s.values.length;
      }
    })().catch(() => undefined);
  }

  stop() {
    this.running = false;
  }

  toBlob(meta: Record<string, unknown>): Blob | null {
    if (!this.count) return null;
    const caps = this.provider.capabilities.channels;
    const header = {
      format: "ssr",
      version: 1,
      ...meta,
      channels: [...this.channels.entries()].map(([id, chunks]) => {
        const cap = caps.find((c) => c.id === id);
        return {
          id,
          kind: cap?.kind ?? null,
          rateHz: cap?.rateHz ?? null,
          unit: cap?.unit ?? null,
          chunks: chunks.map((c) => [Math.round(c.t * 1000) / 1000, c.values.length]),
        };
      }),
    };
    const json = new TextEncoder().encode(JSON.stringify(header));
    const head = new ArrayBuffer(8);
    new Uint8Array(head).set([0x53, 0x53, 0x52, 0x31]);
    new DataView(head).setUint32(4, json.length, true);
    const parts: BlobPart[] = [head, json];
    for (const chunks of this.channels.values()) for (const c of chunks) parts.push(littleEndian(c.values));
    return new Blob(parts, { type: "application/octet-stream" });
  }
}

/** Float32 samples as little endian bytes whatever the platform's order. */
function littleEndian(values: Float32Array): ArrayBuffer {
  const out = new ArrayBuffer(values.length * 4);
  const view = new DataView(out);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i]!, true);
  return out;
}
