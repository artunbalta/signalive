/**
 * The room's sound: three recorded voices placed around the listener (HRTF
 * panning), a listener that turns with the head, a level per voice for
 * attention, and the spoken recaps. This module is only fetched once
 * someone asks for sound, and nothing plays without that tap.
 */

const VOICES = ["emma", "daniel", "barista"] as const;
/** Metres from the listener to each speaker. */
const DISTANCE = 1.6;
/** Level changes glide over this time constant, so they never click. */
const TAU = 0.08;

async function decode(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

export class RoomAudio {
  private readonly bus: GainNode;
  private readonly levels: GainNode[];
  /** Each voice before its attention level: how loud the speaker is, for their mouth. */
  private readonly analysers: AnalyserNode[];
  private readonly data = new Float32Array(512);
  private readonly recapOut: GainNode;
  private voices: Promise<AudioBuffer[]> | null = null;
  private readonly recaps = new Map<number, Promise<AudioBuffer>>();
  private sources: AudioBufferSourceNode[] = [];
  private recap: AudioBufferSourceNode | null = null;
  private recapRun = 0;

  constructor(
    readonly ctx: AudioContext,
    azimuths: readonly number[],
  ) {
    this.bus = ctx.createGain();
    this.bus.connect(ctx.destination);
    this.analysers = azimuths.map(() => {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      return a;
    });
    this.levels = azimuths.map((deg) => {
      const level = ctx.createGain();
      level.gain.value = 0;
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.rolloffFactor = 0.5;
      const a = (deg * Math.PI) / 180;
      panner.setPosition(Math.sin(a) * DISTANCE, 0, -Math.cos(a) * DISTANCE);
      level.connect(panner).connect(this.bus);
      return level;
    });
    this.recapOut = ctx.createGain();
    this.recapOut.connect(ctx.destination);
  }

  /** The three voices, fetched and decoded once. A failed load is forgotten, to retry. */
  load(): Promise<AudioBuffer[]> {
    if (!this.voices) {
      const voices = Promise.all(VOICES.map((v) => decode(this.ctx, `/media/focus/${v}.mp3`)));
      voices.catch(() => {
        if (this.voices === voices) this.voices = null;
      });
      this.voices = voices;
    }
    return this.voices;
  }

  /** Starts every voice, looping, each a third further in, so the three never line up. */
  start(buffers: AudioBuffer[]) {
    this.stopVoices();
    const at = this.ctx.currentTime + 0.05;
    this.sources = buffers.map((b, i) => {
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(this.analysers[i]);
      src.connect(this.levels[i]);
      src.start(at, (b.duration * i) / buffers.length);
      return src;
    });
  }

  stopVoices() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // never started
      }
      s.disconnect();
    }
    this.sources = [];
  }

  /** The listener turns with the head; the voices stay where they are. */
  setYaw(deg: number) {
    const r = (deg * Math.PI) / 180;
    this.ctx.listener.setOrientation(Math.sin(r), 0, -Math.cos(r), 0, 1, 0);
  }

  /** Linear level per voice. */
  setLevels(levels: readonly number[]) {
    const t = this.ctx.currentTime;
    this.levels.forEach((g, i) => g.gain.setTargetAtTime(levels[i] ?? 0, t, TAU));
  }

  /** 0..1: how loud a speaker is right now, before attention: -50 dB is still, -15 dB wide open. */
  level(i: number): number {
    this.analysers[i].getFloatTimeDomainData(this.data);
    let sum = 0;
    for (const s of this.data) sum += s * s;
    return Math.min(1, Math.max(0, (10 * Math.log10(sum / this.data.length + 1e-12) + 50) / 35));
  }

  /** Everyone in the room steps back while a recap speaks. */
  duck(on: boolean) {
    this.bus.gain.setTargetAtTime(on ? 10 ** (-22 / 20) : 1, this.ctx.currentTime, 0.15);
  }

  /** Speaks one recap; resolves when it ends or is stopped. */
  async playRecap(i: number): Promise<void> {
    this.stopRecap();
    const run = this.recapRun;
    let buffer = this.recaps.get(i);
    if (!buffer) {
      buffer = decode(this.ctx, `/media/focus/recap-${VOICES[i]}.mp3`);
      buffer.catch(() => this.recaps.delete(i));
      this.recaps.set(i, buffer);
    }
    const b = await buffer;
    // Stopped, or replaced, while it loaded.
    if (run !== this.recapRun) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.recapOut);
    this.recap = src;
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      src.start();
    });
    if (this.recap === src) this.recap = null;
  }

  stopRecap() {
    this.recapRun++;
    const src = this.recap;
    this.recap = null;
    if (!src) return;
    try {
      src.stop();
    } catch {
      // never started
    }
    src.disconnect();
  }

  close() {
    this.stopRecap();
    this.stopVoices();
    void this.ctx.close().catch(() => {});
  }
}
