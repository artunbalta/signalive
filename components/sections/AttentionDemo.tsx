"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { hero } from "@/lib/copy";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * Id of the interactive region. The Hero uses it to point a caption or a
 * describedby at the demo without having to duplicate the string.
 */
export const ATTENTION_DEMO_ID = "attention-demo";

/* ==========================================================================
   TUNING
   ========================================================================== */

/** Amber marks the attended stream. Fog is everything that receded. */
const SIGNAL_RGB = [255, 194, 75] as const;
const FOG_RGB = [138, 138, 143] as const;

const GAIN_ATTENDED = 1.0;
const GAIN_DUCKED = 0.18;
const CUTOFF_ATTENDED = 20000;
const CUTOFF_DUCKED = 900;
/** Voice A sits left, voice B sits right, so the two are separable by ear. */
const PAN_SPREAD = 0.7;

/**
 * setTargetAtTime time constant. Writing .value on every pointermove steps the
 * parameter discontinuously and you hear it as a click, so every audio change
 * in this file goes through an exponential approach instead.
 */
const AUDIO_TAU = 0.06;

/** Analyser peaks rarely reach full scale on speech, so the drawing is lifted. */
const DISPLAY_GAIN = 2.2;

/** Position smoothing, expressed as a time constant so it is frame rate safe. */
const EASE_TAU = 0.09;

/* ==========================================================================
   PURE HELPERS
   ========================================================================== */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Steepens the middle of the sweep so the ends are reachable before the edge. */
const smoothstep = (a: number) => a * a * (3 - 2 * a);

/**
 * Colour for one stream given how strongly it is attended.
 *
 * Amber only appears once a stream is decisively ahead. With the cursor in the
 * middle neither voice is attended, so neither one is amber. That keeps the
 * colour a statement about the signal rather than decoration.
 */
function strokeFor(attendedness: number): string {
  const lead = clamp01((attendedness - 0.5) * 2);
  const r = Math.round(FOG_RGB[0] + (SIGNAL_RGB[0] - FOG_RGB[0]) * lead);
  const g = Math.round(FOG_RGB[1] + (SIGNAL_RGB[1] - FOG_RGB[1]) * lead);
  const b = Math.round(FOG_RGB[2] + (SIGNAL_RGB[2] - FOG_RGB[2]) * lead);
  return `rgb(${r},${g},${b})`;
}

/**
 * The curve drawn before the user has enabled sound.
 *
 * It is a fixed, seeded shape, not an animated fake. Nothing about it moves on
 * its own: the only things that change are amplitude and colour, and those are
 * driven by the real cursor position. Once the audio graph exists this curve is
 * dropped entirely in favour of the analyser.
 */
function idleCurve(n: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // Syllable rate envelope times a small stack of partials.
    const env =
      0.2 +
      0.8 *
        Math.abs(Math.sin(t * Math.PI * 3.7 + seed * 1.9)) *
        (0.6 + 0.4 * Math.sin(t * Math.PI * 1.3 + seed));
    const carrier =
      Math.sin(t * Math.PI * 2 * 27 + seed * 5.1) * 0.62 +
      Math.sin(t * Math.PI * 2 * 46.3 + seed * 2.3) * 0.28 +
      Math.sin(t * Math.PI * 2 * 11.7 + seed * 7.7) * 0.1;
    const v = env * carrier;
    out[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

const clampSigned = (n: number) => (n < -1 ? -1 : n > 1 ? 1 : n);

/** Mean absolute deviation from the 128 centre, ie is the analyser saying anything. */
function energy(src: Uint8Array): number {
  let sum = 0;
  // Every eighth sample is plenty to answer a yes or no question.
  for (let i = 0; i < src.length; i += 8) sum += Math.abs(src[i] - 128);
  return sum / (src.length / 8);
}

/** Peak picking downsample from the analyser buffer into the drawing buffer. */
function resamplePeaks(src: Uint8Array, out: Float32Array) {
  const step = src.length / out.length;
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.min(src.length, Math.floor((i + 1) * step)));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = (src[j] - 128) / 128;
      if (Math.abs(v) > Math.abs(peak)) peak = v;
    }
    out[i] = clampSigned(peak * DISPLAY_GAIN);
  }
}

function svgPath(curve: Float32Array, w: number, cy: number, halfH: number): string {
  let d = "";
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * w;
    const y = cy - curve[i] * halfH;
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

/* ==========================================================================
   AUDIO GRAPH
   ========================================================================== */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * source -> lowpass -> gain -> panner -> destination, with the analyser tapped
 * off the gain node. Tapping post gain and post filter is deliberate: the
 * waveform you see is the signal you hear, ducking and all.
 */
function createChain(ctx: AudioContext, el: HTMLAudioElement, pan: number) {
  const src = ctx.createMediaElementSource(el);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = CUTOFF_ATTENDED;
  filter.Q.value = 0.7;

  const gain = ctx.createGain();
  gain.gain.value = GAIN_DUCKED;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;

  src.connect(filter);
  filter.connect(gain);
  gain.connect(analyser);

  // Safari only gained StereoPannerNode late, so fall back to a straight
  // connection rather than losing the whole demo on an older browser.
  let panner: StereoPannerNode | null = null;
  if (typeof ctx.createStereoPanner === "function") {
    panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    gain.connect(panner);
    panner.connect(ctx.destination);
  } else {
    gain.connect(ctx.destination);
  }

  return {
    el,
    gain,
    filter,
    analyser,
    panner,
    // Left uninferred on purpose: the exact Uint8Array type varies by TS lib.
    bytes: new Uint8Array(analyser.fftSize),
  };
}

type VoiceChain = ReturnType<typeof createChain>;

type Rig = {
  ctx: AudioContext;
  a: VoiceChain;
  b: VoiceChain;
};

/* ==========================================================================
   COMPONENT
   ========================================================================== */

type Props = { className?: string };

export default function AttentionDemo({ className = "" }: Props) {
  const reduced = useReducedMotion();

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);

  /** Raw input position. 0 attends voice A, 1 attends voice B, 0.5 is neither. */
  const targetRef = useRef(0.5);
  /** Smoothed position actually rendered and sent to the audio graph. */
  const easedRef = useRef(0.5);
  const rigRef = useRef<Rig | null>(null);
  const draggingRef = useRef(false);

  const [att, setAtt] = useState(0.5);
  const [enabled, setEnabled] = useState(false);
  const [coarse, setCoarse] = useState(false);

  /* --- pointer class ---------------------------------------------------- */
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarse(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /* --- audio parameter writes ------------------------------------------- */

  /**
   * Push one position into the graph. Attendedness of A is the mirror of B, so
   * the midpoint leaves both at the same, partly ducked, value: honest, because
   * with no clear target there is nothing to bring forward.
   */
  const applyAudio = useCallback((value: number) => {
    const rig = rigRef.current;
    if (!rig) return;
    const now = rig.ctx.currentTime;
    const aAtt = smoothstep(clamp01(1 - value));
    const bAtt = smoothstep(clamp01(value));

    const write = (chain: VoiceChain, attendedness: number) => {
      chain.gain.gain.setTargetAtTime(
        GAIN_DUCKED + (GAIN_ATTENDED - GAIN_DUCKED) * attendedness,
        now,
        AUDIO_TAU
      );
      // Cutoff is swept geometrically, which is how the ear reads frequency.
      chain.filter.frequency.setTargetAtTime(
        CUTOFF_DUCKED * Math.pow(CUTOFF_ATTENDED / CUTOFF_DUCKED, attendedness),
        now,
        AUDIO_TAU
      );
    };

    write(rig.a, aAtt);
    write(rig.b, bAtt);
  }, []);

  /* --- enabling sound, inside the gesture ------------------------------- */

  const toggleSound = useCallback(async () => {
    const elA = audioARef.current;
    const elB = audioBRef.current;
    if (!elA || !elB) return;

    if (rigRef.current && enabled) {
      elA.pause();
      elB.pause();
      await rigRef.current.ctx.suspend().catch(() => {});
      setEnabled(false);
      return;
    }

    // The context is constructed here and nowhere else. Every browser blocks
    // a context created outside a user gesture, and nothing on this page is
    // allowed to make noise until someone asks for it.
    let rig = rigRef.current;
    if (!rig) {
      const w = window as WebkitWindow & { AudioContext?: typeof AudioContext };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      rig = {
        ctx,
        a: createChain(ctx, elA, -PAN_SPREAD),
        b: createChain(ctx, elB, PAN_SPREAD),
      };
      rigRef.current = rig;
    }

    // Both calls are issued synchronously, before anything awaits: iOS only
    // honours play() and resume() while the gesture token is still live, and
    // awaiting one before starting the other spends it. Both tracks are
    // loudness matched and looped, and a failure on one must not silence
    // the other, hence allSettled.
    const started = Promise.allSettled([elA.play(), elB.play()]);
    const resumed = rig.ctx.resume().catch(() => {});
    await Promise.all([started, resumed]);
    applyAudio(easedRef.current);
    setEnabled(true);
  }, [enabled, applyAudio]);

  /* --- teardown ---------------------------------------------------------- */
  useEffect(() => {
    const elA = audioARef.current;
    const elB = audioBRef.current;
    return () => {
      elA?.pause();
      elB?.pause();
      const rig = rigRef.current;
      rigRef.current = null;
      if (rig) {
        try {
          rig.a.gain.disconnect();
          rig.b.gain.disconnect();
        } catch {
          /* already torn down */
        }
        rig.ctx.close().catch(() => {});
      }
    };
  }, []);

  /* --- silence when the control is out of sight --------------------------- */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Sound that keeps playing after its control has scrolled away is sound
    // the reader can no longer see a reason for or a way to stop, so leaving
    // the demo behind switches it off rather than merely pausing the drawing.
    // Deliberately not resumed on the way back: restarting audio nobody asked
    // for a second time would be worse than making them press it again.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) return;
        const rig = rigRef.current;
        if (!rig) return;
        audioARef.current?.pause();
        audioBRef.current?.pause();
        rig.ctx.suspend().catch(() => {});
        setEnabled(false);
      },
      { threshold: 0 }
    );
    io.observe(root);
    return () => io.disconnect();
  }, []);

  /* --- cursor tracking over the control ----------------------------------- */
  useEffect(() => {
    if (reduced || coarse) return;
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track) return;

    // The sweep is bounded by the BAR, not by the hero and not by the page.
    //
    // Scoping this to the whole section meant the far left of the screen, a
    // long way from any control, sat at one voice fully forward, and the
    // gradient the demo exists to show was spread across a thousand pixels of
    // headline. Mapping to the track's own width puts the whole transition
    // where the affordance is, and leaving the demo holds the last position
    // rather than snapping, so nothing moves when the pointer is elsewhere on
    // the page.
    let rect = track.getBoundingClientRect();

    const measure = () => {
      rect = track.getBoundingClientRect();
    };
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current) return; // the handle owns the pointer
      if (rect.width <= 0) return;
      targetRef.current = clamp01((e.clientX - rect.left) / rect.width);
    };

    root.addEventListener("pointerenter", measure);
    root.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      root.removeEventListener("pointerenter", measure);
      root.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [reduced, coarse]);

  /* --- canvas sizing, drawing and the animation loop ---------------------- */
  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext("2d");
    if (!c) return;

    let cssW = 0;
    let cssH = 0;
    let points = 0;
    let idleA: Float32Array = new Float32Array(0);
    let idleB: Float32Array = new Float32Array(0);
    let bufA: Float32Array = new Float32Array(0);
    let bufB: Float32Array = new Float32Array(0);

    const size = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = r.width;
      cssH = r.height;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      // Draw in CSS pixels and let the transform handle the device ratio.
      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      const next = Math.max(96, Math.min(420, Math.floor(cssW / 3)));
      if (next !== points) {
        points = next;
        idleA = idleCurve(points, 0.6);
        idleB = idleCurve(points, 3.4);
        bufA = new Float32Array(points);
        bufB = new Float32Array(points);
      }
    };

    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    size();

    const drawWave = (
      pts: Float32Array,
      cy: number,
      halfH: number,
      color: string,
      width: number
    ) => {
      c.beginPath();
      const last = pts.length - 1;
      for (let i = 0; i <= last; i++) {
        const x = (i / last) * cssW;
        const y = cy - pts[i] * halfH;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.strokeStyle = color;
      c.lineWidth = width;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.stroke();
    };

    // Place the handle before the first frame so it never flashes at the edge.
    if (handleRef.current) {
      handleRef.current.style.left = `${easedRef.current * 100}%`;
    }

    let raf = 0;
    let running = false;
    // Consecutive frames the analyser has reported silence while the graph is
    // supposed to be running. Half a second of nothing means we stop trusting
    // it and draw the idle curve instead.
    let mute = 0;
    let prev = performance.now();
    let committed = 0.5;
    let committedAt = 0;
    let applied = -1;

    const frame = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);

      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      // Frame rate independent approach to the pointer position.
      const k = 1 - Math.exp(-dt / EASE_TAU);
      easedRef.current += (targetRef.current - easedRef.current) * k;
      const v = easedRef.current;

      // Once the ease has converged there is nothing left to schedule, and an
      // idle page should not be writing audio events sixty times a second.
      if (Math.abs(v - applied) > 0.0005) {
        applied = v;
        applyAudio(v);
      }

      if (handleRef.current) handleRef.current.style.left = `${v * 100}%`;

      // React only needs a coarse value: it drives the labels and the aria
      // value, neither of which benefits from sixty updates a second.
      if (Math.abs(v - committed) > 0.01 && now - committedAt > 80) {
        committed = v;
        committedAt = now;
        setAtt(v);
      }

      if (points === 0) return;

      const aAtt = smoothstep(clamp01(1 - v));
      const bAtt = smoothstep(clamp01(v));
      const rig = rigRef.current;
      const running_ = rig !== null && rig.ctx.state === "running";

      if (running_ && rig) {
        rig.a.analyser.getByteTimeDomainData(rig.a.bytes);
        rig.b.analyser.getByteTimeDomainData(rig.b.bytes);
        if (energy(rig.a.bytes) + energy(rig.b.bytes) < 0.6) mute++;
        else mute = 0;
        resamplePeaks(rig.a.bytes, bufA);
        resamplePeaks(rig.b.bytes, bufB);
      } else {
        mute = 0;
      }

      // Draw real samples only while they carry something. Otherwise the idle
      // curve stands in, still coloured and scaled by the cursor, so the
      // interaction keeps reading even where the analyser does not work.
      const live = running_ && mute < 30;

      c.clearRect(0, 0, cssW, cssH);

      const laneH = cssH / 2;
      const lanes: Array<[Float32Array, number, number]> = [
        [live ? bufA : idleA, laneH * 0.5, aAtt],
        [live ? bufB : idleB, laneH * 1.5, bAtt],
      ];

      for (const [pts, cy, attendedness] of lanes) {
        // Baseline sits at the same value as the site hairline.
        c.beginPath();
        c.moveTo(0, cy);
        c.lineTo(cssW, cy);
        c.strokeStyle = "rgba(255,255,249,0.12)";
        c.lineWidth = 1;
        c.stroke();

        // The unattended stream is drawn at a visibly smaller amplitude. When
        // the audio is live this is already true of the samples themselves;
        // the extra scaling keeps the idle state reading the same way.
        const scale = live ? 0.6 + 0.4 * attendedness : 0.34 + 0.66 * attendedness;
        drawWave(
          pts,
          cy,
          laneH * 0.4 * scale,
          strokeFor(attendedness),
          1.25 + 0.85 * attendedness
        );
      }
    };

    // The loop only runs while the demo is actually on screen and the tab is
    // foregrounded. A hero that keeps a rAF loop and an analyser read alive for
    // the whole page is a real battery cost, and a page about attention should
    // not be busy drawing something nobody is looking at.
    const start = () => {
      if (running) return;
      running = true;
      prev = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    let onScreen = true;
    const sync = () => {
      if (onScreen && document.visibilityState === "visible") start();
      else stop();
    };

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        sync();
      },
      { threshold: 0 }
    );
    io.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      ro.disconnect();
    };
  }, [reduced, applyAudio]);

  /* --- drag and keyboard on the handle ----------------------------------- */

  const setFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return;
    targetRef.current = clamp01((clientX - r.left) / r.width);
  }, []);

  const onTrackPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setFromClientX(e.clientX);
      handleRef.current?.focus();
    },
    [setFromClientX]
  );

  const onTrackPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      setFromClientX(e.clientX);
    },
    [setFromClientX]
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }, []);

  const nudge = useCallback(
    (delta: number) => {
      const next = clamp01(targetRef.current + delta);
      targetRef.current = next;
      setAtt(next);
      // Reduced motion has no animation loop to pick the change up.
      if (reduced) {
        easedRef.current = next;
        applyAudio(next);
      }
    },
    [reduced, applyAudio]
  );

  const onHandleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const map: Record<string, number> = {
        ArrowLeft: -0.05,
        ArrowDown: -0.05,
        ArrowRight: 0.05,
        ArrowUp: 0.05,
        PageDown: -0.2,
        PageUp: 0.2,
      };
      if (e.key in map) {
        e.preventDefault();
        nudge(map[e.key]);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        targetRef.current = 0;
        nudge(0);
      } else if (e.key === "End") {
        e.preventDefault();
        targetRef.current = 1;
        nudge(0);
      }
    },
    [nudge]
  );

  /* --- reduced motion: a static diagram and a two way switch -------------- */

  const setSide = useCallback(
    (side: "a" | "b") => {
      const next = side === "a" ? 0 : 1;
      targetRef.current = next;
      easedRef.current = next;
      setAtt(next);
      applyAudio(next);
    },
    [applyAudio]
  );

  /** The static diagram is the same two seeds the canvas uses, drawn once. */
  const staticCurves = useMemo(
    () => ({ a: idleCurve(180, 0.6), b: idleCurve(180, 3.4) }),
    []
  );

  /* --- derived label state ------------------------------------------------ */

  const aAttended = att < 0.44;
  const bAttended = att > 0.56;
  const attendedName = aAttended
    ? hero.leftVoice
    : bAttended
      ? hero.rightVoice
      : "";
  const percent = Math.round(att * 100);
  const dragLabel = coarse ? hero.interactionCaptionTouch : hero.interactionCaption;

  const labelCls = (on: boolean) =>
    "t-mono transition-colors duration-[240ms] " + (on ? "text-signal" : "text-fog");

  return (
    <div
      id={ATTENTION_DEMO_ID}
      ref={rootRef}
      className={"w-full select-none " + className}
    >
      {/* Never autoplays. Nothing here makes a sound until the button below is
          pressed, which is also the only place the AudioContext is created. */}
      <audio ref={audioARef} loop preload="metadata" aria-hidden="true" tabIndex={-1}>
        <source src="/media/voice-a.webm" type="audio/webm; codecs=opus" />
        <source src="/media/voice-a.mp3" type="audio/mpeg" />
      </audio>
      <audio ref={audioBRef} loop preload="metadata" aria-hidden="true" tabIndex={-1}>
        <source src="/media/voice-b.webm" type="audio/webm; codecs=opus" />
        <source src="/media/voice-b.mp3" type="audio/mpeg" />
      </audio>

      <div className="flex items-baseline justify-between gap-4">
        <span className={labelCls(aAttended)}>{hero.leftVoice}</span>
        <span className={labelCls(bAttended)}>{hero.rightVoice}</span>
      </div>

      {reduced ? (
        <>
          {/* No loop, no rAF, no measurement. A fixed picture of the same
              two streams, with the switch below deciding which one is marked. */}
          <svg
            viewBox="0 0 1000 200"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="mt-4 h-[132px] w-full md:h-[168px]"
          >
            <line x1="0" y1="50" x2="1000" y2="50" stroke="rgba(255,255,249,0.12)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="150" x2="1000" y2="150" stroke="rgba(255,255,249,0.12)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path
              d={svgPath(staticCurves.a, 1000, 50, aAttended ? 34 : 13.6)}
              fill="none"
              stroke={aAttended ? "#FFC24B" : "#8A8A8F"}
              strokeWidth={aAttended ? 2 : 1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={svgPath(staticCurves.b, 1000, 150, bAttended ? 34 : 13.6)}
              fill="none"
              stroke={bAttended ? "#FFC24B" : "#8A8A8F"}
              strokeWidth={bAttended ? 2 : 1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="mt-5 flex gap-2">
            {(["a", "b"] as const).map((side) => {
              const on = side === "a" ? aAttended : bAttended;
              return (
                <button
                  key={side}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSide(side)}
                  className={
                    "t-mono rounded-[var(--radius-pill)] border px-4 py-2.5 " +
                    (on
                      ? "border-signal text-signal"
                      : "border-[var(--hairline)] text-mist")
                  }
                >
                  {side === "a" ? hero.leftVoice : hero.rightVoice}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Decorative in the accessibility tree: the labels above and the
              slider below carry the same information in text. */}
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="mt-4 block h-[132px] w-full md:h-[168px]"
          />

          <div
            ref={trackRef}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="relative mt-5 h-11 w-full touch-none"
          >
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--hairline)]" />
            <div
              ref={handleRef}
              role="slider"
              tabIndex={0}
              aria-label={dragLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={attendedName || undefined}
              onKeyDown={onHandleKeyDown}
              className={
                "absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 " +
                "rounded-[var(--radius-pill)] border border-[var(--hairline)] bg-slate"
              }
            />
          </div>

          <p className="t-mono mt-4 text-mist">{dragLabel}</p>
        </>
      )}

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="t-mono flex items-center gap-2 text-fog">
          {/* Live indicator. Amber here means the stream is actually running. */}
          <span
            aria-hidden="true"
            className={
              "h-1.5 w-1.5 rounded-[var(--radius-pill)] " +
              (enabled ? "bg-signal" : "bg-fog")
            }
          />
          {hero.listenLabel}
        </span>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={enabled}
          className={
            "t-mono rounded-[var(--radius-pill)] border border-[var(--hairline)] " +
            "px-4 py-2.5 text-mist transition-colors duration-[240ms] hover:text-paper"
          }
        >
          {enabled ? hero.mute : hero.unmute}
        </button>
      </div>
    </div>
  );
}
