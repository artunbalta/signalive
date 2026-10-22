import type { RoomAudio } from "./audio";
import { createRoom, frameRoom, type Room, type RoomFrame } from "./scene";

/**
 * The room's state and its one animation loop. The head turns toward
 * whatever steers it (the pointer's place in the room, a drag, the arrow
 * keys, a speaker's name, or, until someone does any of those, a slow tour
 * of the three), the voice it faces comes forward, a lock (the clench, which
 * J or a button stands in for) holds one voice whatever the head does, and
 * each speaker's mouth moves with their voice: the real one once sound is
 * on, the rhythm of speech before that.
 *
 * The same rules as the web trial's Focus screen
 * (trial/lib/shared/focus.ts): a speaker is faced within 18 degrees of
 * their direction, the outermost two also beyond it; the faced voice plays
 * at full level and the others 16 dB down; with nobody faced, all three sit
 * 4 dB down.
 */

export const AZIMUTHS = [-45, 0, 45] as const;
const FACE_HALF_DEG = 18;
const CUT = 10 ** (-16 / 20);
const NEUTRAL = 10 ** (-4 / 20);
const STEER_MAX = 80;
/** The question under a speaker's name on wide screens: its height and margin, px. */
const QUESTION = 48;
/** Until someone steers, the head visits each speaker in turn. */
const TOUR = [1, 0, 2] as const;
const TOUR_SEC = 3.6;

export type Sound = "off" | "loading" | "on" | "error";

export interface RoomView {
  /** The voice that is forward: the locked one, else the one faced. */
  attended: number | null;
  locked: number | null;
  sound: Sound;
  /** The speaker whose recap is open. */
  recap: number | null;
  /** The recap is being spoken. */
  speaking: boolean;
}

export interface RoomElements {
  hero: HTMLElement;
  slot: HTMLElement;
  canvas: HTMLCanvasElement;
  controls: HTMLElement;
  /** The row under the room that asks what someone said, where labels are too narrow for it. */
  asks: HTMLElement;
  labels: (HTMLElement | null)[];
  meters: (HTMLElement | null)[];
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** The speaker nearest a head yaw: the outer two also own everything beyond them. */
const nearest = (yaw: number) => (yaw < AZIMUTHS[0] / 2 ? 0 : yaw > AZIMUTHS[2] / 2 ? 2 : 1);

/** The speaker faced at a head yaw, if any. */
export function facedSpeaker(yaw: number): number | null {
  const i = nearest(yaw);
  return (i === 1 ? Math.abs(yaw) : AZIMUTHS[2] - Math.abs(yaw)) <= FACE_HALF_DEG ? i : null;
}

/**
 * How loud speaker i would be at time t, 0..1, while their voice is not
 * playing: syllables about four a second, phrases of a few seconds, short
 * pauses between them, each speaker on their own clock.
 */
function speech(i: number, t: number): number {
  const p = t + i * 7.3;
  const syllable = Math.abs(Math.sin(Math.PI * 4.6 * p + 1.3 * Math.sin(3.5 * p)));
  const phrase = Math.sin(1.3 * p + 2 * Math.sin(0.45 * p + i));
  const gate = Math.min(1, Math.max(0, (phrase + 0.75) / 0.3));
  return gate * (0.6 + 0.4 * Math.sin(3.1 * p + 2 * i)) * syllable ** 0.6;
}

const approach = (cur: number, to: number, dt: number, rate: number) => cur + (to - cur) * (1 - Math.exp(-dt * rate));

function typing(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export class FocusRoomEngine {
  private state: RoomView = { attended: 1, locked: null, sound: "off", recap: null, speaking: false };
  private readonly listeners = new Set<() => void>();
  /** For React: the view and its changes. */
  readonly get = () => this.state;
  readonly subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  private set(patch: Partial<RoomView>) {
    if ((Object.keys(patch) as (keyof RoomView)[]).every((k) => Object.is(patch[k], this.state[k]))) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private yaw = 0;
  private target = 0;
  private beamYaw = 0;
  private gains = AZIMUTHS.map(() => NEUTRAL);
  private focus = AZIMUTHS.map(() => 0);
  private talk = AZIMUTHS.map(() => 0);
  private steered = false;
  private t0 = performance.now();
  private anchors: { x: number; y: number }[] = [];
  private heroLeft = 0;
  private visible = true;
  private ctx: AudioContext | null = null;
  private audio: RoomAudio | null = null;
  private applied = "";
  private soundRun = 0;
  private recapRun = 0;

  /** Mounts the room on the page's elements; returns cleanup. */
  mount(els: RoomElements, reducedMotion: boolean): () => void {
    let room: Room | null = null;
    try {
      room = createRoom(els.canvas, AZIMUTHS, { small: Math.min(innerWidth, innerHeight) < 640, reducedMotion });
    } catch {
      // No WebGL: the labels and the sound still work.
    }
    const onLost = (e: Event) => {
      e.preventDefault();
      room = null;
    };
    els.canvas.addEventListener("webglcontextlost", onLost);

    // The room fills the slot the layout gives it, under its controls and
    // out to the hero's right edge. Beside the copy it runs on to the hero's
    // foot, where you are cut off, seen over the shoulder; spanning the page
    // (stacked, its left edge too), it stops above the row under it.
    const layout = () => {
      const h = els.hero.getBoundingClientRect();
      const s = els.slot.getBoundingClientRect();
      const c = els.controls.getBoundingClientRect();
      const a = els.asks.getBoundingClientRect();
      const spans = s.width > h.width * 0.75;
      const left = spans ? 0 : s.left - h.left;
      const top = c.bottom - h.top + 12;
      const bottom = !spans ? h.height : a.height > 0 ? a.top - h.top - 8 : s.bottom - h.top;
      const frame: RoomFrame = { x: left, y: top, w: h.width - left, h: Math.max(160, bottom - top), labelHeight: 0, bleed: spans };
      // On wide screens each label carries the question (QUESTION px tall)
      // unless the people stand too close for it, when the question moves to
      // a row of its own. That is decided from the framing with the question
      // in, so hiding it (shorter labels, a closer camera, people further
      // apart) cannot undo the decision.
      const measured = Math.max(64, ...els.labels.map((l) => l?.offsetHeight ?? 0));
      const wide = matchMedia("(min-width: 1024px)").matches;
      const compactNow = els.slot.hasAttribute("data-compact");
      const full = measured + (wide && compactNow ? QUESTION : 0);
      const probe = frameRoom(AZIMUTHS, h.width, h.height, { ...frame, labelHeight: full }).anchors;
      const gap = Math.min(...probe.slice(1).map((p, i) => p.x - probe[i].x));
      const compact = wide && gap < (compactNow ? 180 : 170);
      els.slot.toggleAttribute("data-compact", compact);
      frame.labelHeight = compact ? full - QUESTION : full;
      if (room) room.layout(h.width, h.height, frame);
      this.anchors = room ? room.anchors() : frameRoom(AZIMUTHS, h.width, h.height, frame).anchors;
      this.heroLeft = h.left;
      // The labels live in the slot, so they stack with its other controls.
      this.anchors.forEach((p, i) => {
        const label = els.labels[i];
        if (!label) return;
        // Over the head, but never past the hero's edges.
        const half = label.offsetWidth / 2 + 12;
        const x = Math.min(h.width - half, Math.max(half, p.x));
        label.style.transform = `translate(${(x - s.left + h.left).toFixed(1)}px,${(p.y - s.top + h.top).toFixed(1)}px) translate(-50%,-100%)`;
      });
      const asks = els.asks.getBoundingClientRect();
      els.slot.style.setProperty("--room-asks", `${Math.round(asks.height > 0 ? s.bottom - asks.top : 0)}px`);
      // Stacked, the copy carries on under the room: you fade out before it.
      const fade = spans ? `linear-gradient(#000 ${Math.round(bottom - 64)}px,transparent ${Math.round(bottom)}px)` : "";
      els.canvas.style.setProperty("mask-image", fade);
      els.canvas.style.setProperty("-webkit-mask-image", fade);
    };
    layout();
    const ro = new ResizeObserver(layout);
    for (const el of [els.hero, els.slot, els.controls, els.asks, ...els.labels]) if (el) ro.observe(el);

    const io = new IntersectionObserver(
      ([e]) => {
        this.visible = !!e && e.intersectionRatio > 0.15;
        if (!this.visible) this.soundOff();
      },
      { threshold: [0, 0.15, 0.3] },
    );
    io.observe(els.hero);
    const onHidden = () => {
      if (document.hidden) this.soundOff();
    };
    document.addEventListener("visibilitychange", onHidden);

    // A mouse steers by where it is; a finger, by dragging across the room.
    let dragX: number | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        if (!(e.target instanceof Element && e.target.closest("[data-room-hold]"))) this.pointer(e.clientX);
      } else if (dragX !== null) {
        this.nudge((e.clientX - dragX) * 0.35);
        dragX = e.clientX;
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") dragX = e.clientX;
    };
    const onUp = () => (dragX = null);
    const onKey = (e: KeyboardEvent) => {
      if (!this.visible || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        this.nudge(e.key === "ArrowLeft" ? -10 : 10);
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        this.face(Number(e.key) - 1);
      } else if (e.key === "j" || e.key === "J") {
        this.toggleLock();
      }
    };
    els.slot.addEventListener("pointerdown", onDown);
    const listen = [
      ["pointermove", onMove],
      ["pointerup", onUp],
      ["pointercancel", onUp],
      ["keydown", onKey],
    ] as const;
    for (const [type, fn] of listen) addEventListener(type, fn as EventListener);

    let raf = 0;
    let last = performance.now();
    const frame = (stamp: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (stamp - last) / 1000);
      last = stamp;
      if (!this.visible || document.hidden) return;
      this.tick(dt, reducedMotion);
      room?.render(
        {
          yaw: this.yaw,
          beamYaw: this.beamYaw,
          locked: this.state.locked !== null,
          levels: this.talk,
          gains: this.gains,
          focus: this.focus,
          // The page's own intro holds everything still until it lets go.
          hold: document.documentElement.hasAttribute("data-intro"),
        },
        dt,
        (stamp - this.t0) / 1000,
      );
      els.meters.forEach((m, i) => {
        if (m) m.style.transform = `scaleX(${Math.min(1, this.gains[i] * (0.15 + this.talk[i])).toFixed(3)})`;
      });
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
      els.canvas.removeEventListener("webglcontextlost", onLost);
      els.slot.removeEventListener("pointerdown", onDown);
      for (const [type, fn] of listen) removeEventListener(type, fn as EventListener);
      room?.dispose();
      this.recapRun++;
      this.soundRun++;
      this.audio?.close();
      this.audio = null;
      this.ctx = null;
      this.applied = "";
      this.set({ sound: "off", speaking: false });
    };
  }

  private tick(dt: number, reduced: boolean) {
    const t = (performance.now() - this.t0) / 1000;
    if (!this.steered && !reduced) this.target = AZIMUTHS[TOUR[Math.floor(t / TOUR_SEC) % TOUR.length]];
    this.yaw = reduced ? this.target : approach(this.yaw, this.target, dt, 6);
    const { locked, sound } = this.state;
    const attended = locked ?? facedSpeaker(this.yaw);
    this.set({ attended });

    const audio = sound === "on" ? this.audio : null;
    const want = AZIMUTHS.map((_, i) => (attended === null ? NEUTRAL : i === attended ? 1 : CUT));
    want.forEach((g, i) => {
      this.gains[i] = approach(this.gains[i], g, dt, 8);
      this.focus[i] = approach(this.focus[i], i === attended ? 1 : 0, dt, 6);
      this.talk[i] = approach(this.talk[i], audio ? audio.level(i) : speech(i, t), dt, 18);
    });
    this.beamYaw = approach(this.beamYaw, locked !== null ? AZIMUTHS[locked] : this.yaw, dt, 10);

    if (audio) {
      audio.setYaw(this.yaw);
      if (want.join() !== this.applied) {
        this.applied = want.join();
        audio.setLevels(want);
      }
    }
  }

  /** A mouse at this x (viewport pixels): the head turns to that place in the room. */
  pointer(clientX: number) {
    const [l, c, r] = this.anchors;
    if (!l || !c || !r || !(l.x < c.x && c.x < r.x)) return;
    const x = clientX - this.heroLeft;
    this.steer(x < c.x ? ((x - c.x) / (c.x - l.x)) * 45 : ((x - c.x) / (r.x - c.x)) * 45);
  }

  nudge(deg: number) {
    this.steer(this.target + deg);
  }

  /** Turns toward a speaker. */
  face(i: number) {
    this.steer(AZIMUTHS[i] ?? this.target);
  }

  private steer(deg: number) {
    this.steered = true;
    this.target = Math.max(-STEER_MAX, Math.min(STEER_MAX, deg));
  }

  /** The clench: lock onto the voice you face (or the nearest), or let go. */
  toggleLock() {
    this.steered = true;
    this.set({ locked: this.state.locked !== null ? null : nearest(this.yaw) });
  }

  /** Sound on or off. Call from a tap: that is what lets the browser play it. */
  async toggleSound() {
    const { sound } = this.state;
    if (sound === "loading") return;
    if (sound === "on") return this.soundOff();
    const run = ++this.soundRun;
    this.set({ sound: "loading" });
    try {
      // Made and resumed inside the tap, before anything is awaited.
      this.ctx ??= new (window.AudioContext || (window as WebkitWindow).webkitAudioContext!)();
      const resumed = this.ctx.resume();
      const { RoomAudio } = await import("./audio");
      this.audio ??= new RoomAudio(this.ctx, AZIMUTHS);
      const buffers = await this.audio.load();
      await resumed;
      if (run !== this.soundRun) return;
      if (!this.visible || document.hidden) return this.soundOff();
      this.audio.start(buffers);
      this.audio.setYaw(this.yaw);
      this.audio.duck(this.state.speaking);
      this.applied = "";
      this.set({ sound: "on" });
    } catch {
      if (run !== this.soundRun) return;
      this.audio?.stopVoices();
      this.set({ sound: "error" });
    }
  }

  private soundOff() {
    this.soundRun++;
    this.recapRun++;
    if (this.audio) {
      this.audio.stopVoices();
      this.audio.stopRecap();
      this.audio.duck(false);
    }
    void this.ctx?.suspend().catch(() => {});
    this.applied = "";
    this.set({ sound: "off", speaking: false });
  }

  /** What did they say: the recap opens, and is spoken over the room when sound is on. */
  async recap(i: number) {
    const run = ++this.recapRun;
    this.set({ recap: i, speaking: false });
    const audio = this.audio;
    if (!audio || this.state.sound !== "on") return;
    audio.duck(true);
    this.set({ speaking: true });
    try {
      await audio.playRecap(i);
    } catch {
      // The text is on screen either way.
    }
    if (run !== this.recapRun) return;
    audio.duck(false);
    this.set({ speaking: false });
  }

  closeRecap() {
    this.recapRun++;
    this.audio?.stopRecap();
    this.audio?.duck(false);
    this.set({ recap: null, speaking: false });
  }
}
