"use client";

import { toMicError } from "@/lib/audio/devices";
import { getEngine } from "@/lib/audio/engine";
import { concat, type MicInput } from "@/lib/audio/mic";
import { PcmPlayer } from "@/lib/audio/player";
import { pcm16BytesToInt16, rmsDbfs } from "@/lib/shared/audio/wav";
import { AgentActionSchema, type AgentAction, type AgentRequest } from "@/lib/shared/moments";
import type { Lang, PublicConfig, SpeechLang } from "@/lib/shared/types";
import { buildContext } from "./agent-context";
import { Endpointer, transcribeOnce } from "./agent-voice";
import { ApiError, apiFetch } from "./api";
import { live } from "./live";
import { micManager } from "./mic-manager";
import { deviceTimeZone, nowForModel } from "./moments-format";
import { addToCalendar, eventItem, reminderItem } from "./moments-ics";
import { momentsStore } from "./moments-store";
import { base64ToBytes, readNdjson } from "./ndjson";
import { getPrefs } from "./prefs";
import { createStore } from "./store";
import { BrowserSttStream } from "./stt-stream";

/**
 * Ask: questions about the moments kept on this device. The device picks the
 * moments that go with each question (agent-context.ts), POST /api/agent
 * streams the answer back as text and, when asked for, as speech, together
 * with the moments it drew on and the actions it proposes: a reminder, a
 * calendar event, a message draft. Nothing proposed happens until the
 * wearer accepts it here.
 *
 * Questions come typed, held on the mic button, or from a held clench: the
 * clench starts listening and the question ends when the wearer stops
 * talking. Voice questions are always answered aloud; typed ones when the
 * wearer asks for that.
 */

export interface AskTurn {
  id: string;
  question: string;
  via: "text" | "voice";
  reply: string;
  status: "pending" | "streaming" | "done" | "error" | "stopped";
  error: string | null;
  /** The agent is looking something up. */
  looking: boolean;
  /** Moments the answer drew on, in the order given. */
  cites: string[];
  actions: AgentAction[];
  /** How many moments went with the question. */
  context: number;
}

export type VoiceState = "idle" | "starting" | "listening" | "transcribing";

export interface AskView {
  /** Oldest first. */
  turns: AskTurn[];
  voice: VoiceState;
  /** "hold": ends when the button is let go; "auto": ends when the talking stops. */
  voiceMode: "hold" | "auto" | null;
  /** Live words while a question is spoken, where the recognizer streams. */
  partial: string;
  speaking: boolean;
  /** Why the last voice question went nowhere: a mic error, "no_speech", or a recognition error. */
  voiceError: string | null;
}

export type ActionOutcome = "native" | "file" | "shared" | "copied" | "opened";

const MAX_TEXT = 4000;
const MAX_MESSAGES = 20;
const MAX_TURNS = 40;
const MIN_VOICE_MS = 300;
/** The longest question: what one recognition request takes. */
const MAX_VOICE_SEC = 30;

const clip = (s: string, n = MAX_TEXT) => (s.length <= n ? s : s.slice(0, n));
const replyLang = (): Lang => (typeof document !== "undefined" && document.documentElement.lang === "tr" ? "tr" : "en");
const speechLang = (): SpeechLang => getPrefs().speechLang ?? "auto";

interface VoiceCapture {
  frames: Float32Array[];
  stream: BrowserSttStream | null;
}

class AgentController {
  readonly view = createStore<AskView>({ turns: [], voice: "idle", voiceMode: null, partial: "", speaking: false, voiceError: null });

  private config: PublicConfig | null = null;
  private request: AbortController | null = null;
  private player: PcmPlayer | null = null;
  private replyDone = true;
  private capture: VoiceCapture | null = null;
  private offAudio: (() => void) | null = null;
  private mic: MicInput | null = null;

  configure(config: PublicConfig) {
    this.config = config;
  }

  /* ---- Questions ------------------------------------------------------------------ */

  /** Asks a question; voice questions are answered aloud. */
  async ask(question: string, opts: { via?: "text" | "voice"; focusMomentId?: string | null; speak?: boolean } = {}): Promise<void> {
    const q = clip(question.trim());
    if (!q) return;
    this.stop();
    await momentsStore.load();
    const via = opts.via ?? "text";
    const speak = opts.speak ?? (via === "voice" || getPrefs().askSpeakTyped === true);
    const lang = replyLang();
    const now = new Date();

    const earlier = this.view.get().turns.filter((t) => t.reply && (t.status === "done" || t.status === "stopped"));
    const messages: AgentRequest["messages"] = [
      ...earlier.flatMap((t) => [
        { role: "user" as const, text: clip(t.question) },
        { role: "assistant" as const, text: clip(t.reply) },
      ]),
      { role: "user" as const, text: q },
    ].slice(-MAX_MESSAGES);
    // A conversation starts with the wearer.
    while (messages.length > 1 && messages[0]!.role !== "user") messages.shift();
    const moments = buildContext(q, momentsStore.get().moments, {
      now,
      focusId: opts.focusMomentId ?? null,
      recentCites: earlier.slice(-2).flatMap((t) => t.cites),
    });
    const body: AgentRequest = { messages, moments, now: nowForModel(lang, now), timeZone: deviceTimeZone(), replyLang: lang, speak };

    const id = crypto.randomUUID();
    this.view.set((s) => ({
      turns: [
        ...s.turns,
        { id, question: q, via, reply: "", status: "pending" as const, error: null, looking: false, cites: [], actions: [], context: moments.length },
      ].slice(-MAX_TURNS),
    }));

    const controller = new AbortController();
    this.request = controller;
    const player = speak ? this.output() : null;
    this.replyDone = false;
    let error: string | null = null;

    try {
      const res = await apiFetch("/api/agent", { method: "POST", json: body, signal: controller.signal });
      await readNdjson(res, (ev) => {
        if (controller.signal.aborted) return;
        switch (ev.t) {
          case "tool":
            this.patch(id, () => ({ looking: ev.state === "start" }));
            break;
          case "text":
            this.patch(id, (t) => ({ reply: t.reply + String(ev.delta ?? ""), status: "streaming", looking: false }));
            break;
          case "audio":
            if (player) {
              player.enqueue(pcm16BytesToInt16(base64ToBytes(String(ev.pcm ?? ""))), Number(ev.sr) || 24000);
              if (!this.view.get().speaking) this.view.set({ speaking: true });
            }
            break;
          case "action":
            this.proposed(id, ev.action, ev.momentId);
            break;
          case "cite": {
            const ids = Array.isArray(ev.momentIds) ? ev.momentIds.filter((x): x is string => typeof x === "string") : [];
            const known = ids.filter((x) => momentsStore.find(x));
            this.patch(id, (t) => ({ cites: [...new Set([...t.cites, ...known])] }));
            break;
          }
          case "done": {
            const reply = typeof ev.reply === "string" ? ev.reply.trim() : "";
            this.patch(id, (t) => ({ reply: reply || t.reply, status: "done", looking: false }));
            break;
          }
          case "error":
            error ??= String(ev.code ?? "generic");
            break;
        }
      });
    } catch (err) {
      if (!controller.signal.aborted) error = err instanceof ApiError ? err.code : "network";
    }
    // A question stopped by a newer one leaves the newer one's state alone.
    if (controller.signal.aborted || this.request !== controller) return;
    this.request = null;
    this.replyDone = true;
    const failure = error as string | null;
    this.patch(id, (t) => (failure ? { status: "error", error: failure, looking: false } : { status: "done", looking: false }));
    if (!player?.playing) this.view.set({ speaking: false });
  }

  private proposed(turnId: string, raw: unknown, rawMomentId: unknown) {
    const parsed = AgentActionSchema.safeParse(raw);
    if (!parsed.success) return;
    const momentId = typeof rawMomentId === "string" && momentsStore.find(rawMomentId) ? rawMomentId : null;
    const action = { ...parsed.data, id: crypto.randomUUID(), momentId, createdAt: new Date().toISOString(), status: "proposed" } as AgentAction;
    this.patch(turnId, (t) => ({ actions: [...t.actions, action] }));
    // Kept with its moment too, so it can be accepted from there later.
    if (momentId) void momentsStore.putAction(momentId, action);
  }

  private patch(id: string, change: (t: AskTurn) => Partial<AskTurn>) {
    this.view.set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...change(t) } : t)) }));
  }

  /** Stops the answer in progress, and its voice. */
  stop() {
    const req = this.request;
    this.request = null;
    req?.abort();
    this.player?.stop();
    this.view.set((s) => ({
      speaking: false,
      turns: s.turns.map((t) => (t.status === "pending" || t.status === "streaming" ? { ...t, status: "stopped" as const, looking: false } : t)),
    }));
  }

  stopSpeaking() {
    this.player?.stop();
    this.view.set({ speaking: false });
  }

  clear() {
    this.stop();
    this.cancelVoice();
    this.view.set({ turns: [], voiceError: null });
  }

  private output(): PcmPlayer {
    if (!this.player) {
      this.player = new PcmPlayer(getEngine().ctx, getEngine().sources.input("agent"));
      this.player.onEnded(() => {
        if (this.replyDone) this.view.set({ speaking: false });
      });
    }
    this.player.stop();
    return this.player;
  }

  /* ---- Actions -------------------------------------------------------------------- */

  /**
   * Does what an accepted action says: a reminder or an event goes to the
   * calendar, a draft opens in the mail app or the share sheet (or is
   * copied). Then marks it accepted wherever it is kept.
   */
  async accept(action: AgentAction): Promise<ActionOutcome> {
    const outcome = await performAction(action);
    await this.setStatus(action, "accepted");
    return outcome;
  }

  async dismiss(action: AgentAction): Promise<void> {
    await this.setStatus(action, "dismissed");
  }

  private async setStatus(action: AgentAction, status: AgentAction["status"]) {
    const next = { ...action, status } as AgentAction;
    this.view.set((s) => ({
      turns: s.turns.map((t) => (t.actions.some((a) => a.id === action.id) ? { ...t, actions: t.actions.map((a) => (a.id === action.id ? next : a)) } : t)),
    }));
    if (action.momentId && momentsStore.find(action.momentId)) await momentsStore.putAction(action.momentId, next);
  }

  /* ---- Voice ---------------------------------------------------------------------- */

  /** A held clench: starts listening for a question, or ends the one being asked. */
  toggleVoice() {
    const v = this.view.get().voice;
    if (v === "idle") void this.startVoice("auto");
    else if (v === "listening") void this.finishVoice();
  }

  /** Opens the microphone for one question. Call from a tap (or a gesture) on iOS. */
  async startVoice(mode: "hold" | "auto"): Promise<void> {
    if (this.view.get().voice !== "idle") return;
    this.stop();
    this.view.set({ voice: "starting", voiceMode: mode, partial: "", voiceError: null });
    let mic: MicInput;
    try {
      await getEngine().resume();
      mic = await micManager.ensure();
    } catch (err) {
      this.view.set({ voice: "idle", voiceMode: null, voiceError: toMicError(err).code });
      this.releaseMic();
      return;
    }
    // Let go (or cancelled) while the microphone was opening.
    if (this.view.get().voice !== "starting") {
      this.releaseMic();
      return;
    }
    this.mic = mic;
    const lang = speechLang();
    const canStream = !!this.config?.stt.streaming && lang !== "auto" && this.config.stt.streamingLanguages.includes(lang);
    const stream = canStream ? BrowserSttStream.start(lang) : null;
    if (stream) stream.onPartial = (text) => this.view.set({ partial: text });
    const capture: VoiceCapture = { frames: [], stream };
    this.capture = capture;
    const endpointer = mode === "auto" ? new Endpointer() : null;
    let samplesHeld = 0;
    this.offAudio = mic.on16k((samples) => {
      if (this.capture !== capture) return;
      capture.frames.push(samples);
      samplesHeld += samples.length;
      stream?.send(samples);
      const ev = endpointer?.push(rmsDbfs(samples), (samples.length / 16000) * 1000);
      // A question held longer than recognition takes is ended there.
      if (ev === "end" || ev === "max" || samplesHeld >= MAX_VOICE_SEC * 16000) void this.finishVoice();
      else if (ev === "no_speech") this.endWithoutQuestion("no_speech");
    });
    this.view.set({ voice: "listening" });
  }

  /** The mic button let go: the question is complete. */
  endVoice() {
    const v = this.view.get().voice;
    if (v === "starting") this.view.set({ voice: "idle", voiceMode: null });
    else if (v === "listening") void this.finishVoice();
  }

  /** Drops the question being spoken; nothing is sent. */
  cancelVoice() {
    if (this.view.get().voice === "idle") return;
    this.capture?.stream?.close();
    this.capture = null;
    this.offAudio?.();
    this.offAudio = null;
    this.releaseMic();
    this.view.set({ voice: "idle", voiceMode: null, partial: "" });
  }

  private endWithoutQuestion(code: string) {
    this.capture?.stream?.close();
    this.capture = null;
    this.offAudio?.();
    this.offAudio = null;
    this.releaseMic();
    this.view.set({ voice: "idle", voiceMode: null, partial: "", voiceError: code });
  }

  private async finishVoice() {
    const cap = this.capture;
    if (!cap) return;
    this.capture = null;
    this.offAudio?.();
    this.offAudio = null;
    this.releaseMic();
    const audio = concat(cap.frames);
    if ((audio.length / 16000) * 1000 < MIN_VOICE_MS || rmsDbfs(audio) < -60) {
      cap.stream?.close();
      this.endWithoutQuestion("no_speech");
      return;
    }
    this.view.set({ voice: "transcribing" });
    let text: string | null = cap.stream ? await cap.stream.finish() : null;
    if (text === null) {
      try {
        text = (await transcribeOnce(audio, { speechLang: speechLang() })).text;
      } catch (err) {
        this.view.set({ voice: "idle", voiceMode: null, partial: "", voiceError: err instanceof ApiError ? err.code : "network" });
        return;
      }
    }
    if (!text.trim()) {
      this.endWithoutQuestion("no_speech");
      return;
    }
    this.view.set({ voice: "idle", voiceMode: null, partial: "" });
    await this.ask(text, { via: "voice" });
  }

  /** Closes the microphone again unless something else is listening. */
  private releaseMic() {
    this.mic = null;
    const l = live.get();
    if (!l.rewindOn && l.recording === "off" && l.assistant === "off") micManager.close();
  }
}

/* ---- What accepting does ------------------------------------------------------------ */

/**
 * Carries out an accepted action. Rejects when the native calendar refuses,
 * or when the share sheet is dismissed (AbortError), so the action stays
 * proposed.
 */
export async function performAction(action: AgentAction): Promise<ActionOutcome> {
  const notes = action.momentId ? (momentsStore.find(action.momentId)?.title ?? null) : null;
  if (action.kind === "reminder") {
    return addToCalendar(reminderItem(action.text, action.due, { now: new Date(), uid: action.id, notes }));
  }
  if (action.kind === "event") {
    const item =
      eventItem({ title: action.title, start: action.start, end: action.end, location: action.location }, { uid: action.id, notes }) ??
      reminderItem(action.title, null, { now: new Date(), uid: action.id, notes });
    return addToCalendar(item);
  }
  if (action.channel === "email") {
    const to = action.to && /@/.test(action.to) ? action.to : "";
    const q = [action.subject ? `subject=${encodeURIComponent(action.subject)}` : "", `body=${encodeURIComponent(action.body)}`].filter(Boolean).join("&");
    window.location.href = `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${q}`;
    return "opened";
  }
  if (typeof navigator.share === "function") {
    await navigator.share({ text: action.body });
    return "shared";
  }
  await copyText(action.body);
  return "copied";
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export const agent = new AgentController();
