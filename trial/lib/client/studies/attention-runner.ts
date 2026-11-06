"use client";

import { getEngine } from "@/lib/audio/engine";
import { claimGesture } from "@/lib/gestures/claims";
import { JAW_GESTURES } from "@/lib/gestures/types";
import type { AttentionDecision } from "@sense/session";
import type { TwinRecording } from "@sense/twin";
import { earbuds, loadAttentionModel } from "../earbuds";
import { saveFile } from "../moments-ics";
import { createStore } from "../store";
import {
  DECISION_S,
  ENV_RATE,
  cuedAt,
  envelope64,
  headTarget,
  planSwitches,
  scoreAttention,
  type AttentionScore,
  type CueSegment,
  type StudyDecision,
  type SwitchPlan,
} from "./attention-study";
import { RawRecorder } from "./raw-recorder";

/**
 * Runs the attention study. Two ways in:
 *
 * - files: the earbuds or board connected in Earbuds, and two recordings of
 *   speech chosen from the device (two audiobooks, two podcasts). The phone
 *   plays them at once, one 60 degrees to each side in headphones or one per
 *   speaker, computes each one's envelope as it goes, and hands the
 *   envelopes to the decoder on the phone's own clock, at the moment each
 *   sound leaves the speakers.
 * - replay: no hardware. Two people from the public recordings
 *   research/aad uses, over the same stretch of the same two stories, one
 *   following each, are spliced into one listener who switches when the cue
 *   does, and streamed by the simulated earbuds. The stories' audio is not
 *   public, so nothing plays; the decoder works on the recorded EEG and the
 *   stories' envelopes. The shipped model was trained with these two people,
 *   so a replay shows the study working, not how well it decodes.
 */

export type AttentionSource = "files" | "replay";
export type AttentionOutput = "headphones" | "speakers";

export interface AttentionStudySettings {
  participant: string;
  minutes: number;
  source: AttentionSource;
  output: AttentionOutput;
  record: boolean;
  /** Also say where to face in each cue: the followed voice, the other one, or ahead (experiment 3). */
  head: boolean;
  seed: number;
}

export type AttentionError = "not_connected" | "files_needed" | "files_short" | "decode_failed" | "model_unavailable" | "replay_unavailable";

export interface AttentionStudyView {
  stage: "setup" | "loading" | "running" | "done";
  settings: AttentionStudySettings;
  files: { name: string; seconds: number | null }[];
  plan: SwitchPlan | null;
  elapsedMs: number;
  cue: CueSegment | null;
  decisions: StudyDecision[];
  belief: number[] | null;
  score: AttentionScore | null;
  startedAt: string | null;
  transport: string | null;
  stoppedEarly: boolean;
  recorded: number;
  error: AttentionError | null;
}

export const FULL_ATTENTION = { minutes: 30 } as const;
export const QUICK_ATTENTION = { minutes: 5 } as const;
/** The cue waits this long at the start: the decoder scales itself by the first seconds of signal. */
export const LEAD_MS = 20_000;
/** The voices' directions, degrees, left negative: NEXT.md's two loudspeakers. */
const AZIMUTHS = [-60, 60] as const;
const TICK_MS = 250;

/** The replay's two people (copied to public/vendor by scripts/copy-vendor.mjs). */
const REPLAY = { left: "/vendor/attention/people/clearest", right: "/vendor/attention/people/typical" } as const;
/** The replay's cues on the recordings' own timeline: their 20 s lead, then left, right and left again. */
const REPLAY_CUES: CueSegment[] = [
  { from: 20_000, to: 90_000, talker: 0 },
  { from: 90_000, to: 150_000, talker: 1 },
  { from: 150_000, to: 200_000, talker: 0 },
];

interface PersonFile {
  fsRaw: number;
  channels: string[];
  lsbUv: number;
  offsetsUv: number[];
  samples: number;
  leadSamples: number;
  envelopes: [number[], number[]];
}

function initial(settings?: Partial<AttentionStudySettings>): AttentionStudyView {
  return {
    stage: "setup",
    settings: { participant: "", ...FULL_ATTENTION, source: "files", output: "headphones", record: false, head: false, seed: 0, ...settings },
    files: [],
    plan: null,
    elapsedMs: 0,
    cue: null,
    decisions: [],
    belief: null,
    score: null,
    startedAt: null,
    transport: null,
    stoppedEarly: false,
    recorded: 0,
    error: null,
  };
}

/** One recorded person, in microvolts per channel. */
async function fetchPerson(stem: string): Promise<{ meta: PersonFile; data: Float32Array[] }> {
  const [meta, bin] = await Promise.all([
    fetch(`${stem}.json`).then((r) => (r.ok ? (r.json() as Promise<PersonFile>) : Promise.reject(new Error("replay")))),
    fetch(`${stem}.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("replay")))),
  ]);
  const codes = new Int16Array(bin);
  const C = meta.channels.length;
  const data = Array.from({ length: C }, (_, ch) => {
    const out = new Float32Array(meta.samples);
    for (let k = 0; k < meta.samples; k++) out[k] = codes[k * C + ch]! * meta.lsbUv + meta.offsetsUv[ch]!;
    return out;
  });
  return { meta, data };
}

/**
 * The two people as one listener who follows whichever voice the cue names:
 * each stretch from the person who followed that voice, the second person
 * brought to the first one's level and offset on every electrode, joined
 * with 50 ms cross fades so a join is not a step.
 */
export function spliceListener(a: Float32Array[], b: Float32Array[], fs: number, cues: CueSegment[]): Float32Array[] {
  const fade = Math.round(0.05 * fs);
  return a.map((x, ch) => {
    const y = b[ch]!;
    const n = Math.min(x.length, y.length);
    const stats = (v: Float32Array) => {
      let m = 0;
      for (let i = 0; i < n; i++) m += v[i]!;
      m /= n;
      let s = 0;
      for (let i = 0; i < n; i++) s += (v[i]! - m) ** 2;
      return { m, sd: Math.sqrt(s / n) || 1 };
    };
    const sa = stats(x);
    const sb = stats(y);
    const out = new Float32Array(n);
    // Which person each sample comes from: 0 before the first cue and wherever the left voice is cued.
    const who = new Uint8Array(n);
    for (const c of cues) {
      if (c.talker !== 1) continue;
      for (let i = Math.max(0, Math.round((c.from * fs) / 1000)); i < Math.min(n, Math.round((c.to * fs) / 1000)); i++) who[i] = 1;
    }
    for (let i = 0; i < n; i++) {
      const yb = (y[i]! - sb.m) * (sa.sd / sb.sd) + sa.m;
      // Distance to the nearest change of person, for the cross fade.
      let w = who[i]!;
      for (let d = 1; d <= fade; d++) {
        const l = who[i - d];
        const r = who[i + d];
        if ((l !== undefined && l !== who[i]) || (r !== undefined && r !== who[i])) {
          const t = 0.5 + (0.5 * d) / fade;
          w = who[i] ? t : 1 - t;
          break;
        }
      }
      out[i] = (1 - w) * x[i]! + w * yb;
    }
    return out;
  });
}

class AttentionStudyController {
  readonly view = createStore<AttentionStudyView>(initial());
  private chosen: File[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private release: (() => void)[] = [];
  private recorder: RawRecorder | null = null;
  /** The voices' envelopes at 64 Hz, from the study's first sample. */
  private envs: Float32Array[] = [];
  private sent = 0;
  /** Phone time of the study's time 0, and the study's time now. */
  private phoneAt0 = 0;
  private now: () => number = () => 0;
  private audio: { sources: AudioBufferSourceNode[]; nodes: AudioNode[] } | null = null;
  private lastCue: CueSegment | null = null;

  configure(patch: Partial<AttentionStudySettings>) {
    if (this.view.get().stage !== "setup") return;
    this.view.set((s) => ({ settings: { ...s.settings, ...patch }, error: null }));
  }

  /** The two recordings to play, left first. Their lengths are read when the study starts. */
  chooseFiles(files: File[]) {
    if (this.view.get().stage !== "setup") return;
    this.chosen = files.slice(0, 2);
    this.view.set({ files: this.chosen.map((f) => ({ name: f.name, seconds: null })), error: null });
  }

  /** Call from a tap: audio needs one to start. */
  async start(): Promise<boolean> {
    const s0 = this.view.get();
    if (s0.stage !== "setup") return false;
    const settings = { ...s0.settings };
    if (!settings.seed) settings.seed = (Math.random() * 2 ** 31) >>> 0;
    this.view.set({ stage: "loading", error: null, settings });
    const fail = (error: AttentionError) => {
      this.teardown();
      this.view.set({ stage: "setup", error });
      return false;
    };
    const model = await loadAttentionModel();
    if (!model) return fail("model_unavailable");

    let plan: SwitchPlan;
    if (settings.source === "replay") {
      let left: Awaited<ReturnType<typeof fetchPerson>>;
      let right: Awaited<ReturnType<typeof fetchPerson>>;
      try {
        [left, right] = await Promise.all([fetchPerson(REPLAY.left), fetchPerson(REPLAY.right)]);
      } catch {
        return fail("replay_unavailable");
      }
      const fs = left.meta.fsRaw;
      const durationMs = Math.floor((Math.min(left.meta.samples, right.meta.samples) / fs) * 1000);
      const heads = ["toward", "away", "ahead"] as const;
      plan = {
        cues: REPLAY_CUES.filter((c) => c.from < durationMs).map((c, i) => ({ ...c, to: Math.min(c.to, durationMs), ...(settings.head ? { head: heads[i % 3] } : {}) })),
        durationMs,
        seed: 0,
      };
      const recording: TwinRecording = { fs, labels: left.meta.channels, data: spliceListener(left.data, right.data, fs, plan.cues) };
      await earbuds.connect("simulated", { twin: { recording, sides: { left: [0, 1, 2, 3], right: [4, 5, 6, 7] } } });
      const p = earbuds.connected;
      const twin = earbuds.twin;
      if (!p || !twin) return fail("not_connected");
      // The stories' envelopes start after the recordings' lead.
      const lead = Math.round((left.meta.leadSamples * ENV_RATE) / fs);
      const n = Math.floor((plan.durationMs * ENV_RATE) / 1000);
      this.envs = left.meta.envelopes.map((env) => {
        const out = new Float32Array(n);
        for (let i = 0; i < env.length && lead + i < n; i++) out[lead + i] = env[i]!;
        return out;
      });
      this.now = () => twin.time;
      this.phoneAt0 = p.phoneTime() - twin.time;
    } else {
      const p = earbuds.connected;
      if (!p || earbuds.view.get().phase !== "connected") return fail("not_connected");
      if (this.chosen.length < 2) return fail("files_needed");
      const engine = getEngine();
      await engine.resume().catch(() => undefined);
      let buffers: AudioBuffer[];
      try {
        buffers = await Promise.all(this.chosen.map(async (f) => engine.ctx.decodeAudioData(await f.arrayBuffer())));
      } catch {
        return fail("decode_failed");
      }
      this.view.set({ files: this.chosen.map((f, i) => ({ name: f.name, seconds: Math.round(buffers[i]!.duration) })) });
      const seconds = Math.min(...buffers.map((b) => b.duration));
      if (seconds * 1000 < LEAD_MS + 60_000) return fail("files_short");
      const minutes = Math.min(settings.minutes, seconds / 60);
      plan = planSwitches({ minutes, leadMs: LEAD_MS, head: settings.head, seed: settings.seed });
      this.envs = buffers.map((b) => envelope64(mono(b), b.sampleRate));
      this.play(buffers, settings.output);
      const ctx = engine.ctx;
      const t0 = this.audioStart;
      this.now = () => (ctx.currentTime - t0) * 1000;
      // Phone time of audio time 0: when its first sample leaves the speakers.
      const ts = ctx.getOutputTimestamp?.();
      const perf = ts?.performanceTime ?? performance.now();
      const ctxTime = ts?.contextTime ?? ctx.currentTime;
      this.phoneAt0 = perf + (t0 - ctxTime) * 1000 + (Number.isFinite(ctx.outputLatency) ? 0 : 0);
    }

    const provider = earbuds.connected!;
    provider.usePhoneEnvelopes(model);
    // The jaw does nothing else while the study runs: a clench must not keep a moment mid study.
    for (const type of JAW_GESTURES) this.release.push(claimGesture(type, "none"));
    this.release.push(provider.onDecision((d) => this.onDecision(d)));
    if (settings.record) {
      this.recorder = new RawRecorder(earbuds.sensor);
      this.recorder.start();
    }
    this.sent = 0;
    this.lastCue = null;
    this.view.set({
      stage: "running",
      plan,
      settings,
      decisions: [],
      belief: null,
      score: null,
      startedAt: new Date().toISOString(),
      transport: earbuds.view.get().transport,
      stoppedEarly: false,
      elapsedMs: 0,
      cue: null,
    });
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    return true;
  }

  stop() {
    if (this.view.get().stage !== "running") return;
    this.finish(true);
  }

  reset() {
    this.teardown();
    this.chosen = [];
    this.view.set((s) => initial({ ...s.settings, seed: 0 }));
  }

  private audioStart = 0;

  /** Both voices from the same instant, one each side, equally loud. */
  private play(buffers: AudioBuffer[], output: AttentionOutput) {
    const engine = getEngine();
    const ctx = engine.ctx;
    const out = engine.sources.input("study");
    const t0 = ctx.currentTime + 0.3;
    const sources: AudioBufferSourceNode[] = [];
    const nodes: AudioNode[] = [];
    buffers.forEach((buffer, i) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const az = (AZIMUTHS[i]! * Math.PI) / 180;
      let pan: AudioNode;
      if (output === "headphones") {
        const p = ctx.createPanner();
        p.panningModel = "HRTF";
        p.distanceModel = "linear";
        p.refDistance = 1;
        p.positionX.value = Math.sin(az);
        p.positionY.value = 0;
        p.positionZ.value = -Math.cos(az);
        pan = p;
      } else {
        const p = ctx.createStereoPanner();
        p.pan.value = i === 0 ? -1 : 1;
        pan = p;
      }
      // Both at the same loudness: each scaled to the same RMS.
      const g = ctx.createGain();
      g.gain.value = 0.1 / Math.max(1e-4, rms(buffer));
      src.connect(g).connect(pan).connect(out);
      src.start(t0);
      sources.push(src);
      nodes.push(g, pan);
    });
    this.audio = { sources, nodes };
    this.audioStart = t0;
  }

  /** A soft tone from the side of the voice the cue moved to. */
  private chime(talker: number) {
    const engine = getEngine();
    const ctx = engine.ctx;
    const t = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = talker === 0 ? -0.8 : 0.8;
    osc.frequency.setValueAtTime(880, t);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.06, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(env).connect(pan).connect(engine.sources.input("system"));
    osc.start(t);
    osc.stop(t + 0.4);
  }

  private onDecision(d: AttentionDecision) {
    if (this.view.get().stage !== "running") return;
    const dec: StudyDecision = {
      startMs: Math.round(d.startMs - this.phoneAt0),
      endMs: Math.round(d.endMs - this.phoneAt0),
      talker: d.talker,
      margin: d.margin,
      belief: d.belief.map((p) => Math.round(p * 1e4) / 1e4),
      yawDeg: d.yawDeg === null ? null : Math.round(d.yawDeg * 10) / 10,
      posterior: d.posterior.map((p) => Math.round(p * 1e4) / 1e4),
    };
    this.view.set((s) => {
      const decisions = [...s.decisions, dec];
      return { decisions, belief: dec.belief, score: s.plan ? scoreAttention(s.plan, decisions, s.elapsedMs, AZIMUTHS) : null };
    });
  }

  private tick() {
    const s = this.view.get();
    const plan = s.plan;
    if (s.stage !== "running" || !plan) return;
    const elapsed = Math.max(0, this.now());
    // Envelope samples heard by now, placed at the phone time they were heard.
    const upTo = Math.min(this.envs[0]?.length ?? 0, Math.floor((elapsed * ENV_RATE) / 1000));
    if (upTo > this.sent) {
      earbuds.connected?.envelopesAt(this.phoneAt0 + (this.sent * 1000) / ENV_RATE, this.envs.map((e) => e.subarray(this.sent, upTo)));
      this.sent = upTo;
    }
    const cue = cuedAt(plan, elapsed);
    if (cue && cue !== this.lastCue) {
      if (s.settings.source === "files") this.chime(cue.talker);
      // The replay's listener turns as the cue says, so head and EEG can be weighed against each other.
      const yaw = s.settings.source === "replay" ? headTarget(cue, AZIMUTHS) : null;
      if (yaw !== null) earbuds.twin?.setYaw(yaw);
    }
    this.lastCue = cue;
    if (elapsed >= plan.durationMs) {
      this.view.set({ elapsedMs: plan.durationMs });
      this.finish(false);
      return;
    }
    this.view.set({ elapsedMs: Math.round(elapsed), cue, recorded: this.recorder?.samples ?? 0 });
  }

  private finish(early: boolean) {
    const s = this.view.get();
    this.teardown(false);
    this.view.set({
      stage: "done",
      stoppedEarly: early,
      cue: null,
      recorded: this.recorder?.samples ?? 0,
      score: s.plan ? scoreAttention(s.plan, s.decisions, early ? s.elapsedMs : Infinity, AZIMUTHS) : null,
    });
  }

  private teardown(dropRecording = true) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.release.splice(0)) r();
    if (this.audio) {
      for (const src of this.audio.sources) {
        try {
          src.stop();
        } catch {
          // Never started.
        }
        src.disconnect();
      }
      for (const n of this.audio.nodes) n.disconnect();
      this.audio = null;
    }
    this.recorder?.stop();
    if (dropRecording) this.recorder = null;
  }

  report() {
    const s = this.view.get();
    return {
      study: "attention",
      version: 1,
      protocol: "research/NEXT.md, experiment 2",
      participant: s.settings.participant || null,
      startedAt: s.startedAt,
      transport: s.transport,
      source: s.settings.source,
      output: s.settings.output,
      files: s.files,
      azimuthsDeg: AZIMUTHS,
      headConditions: s.settings.head,
      decisionSeconds: DECISION_S,
      stoppedEarly: s.stoppedEarly,
      elapsedMs: s.elapsedMs,
      plan: s.plan,
      decisions: s.decisions,
      score: s.score,
      // The voices' envelopes at 64 Hz, as the decoder had them, for rescoring offline.
      envelopes: this.envs.map((e) => Array.from(e.subarray(0, Math.floor((s.elapsedMs * ENV_RATE) / 1000)), (v) => Math.round(v * 1e5) / 1e5)),
    };
  }

  private stem() {
    const s = this.view.get();
    const who = (s.settings.participant || "anon").replace(/[^\w-]+/g, "_").slice(0, 24);
    return `signalive-attention-${who}-${(s.startedAt ?? new Date().toISOString()).slice(0, 16).replace(/[:T]/g, "-")}`;
  }

  saveReport() {
    saveFile(`${this.stem()}.json`, JSON.stringify(this.report()), "application/json");
  }

  saveRaw() {
    const blob = this.recorder?.toBlob({ study: "attention", phoneAt0Ms: this.phoneAt0, plan: this.view.get().plan });
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.stem()}.ssr`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  get hasRaw(): boolean {
    return (this.recorder?.samples ?? 0) > 0;
  }
}

function mono(b: AudioBuffer): Float32Array {
  if (b.numberOfChannels === 1) return b.getChannelData(0);
  const out = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < b.length; i++) out[i]! += d[i]! / b.numberOfChannels;
  }
  return out;
}

function rms(b: AudioBuffer): number {
  const d = b.getChannelData(0);
  let s = 0;
  const step = Math.max(1, Math.floor(d.length / 200_000));
  let n = 0;
  for (let i = 0; i < d.length; i += step) {
    s += d[i]! * d[i]!;
    n++;
  }
  return Math.sqrt(s / Math.max(1, n));
}

export const attentionStudy = new AttentionStudyController();
