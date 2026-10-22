/**
 * The room's sound: three recorded voices placed around the listener (HRTF
 * panning), a listener that turns with the head, a level per voice for
 * attention, and the clench's replay of the last seconds of one voice, in
 * that voice, from where that person stands. This module is only fetched
 * the first time someone asks for sound or clenches, and nothing plays
 * without that tap.
 *
 * Every voice loops on the room's own clock: at room time t, voice i is at
 * (t + d * i / 3) mod d, d being its length, so the three never line up,
 * and what a clench replays is what that person was saying, sound on or
 * off.
 */

const VOICES = ["emma", "daniel", "barista"] as const;
/** Metres from the listener to each speaker. */
const DISTANCE = 1.6;
/** Level changes glide over this time constant, so they never click. */
const TAU = 0.08;

/** Per voice: its length, and every word with the second it starts. */
type Words = { d: number; w: [string, number][] }[];

/** A replay: its words, each with when it starts in the clip, and when the clip has finished. */
export interface Replay {
  words: [string, number][];
  done: Promise<void>;
}

async function fetchOk(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res;
}

export class RoomAudio {
  private readonly bus: GainNode;
  private readonly levels: GainNode[];
  /** Each voice before its attention level: how loud the speaker is, for their mouth. */
  private readonly analysers: AnalyserNode[];
  private readonly data = new Float32Array(512);
  private loaded: Promise<[AudioBuffer[], Words]> | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private clip: AudioBufferSourceNode | null = null;

  constructor(
    readonly ctx: AudioContext,
    private readonly azimuths: readonly number[],
  ) {
    this.bus = ctx.createGain();
    this.bus.connect(ctx.destination);
    this.analysers = azimuths.map(() => {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      return a;
    });
    this.levels = azimuths.map((_, i) => {
      const level = ctx.createGain();
      level.gain.value = 0;
      level.connect(this.panner(i)).connect(this.bus);
      return level;
    });
  }

  /** A panner where speaker i stands. */
  private panner(i: number) {
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 1;
    p.rolloffFactor = 0.5;
    const a = (this.azimuths[i] * Math.PI) / 180;
    p.setPosition(Math.sin(a) * DISTANCE, 0, -Math.cos(a) * DISTANCE);
    return p;
  }

  /** The three voices and their words, fetched once. A failed load is forgotten, to retry. */
  load() {
    if (!this.loaded) {
      const loaded = Promise.all([
        Promise.all(VOICES.map(async (v) => this.ctx.decodeAudioData(await (await fetchOk(`/media/focus/${v}.mp3`)).arrayBuffer()))),
        fetchOk("/media/focus/words.json").then((r) => r.json() as Promise<Words>),
      ]);
      loaded.catch(() => {
        if (this.loaded === loaded) this.loaded = null;
      });
      this.loaded = loaded;
    }
    return this.loaded;
  }

  /** Where voice i is in its loop at room time t, seconds. */
  private at(i: number, t: number, d: number) {
    return (t + (d * i) / VOICES.length) % d;
  }

  /** Starts every voice, looping, where it is at room time t. */
  start(buffers: AudioBuffer[], t: number) {
    this.stopVoices();
    const when = this.ctx.currentTime + 0.05;
    this.sources = buffers.map((b, i) => {
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(this.analysers[i]);
      src.connect(this.levels[i]);
      src.start(when, this.at(i, t + 0.05, b.duration));
      return src;
    });
  }

  stopVoices() {
    for (const s of this.sources) stop(s);
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

  /** The room steps back while a replay speaks. */
  duck(on: boolean) {
    this.bus.gain.setTargetAtTime(on ? 10 ** (-22 / 20) : 1, this.ctx.currentTime, 0.15);
  }

  /**
   * What speaker i said in the `seconds` up to room time t, said again in
   * their voice: from the first word that starts inside the window to the
   * end of the word they were in the middle of. The window can reach back
   * across the start of the loop, into its previous pass.
   */
  async replay(i: number, t: number, seconds: number): Promise<Replay> {
    this.stopReplay();
    const [buffers, words] = await this.load();
    const b = buffers[i];
    const d = b.duration;
    const now = this.at(i, t, d);
    // Two passes of the words, the previous one shifted back by a loop.
    const passes = [...words[i].w.map(([w, s]): [string, number] => [w, s - d]), ...words[i].w];
    const first = passes.findIndex(([, s]) => s >= now - seconds);
    const last = passes.findIndex(([, s]) => s >= now);
    if (first < 0 || first >= last) return { words: [], done: Promise.resolve() };
    const inside = passes.slice(settle(passes, first), last);
    const next = passes[last];
    const from = inside[0][1];
    const to = Math.min(next ? next[1] : now + 1, now + 1);
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.connect(this.panner(i)).connect(this.ctx.destination);
    this.clip = src;
    const done = new Promise<void>((resolve) => (src.onended = () => resolve()));
    src.start(this.ctx.currentTime + 0.05, ((from % d) + d) % d, to - from);
    return { words: inside.map(([w, s]) => [w, s - from]), done };
  }

  stopReplay() {
    if (this.clip) stop(this.clip);
    this.clip = null;
  }

  close() {
    this.stopReplay();
    this.stopVoices();
    void this.ctx.close().catch(() => {});
  }
}

/**
 * Moves a replay's first word back to the start of its sentence, or failing
 * that of its clause, when that is at most 3 seconds earlier, so it does not
 * begin halfway through one.
 */
function settle(passes: [string, number][], first: number) {
  for (const boundary of [/[.!?]$/, /[,;:]$/]) {
    for (let j = first; j >= 0 && passes[first][1] - passes[j][1] <= 3; j--) {
      if (j === 0 || boundary.test(passes[j - 1][0])) return j;
    }
  }
  return first;
}

function stop(src: AudioBufferSourceNode) {
  try {
    src.stop();
  } catch {
    // never started
  }
  src.disconnect();
}
