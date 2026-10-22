"use client";

/**
 * Plays streamed PCM16 chunks gaplessly through the Web Audio graph and can
 * stop instantly (barge-in). Times are reported on the performance.now()
 * clock so they line up with the rest of the latency measurements.
 *
 * "Playback start" is when the first sample is due at the output device as
 * far as the browser knows: scheduled start plus the context's reported
 * output latency. A Bluetooth link adds its own delay after that, which
 * browsers cannot see.
 */
export class PcmPlayer {
  private nextTime = 0;
  private readonly active = new Set<AudioBufferSourceNode>();
  private firstStart: number | null = null;
  private endedListeners = new Set<() => void>();
  private generation = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
  ) {}

  /** Schedules one chunk; returns its playback start on the performance clock. */
  enqueue(pcm: Int16Array, sampleRate: number): number {
    if (pcm.length === 0) return this.firstStart ?? performance.now();
    const buffer = this.ctx.createBuffer(1, pcm.length, sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 0x8000;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.destination);
    // A small lead keeps the first chunk from being scheduled in the past.
    const startAt = Math.max(this.ctx.currentTime + 0.025, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.active.add(src);
    const gen = this.generation;
    src.onended = () => {
      this.active.delete(src);
      if (gen === this.generation && this.active.size === 0) for (const l of this.endedListeners) l();
    };

    const outputLatency = (this.ctx.outputLatency || this.ctx.baseLatency || 0) * 1000;
    const perfAt = performance.now() + (startAt - this.ctx.currentTime) * 1000 + outputLatency;
    if (this.firstStart === null) this.firstStart = perfAt;
    return perfAt;
  }

  get playing(): boolean {
    return this.active.size > 0;
  }

  /** performance.now() time the current reply started (or will start) playing. */
  get startedAt(): number | null {
    return this.firstStart;
  }

  onEnded(l: () => void): () => void {
    this.endedListeners.add(l);
    return () => this.endedListeners.delete(l);
  }

  /** Stops everything now and forgets the queue. */
  stop() {
    this.generation++;
    for (const src of this.active) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    this.active.clear();
    this.nextTime = 0;
    this.firstStart = null;
  }

  /** Ready for the next reply, without cutting anything still playing. */
  reset() {
    this.firstStart = null;
  }
}
