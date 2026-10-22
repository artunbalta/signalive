"use client";

import { loadVad, VadRunner } from "@/lib/audio/vad";
import { VAD_NORMAL, VAD_WHISPER, type VadEvent } from "@/lib/audio/vad-segmenter";
import { encodeWav } from "@/lib/shared/audio/wav";
import { MAX_SEGMENT_MS, NOTES_BATCH_MS, NOTES_BATCH_UTTERANCES } from "@/lib/shared/constants";
import type { Mark, Note, Utterance } from "@/lib/shared/types";
import { api, apiFetch, ApiError } from "./api";
import { assistant } from "./assistant";
import { live, type AssistantState } from "./live";
import { micManager } from "./mic-manager";
import { getPrefs } from "./prefs";
import { registerRecorder } from "./recorder-controls";
import { sessionId } from "./session";
import { createStore } from "./store";

/**
 * Continuous capture: the VAD cuts the microphone into utterances, each is
 * transcribed on the server, and notes are made every few utterances or
 * minutes, on request, and when recording stops.
 *
 * Nothing records without a tap on Start, the banner is visible on every
 * screen while it runs, and the assistant's own turns (your question and its
 * spoken reply) are left out: the recorder pauses while the assistant works.
 */

export interface RecorderView {
  state: "off" | "starting" | "on" | "paused" | "stopping";
  utterances: Utterance[];
  pending: number;
  failed: number;
  notes: Note[];
  makingNotes: boolean;
  marking: boolean;
  speaking: boolean;
  error: string | null;
}

const BUSY: AssistantState[] = ["listening", "hearing", "transcribing", "thinking", "searching", "speaking"];
const UPLOAD_CONCURRENCY = 2;

const wallClock = (perfAt: number) => Date.now() - (performance.now() - perfAt);

class RecorderController {
  readonly view = createStore<RecorderView>({
    state: "off",
    utterances: [],
    pending: 0,
    failed: 0,
    notes: [],
    makingNotes: false,
    marking: false,
    speaking: false,
    error: null,
  });

  private runner: VadRunner | null = null;
  private offLive: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private userPaused = false;
  private sinceNotes = 0;
  private lastNotesAt = "";
  private lastNotesClock = 0;
  private active = 0;
  private waiting: (() => void)[] = [];
  private idleWaiters: (() => void)[] = [];

  async start() {
    if (this.view.get().state !== "off") return;
    this.view.set({ state: "starting", error: null, utterances: [], notes: [], failed: 0 });
    try {
      if (assistant.view.get().handsFree) await assistant.setHandsFree(false);
      const mic = await micManager.ensure();
      const model = await loadVad();
      const runner = new VadRunner(model, (e) => this.onVad(e), {
        ...(getPrefs().whisper ? VAD_WHISPER : VAD_NORMAL),
        maxSpeechMs: MAX_SEGMENT_MS,
      });
      runner.attach(mic);
      this.runner = runner;
    } catch (err) {
      this.view.set({ state: "off", error: err instanceof ApiError ? err.code : "vad_failed" });
      return;
    }
    this.userPaused = false;
    this.sinceNotes = 0;
    this.lastNotesAt = new Date().toISOString();
    this.lastNotesClock = Date.now();
    // The assistant's turns are not part of the recording.
    this.offLive = live.subscribe(() => this.syncPause());
    this.timer = setInterval(() => {
      if (this.sinceNotes > 0 && Date.now() - this.lastNotesClock >= NOTES_BATCH_MS) void this.makeNotes("batch");
    }, 15_000);
    this.view.set({ state: "on" });
    live.set({ recording: "on", recordingKeepsAudio: !!getPrefs().keepRawAudio });
  }

  private syncPause() {
    if (!this.runner) return;
    const assistantBusy = BUSY.includes(live.get().assistant) && !assistant.view.get().handsFree;
    this.runner.setPaused(this.userPaused || assistantBusy);
  }

  pause() {
    if (this.view.get().state !== "on") return;
    this.userPaused = true;
    this.syncPause();
    this.view.set({ state: "paused", speaking: false });
    live.set({ recording: "paused" });
  }

  resume() {
    if (this.view.get().state !== "paused") return;
    this.userPaused = false;
    this.syncPause();
    this.view.set({ state: "on" });
    live.set({ recording: "on" });
  }

  async stop() {
    const state = this.view.get().state;
    if (state === "off" || state === "stopping") return;
    this.view.set({ state: "stopping", speaking: false });
    this.runner?.detach();
    this.runner = null;
    this.offLive?.();
    this.offLive = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    live.set({ recording: "off", recordingKeepsAudio: false });
    await this.idle();
    if (this.sinceNotes > 0) await this.makeNotes("batch");
    this.view.set({ state: "off" });
  }

  toggle() {
    const s = this.view.get().state;
    if (s === "off") void this.start();
    else if (s === "on") this.pause();
    else if (s === "paused") this.resume();
  }

  /* ------------------------------------------------------------------------
     Segments
     --------------------------------------------------------------------- */

  private onVad(e: VadEvent) {
    if (e.type === "start") this.view.set({ speaking: true });
    else if (e.type === "misfire") this.view.set({ speaking: false });
    else if (e.type === "end") {
      this.view.set({ speaking: !!e.forced });
      const endedAt = wallClock(e.at);
      const startedAt = endedAt - (e.audio.length / 16000) * 1000;
      void this.upload(e.audio, new Date(startedAt).toISOString(), new Date(endedAt).toISOString());
    }
  }

  private async slot(): Promise<void> {
    if (this.active < UPLOAD_CONCURRENCY) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
    if (this.active === 0 && this.view.get().pending === 0) for (const r of this.idleWaiters.splice(0)) r();
  }

  /** Resolves once every queued segment has been uploaded (or failed). */
  idle(): Promise<void> {
    if (this.view.get().pending === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async upload(audio: Float32Array, startedAt: string, endedAt: string) {
    const sid = sessionId();
    if (!sid) return;
    this.view.set((s) => ({ pending: s.pending + 1 }));
    await this.slot();
    try {
      const meta = { sessionId: sid, startedAt, endedAt, speechLang: getPrefs().speechLang ?? "auto", keepAudio: !!getPrefs().keepRawAudio };
      const wav = encodeWav(audio, 16000);
      let result: { utterance: Utterance | null } | null = null;
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        const form = new FormData();
        form.append("meta", JSON.stringify(meta));
        form.append("audio", new Blob([wav as BlobPart], { type: "audio/wav" }), "segment.wav");
        try {
          result = await (await apiFetch("/api/recorder/segment", { method: "POST", body: form })).json();
        } catch (err) {
          if (attempt === 1 || (err instanceof ApiError && err.status >= 400 && err.status < 500)) throw err;
        }
      }
      if (result?.utterance) {
        this.view.set((s) => ({ utterances: [...s.utterances, result!.utterance!].slice(-200) }));
        this.sinceNotes++;
        if (this.sinceNotes >= NOTES_BATCH_UTTERANCES) void this.makeNotes("batch");
      }
    } catch (err) {
      this.view.set((s) => ({ failed: s.failed + 1, error: err instanceof ApiError ? err.code : "network" }));
    } finally {
      this.view.set((s) => ({ pending: s.pending - 1 }));
      this.release();
    }
  }

  /* ------------------------------------------------------------------------
     Notes and marks
     --------------------------------------------------------------------- */

  async makeNotes(source: "batch" | "on_demand") {
    if (this.view.get().makingNotes) return;
    this.view.set({ makingNotes: true });
    try {
      await this.idle();
      const to = new Date().toISOString();
      const note = await api<Note>("/api/notes/extract", {
        method: "POST",
        json: { sessionId: sessionId(), source, from: this.lastNotesAt, to },
      });
      this.lastNotesAt = to;
      this.lastNotesClock = Date.now();
      this.sinceNotes = 0;
      this.view.set((s) => ({ notes: [note, ...s.notes] }));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "nothing_to_summarize")) {
        this.view.set({ error: err instanceof ApiError ? err.code : "network" });
      }
    } finally {
      this.view.set({ makingNotes: false });
    }
  }

  /** Tags the last 60 seconds and makes a note of them. */
  async mark() {
    if (this.view.get().state === "off" || this.view.get().marking) return;
    this.view.set({ marking: true });
    try {
      const sid = sessionId();
      if (!sid) return;
      const mark = await api<Mark>("/api/marks", { method: "POST", json: { sessionId: sid } });
      // Let the segment being spoken right now, if any, land first.
      await new Promise((r) => setTimeout(r, this.view.get().speaking ? 1200 : 0));
      await this.idle();
      const note = await api<Note>("/api/notes/extract", {
        method: "POST",
        json: { sessionId: sid, source: "mark", from: mark.startAt, to: new Date().toISOString(), markId: mark.id },
      });
      this.view.set((s) => ({ notes: [note, ...s.notes] }));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "nothing_to_summarize")) {
        this.view.set({ error: err instanceof ApiError ? err.code : "network" });
      }
    } finally {
      this.view.set({ marking: false });
    }
  }
}

export const recorder = new RecorderController();

registerRecorder({
  pause: () => recorder.pause(),
  resume: () => recorder.resume(),
  stop: () => void recorder.stop(),
  mark: () => void recorder.mark(),
  toggle: () => recorder.toggle(),
});
