/**
 * The most recent `capacity` samples of a stream. Older samples are
 * overwritten in place, so memory stays fixed however long it runs.
 */
export class RingBuffer {
  private readonly data: Float32Array;
  private write = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  push(chunk: Float32Array) {
    const src = chunk.length > this.capacity ? chunk.subarray(chunk.length - this.capacity) : chunk;
    const first = Math.min(src.length, this.capacity - this.write);
    this.data.set(src.subarray(0, first), this.write);
    if (first < src.length) this.data.set(src.subarray(first), 0);
    this.write = (this.write + src.length) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + src.length);
  }

  /** Samples held, up to capacity. */
  get length(): number {
    return this.filled;
  }

  /** The newest n samples (all of them if fewer), oldest first, as a copy. */
  latest(n: number): Float32Array<ArrayBuffer> {
    const count = Math.max(0, Math.min(Math.floor(n), this.filled));
    const out = new Float32Array(count);
    const start = (this.write - count + this.capacity) % this.capacity;
    const first = Math.min(count, this.capacity - start);
    out.set(this.data.subarray(start, start + first));
    if (first < count) out.set(this.data.subarray(0, count - first), first);
    return out;
  }

  /** Forgets everything, and overwrites what was held. */
  clear() {
    this.data.fill(0);
    this.write = 0;
    this.filled = 0;
  }
}
