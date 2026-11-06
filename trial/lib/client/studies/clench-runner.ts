"use client";

import { getEngine, peekEngine } from "@/lib/audio/engine";
import { gestureBus } from "@/lib/gestures/bus";
import { claimGesture } from "@/lib/gestures/claims";
import { JAW_GESTURES, type GestureEvent, type GestureType, type GestureWithdrawal } from "@/lib/gestures/types";
import { earbuds } from "../earbuds";
import { nativeApi, saveFile } from "../moments-ics";
import { createStore } from "../store";
import {
  BARS,
  RESPONSE_MS,
  mulberry32,
  planClenchStudy,
  scoreClenchStudy,
  type ClenchKind,
  type ClenchStudyPlan,
  type ClenchStudyScore,
  type StudyCondition,
  type StudyDetection,
  type StudyPrompt,
} from "./clench-study";
import { RawRecorder } from "./raw-recorder";

/**
 * Runs the clench study on whatever earbuds Settings has connected: the
 * simulated ones, Signalive earbuds over Bluetooth, or an OpenBCI board. It
 * sounds each cue of the plan (one beep for a single clench, two for a
 * double, a long tone for a hold), takes the jaw gestures the detector
 * reports, and scores them as they come (clench-study.ts). While it runs the
 * jaw gestures do nothing else: sixty practice clenches must not become
 * sixty moments.
 *
 * With the simulated earbuds a simulated participant can take part: it
 * answers most cues after a human's reaction time, now and then with the
 * wrong kind, and it chews (bursts of jaw activity at a chewing rhythm) in
 * the chewing condition and through a meal in the free period, which is
 * exactly what the study exists to catch.
 */

export type ClenchStudyStage = "setup" | "running" | "done";

export interface ClenchStudySettings {
  participant: string;
  perKind: number;
  freeMinutes: number;
  /** Gaps between cues, and the time to settle into each condition, ms. */
  minGapMs: number;
  maxGapMs: number;
  changeMs: number;
  /** A simulated participant answers the cues; only with the simulated earbuds. */
  simulate: boolean;
  /** Keep every electrode's samples for offline tuning. */
  record: boolean;
  seed: number;
}

export interface ClenchStudyView {
  stage: ClenchStudyStage;
  settings: ClenchStudySettings;
  plan: ClenchStudyPlan | null;
  /** Since the start, ms. */
  elapsedMs: number;
  /** The cue being answered, while its window is open. */
  current: StudyPrompt | null;
  /** Cues sounded so far. */
  cued: number;
  condition: StudyCondition | null;
  /** In the free period. */
  free: boolean;
  detections: StudyDetection[];
  /** Reports the earbuds took back as chewing; they count for nothing. */
  withdrawn: StudyDetection[];
  score: ClenchStudyScore | null;
  startedAt: string | null;
  transport: string | null;
  /** The study ended before its plan did. */
  stoppedEarly: boolean;
  /** Samples kept so far, all channels, when recording. */
  recorded: number;
  error: "not_connected" | "not_listening" | null;
}

/** NEXT.md's protocol. */
export const FULL_STUDY = { perKind: 20, freeMinutes: 20, minGapMs: 6000, maxGapMs: 15000, changeMs: 8000 } as const;
/** Long enough to see every screen and every kind; for a first try and for tests. */
export const QUICK_STUDY = { perKind: 2, freeMinutes: 0.5, minGapMs: 4000, maxGapMs: 7000, changeMs: 4000 } as const;

const KIND_OF: Partial<Record<GestureType, ClenchKind>> = {
  jaw_clench: "single",
  jaw_double_clench: "double",
  jaw_hold: "hold",
};

const TICK_MS = 100;

/** The simulated participant: how often it answers, how often with the wrong kind, how fast. */
const SIM = { answers: 0.96, wrongKind: 0.03, reactMinMs: 450, reactMaxMs: 950, chewEveryMs: 750, chewRun: 5 } as const;

function initial(settings?: Partial<ClenchStudySettings>): ClenchStudyView {
  return {
    stage: "setup",
    settings: { participant: "", ...FULL_STUDY, simulate: true, record: false, seed: 0, ...settings },
    plan: null,
    elapsedMs: 0,
    current: null,
    cued: 0,
    condition: null,
    free: false,
    detections: [],
    withdrawn: [],
    score: null,
    startedAt: null,
    transport: null,
    stoppedEarly: false,
    recorded: 0,
    error: null,
  };
}

class ClenchStudyController {
  readonly view = createStore<ClenchStudyView>(initial());
  private t0 = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private release: (() => void)[] = [];
  private recorder: RawRecorder | null = null;

  configure(patch: Partial<ClenchStudySettings>) {
    if (this.view.get().stage !== "setup") return;
    this.view.set((s) => ({ settings: { ...s.settings, ...patch }, error: null }));
  }

  /** Call from a tap: the cues need the audio engine, which a tap unlocks. */
  start(): boolean {
    const ev = earbuds.view.get();
    if (ev.phase !== "connected") {
      this.view.set({ error: "not_connected" });
      return false;
    }
    if (!ev.listening) {
      this.view.set({ error: "not_listening" });
      return false;
    }
    const settings = { ...this.view.get().settings };
    if (!settings.seed) settings.seed = (Math.random() * 2 ** 31) >>> 0;
    if (!earbuds.twin) settings.simulate = false;
    const plan = planClenchStudy({
      perKind: settings.perKind,
      freeMinutes: settings.freeMinutes,
      minGapMs: settings.minGapMs,
      maxGapMs: settings.maxGapMs,
      changeMs: settings.changeMs,
      seed: settings.seed,
    });
    try {
      void getEngine().ctx.resume().catch(() => undefined);
    } catch {
      // No audio output here: the cues are silent and the study still runs.
    }

    for (const type of JAW_GESTURES) this.release.push(claimGesture(type, "none"));
    this.release.push(gestureBus.subscribe((e) => this.onGesture(e)));
    this.release.push(gestureBus.onWithdraw((w) => this.onWithdrawn(w)));
    if (settings.record) {
      this.recorder = new RawRecorder(earbuds.sensor);
      this.recorder.start();
    }
    this.t0 = performance.now();
    this.view.set({
      ...initial(settings),
      stage: "running",
      plan,
      settings,
      startedAt: new Date().toISOString(),
      transport: ev.transport,
      condition: plan.conditionStarts[0]?.condition ?? null,
    });
    if (settings.simulate) this.simulate(plan, settings.seed);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    return true;
  }

  /** Ends the study where it is and scores what it got. */
  stop() {
    if (this.view.get().stage !== "running") return;
    this.finish(true);
  }

  reset() {
    this.teardown();
    this.view.set((s) => initial({ ...s.settings, seed: 0 }));
  }

  private onGesture(e: GestureEvent) {
    const kind = KIND_OF[e.type];
    if (!kind || e.source !== "sensor" || this.view.get().stage !== "running") return;
    const d: StudyDetection = { kind, at: Math.round(e.at - this.t0) };
    if (typeof e.detail?.latencyMs === "number") d.latencyMs = e.detail.latencyMs;
    if (typeof e.detail?.confidence === "number") d.confidence = e.detail.confidence;
    this.view.set((s) => {
      const detections = [...s.detections, d];
      return { detections, score: s.plan ? scoreClenchStudy(s.plan, detections, s.elapsedMs) : null };
    });
  }

  /** A report the earbuds took back (a bite, not a clench) stops counting, for or against. */
  private onWithdrawn(w: GestureWithdrawal) {
    const kind = KIND_OF[w.type];
    if (!kind || w.source !== "sensor" || this.view.get().stage !== "running") return;
    const at = Math.round(w.of - this.t0);
    this.view.set((s) => {
      const i = s.detections.findIndex((d) => d.at === at && d.kind === kind);
      if (i < 0) return {};
      const detections = s.detections.filter((_, j) => j !== i);
      return {
        detections,
        withdrawn: [...s.withdrawn, s.detections[i]!],
        score: s.plan ? scoreClenchStudy(s.plan, detections, s.elapsedMs) : null,
      };
    });
  }

  private tick() {
    const s = this.view.get();
    const plan = s.plan;
    if (s.stage !== "running" || !plan) return;
    const elapsed = performance.now() - this.t0;
    let cued = s.cued;
    for (let p = plan.prompts[cued]; p && p.at <= elapsed; p = plan.prompts[++cued]) this.cue(p.kind);
    const last = cued > 0 ? (plan.prompts[cued - 1] ?? null) : null;
    const current = last && elapsed - last.at <= RESPONSE_MS ? last : null;
    let condition: StudyCondition | null = null;
    for (const c of plan.conditionStarts) if (c.at <= elapsed) condition = c.condition;
    if (elapsed >= plan.freeTo) {
      this.view.set({ elapsedMs: plan.freeTo, cued });
      this.finish(false);
      return;
    }
    this.view.set({
      elapsedMs: Math.round(elapsed),
      cued,
      current,
      condition,
      free: elapsed >= plan.freeFrom,
      recorded: this.recorder?.samples ?? 0,
      score: scoreClenchStudy(plan, s.detections, elapsed),
    });
  }

  private finish(early: boolean) {
    const s = this.view.get();
    this.teardown(false);
    const until = early ? s.elapsedMs : Infinity;
    this.view.set({
      stage: "done",
      current: null,
      stoppedEarly: early,
      recorded: this.recorder?.samples ?? 0,
      score: s.plan ? scoreClenchStudy(s.plan, s.detections, until) : null,
    });
  }

  private teardown(dropRecording = true) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts = [];
    for (const r of this.release.splice(0)) r();
    this.recorder?.stop();
    if (dropRecording) this.recorder = null;
  }

  /**
   * One beep for a single clench, two for a double, a long tone for a hold,
   * and a tap of the phone inside the Signalive app.
   */
  private cue(kind: ClenchKind) {
    const haptics = nativeApi()?.haptics;
    if (haptics && typeof haptics.impact === "function") void haptics.impact("medium").catch(() => undefined);
    const engine = peekEngine();
    if (!engine || engine.ctx.state !== "running") return;
    const ctx = engine.ctx;
    const beeps: [number, number][] = kind === "single" ? [[0, 0.14]] : kind === "double" ? [[0, 0.12], [0.26, 0.12]] : [[0, 0.7]];
    const t0 = ctx.currentTime + 0.01;
    for (const [start, len] of beeps) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(kind === "hold" ? 660 : 990, t0 + start);
      env.gain.setValueAtTime(0, t0 + start);
      env.gain.linearRampToValueAtTime(0.08, t0 + start + 0.01);
      env.gain.setValueAtTime(0.08, t0 + start + len - 0.03);
      env.gain.linearRampToValueAtTime(0, t0 + start + len);
      osc.connect(env).connect(engine.sources.input("system"));
      osc.start(t0 + start);
      osc.stop(t0 + start + len + 0.02);
    }
  }

  /** The simulated participant's whole session, scheduled up front on the study's clock. */
  private simulate(plan: ClenchStudyPlan, seed: number) {
    const rand = mulberry32(seed ^ 0x5eed);
    const at = (ms: number, fn: () => void) => this.timeouts.push(setTimeout(fn, Math.max(0, ms - (performance.now() - this.t0))));
    const clench = (kind: ClenchKind) => earbuds.clench(kind);
    const chew = (from: number, bites: number) => {
      for (let b = 0; b < bites; b++) at(from + b * SIM.chewEveryMs, () => clench("single"));
    };
    for (const p of plan.prompts) {
      if (rand() < SIM.answers) {
        const others = (["single", "double", "hold"] as const).filter((k) => k !== p.kind);
        const kind = rand() < SIM.wrongKind ? others[Math.floor(rand() * others.length)]! : p.kind;
        at(p.at + SIM.reactMinMs + rand() * (SIM.reactMaxMs - SIM.reactMinMs), () => clench(kind));
      }
      // Chewing gum between cues, clear of the windows where an answer is expected.
      const next = plan.prompts[p.i + 1];
      const gapEnd = next ? next.at : plan.freeFrom;
      const run = SIM.chewRun * SIM.chewEveryMs;
      if (p.condition === "chewing" && gapEnd - (p.at + RESPONSE_MS) > run + 1500) chew(p.at + RESPONSE_MS + 500, SIM.chewRun);
    }
    // A meal in the free period: twenty bites every four minutes, the first soon after it begins.
    const first = Math.min(30_000, (plan.freeTo - plan.freeFrom) / 4);
    for (let t = plan.freeFrom + first; t + 20 * SIM.chewEveryMs < plan.freeTo; t += 240_000) chew(t, 20);
  }

  /** Everything needed to recompute the score or compare detectors: the plan, every report, the result, the bars. */
  report() {
    const s = this.view.get();
    return {
      study: "clench",
      version: 1,
      protocol: "research/NEXT.md, experiment 1",
      participant: s.settings.participant || null,
      startedAt: s.startedAt,
      transport: s.transport,
      simulatedParticipant: s.settings.simulate,
      earbuds: earbuds.view.get().earbuds,
      settings: s.settings,
      stoppedEarly: s.stoppedEarly,
      elapsedMs: s.elapsedMs,
      bars: BARS,
      responseWindowMs: RESPONSE_MS,
      plan: s.plan,
      detections: s.detections,
      withdrawn: s.withdrawn,
      score: s.score && { ...s.score, results: undefined },
      prompts: s.score?.results.map((r) => ({
        i: r.prompt.i,
        kind: r.prompt.kind,
        condition: r.prompt.condition,
        cueMs: r.prompt.at,
        outcome: r.outcome,
        detected: r.detected,
        responseMs: r.responseMs,
        latencyMs: r.detection?.latencyMs ?? null,
      })),
    };
  }

  private stem() {
    const s = this.view.get();
    const who = (s.settings.participant || "anon").replace(/[^\w-]+/g, "_").slice(0, 24);
    return `signalive-clench-${who}-${(s.startedAt ?? new Date().toISOString()).slice(0, 16).replace(/[:T]/g, "-")}`;
  }

  saveReport() {
    saveFile(`${this.stem()}.json`, JSON.stringify(this.report(), null, 1), "application/json");
  }

  saveCsv() {
    const rows = this.report().prompts ?? [];
    const head = "i,kind,condition,cue_ms,outcome,detected,response_ms,latency_ms";
    const lines = rows.map((r) =>
      [r.i, r.kind, r.condition, r.cueMs, r.outcome, r.detected ?? "", r.responseMs ?? "", r.latencyMs ?? ""].join(","),
    );
    saveFile(`${this.stem()}.csv`, [head, ...lines].join("\n") + "\n", "text/csv");
  }

  /** The raw samples, when the study kept them: one binary file, a JSON header in front (raw-recorder.ts). */
  saveRaw() {
    const blob = this.recorder?.toBlob({ study: "clench", startedAtMs: this.t0, plan: this.view.get().plan });
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

export const clenchStudy = new ClenchStudyController();
