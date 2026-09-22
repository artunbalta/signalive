"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
const GAIN_DUCKED = 0.08;
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

type Props = { className?: string };

export default function AttentionDemo({ className = "" }: Props) {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const rigRef = useRef<Rig | null>(null);
  const targetRef = useRef(0.5);
  const busyRef = useRef(false);
  const repaintRef = useRef<(() => void) | null>(null);
  const [att, setAtt] = useState(0.5);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const applyAudio = useCallback((value: number) => {
    const rig = rigRef.current;
    if (!rig) return;
    [rig.a, rig.b].forEach((chain, i) => {
      const weight = smoothstep(i === 0 ? 1 - value : value);
      chain.gain.gain.setTargetAtTime(GAIN_DUCKED + (GAIN_ATTENDED - GAIN_DUCKED) * weight, rig.ctx.currentTime, AUDIO_TAU);
      chain.filter.frequency.setTargetAtTime(CUTOFF_DUCKED * Math.pow(CUTOFF_ATTENDED / CUTOFF_DUCKED, weight), rig.ctx.currentTime, AUDIO_TAU);
    });
  }, []);

  const select = (value: number) => {
    const next = clamp01(value);
    targetRef.current = next;
    setAtt(next);
    applyAudio(next);
  };

  const toggleSound = async () => {
    const a = audioARef.current;
    const b = audioBRef.current;
    if (!a || !b || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(false);
    try {
      if (enabled) {
        a.pause(); b.pause();
        await rigRef.current?.ctx.suspend();
        setEnabled(false);
        return;
      }
      if (!rigRef.current) {
        const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
        if (!Ctor) throw new Error("Audio unavailable");
        const ctx = new Ctor();
        rigRef.current = { ctx, a: createChain(ctx, a, -PAN_SPREAD), b: createChain(ctx, b, PAN_SPREAD) };
      }
      applyAudio(targetRef.current);
      // All three calls must start inside the gesture, including on iOS.
      const results = await Promise.allSettled([a.play(), b.play(), rigRef.current.ctx.resume()]);
      if (results.some((result) => result.status === "rejected") || rigRef.current.ctx.state !== "running") throw new Error("Playback failed");
      if (document.hidden || !rootRef.current || (rootRef.current.getBoundingClientRect().bottom <= 0 || rootRef.current.getBoundingClientRect().top >= window.innerHeight)) {
        a.pause(); b.pause();
        await rigRef.current.ctx.suspend();
        return;
      }
      setEnabled(true);
    } catch {
      a.pause(); b.pause();
      await rigRef.current?.ctx.suspend().catch(() => {});
      setEnabled(false);
      setError(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    const a = audioARef.current;
    const b = audioBRef.current;
    const stop = () => {
      a?.pause(); b?.pause();
      void rigRef.current?.ctx.suspend().catch(() => {});
      setEnabled(false);
    };
    const io = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) stop(); });
    if (rootRef.current) io.observe(rootRef.current);
    const onHidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
      a?.pause(); b?.pause();
      const rig = rigRef.current;
      rigRef.current = null;
      void rig?.ctx.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const idle = [idleCurve(100, 0.6), idleCurve(100, 3.4)];
    const buffers = [new Float32Array(100), new Float32Array(100)];
    let width = 0, height = 0, raf = 0, visible = false;
    let value = targetRef.current, previous = performance.now();
    const draw = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      value = reduced ? targetRef.current : value + (targetRef.current - value) * (1 - Math.exp(-dt / EASE_TAU));
      ctx.clearRect(0, 0, width, height);
      const rig = rigRef.current;
      [0, 1].forEach((side) => {
        const attended = smoothstep(side === 0 ? 1 - value : value);
        const chain = side === 0 ? rig?.a : rig?.b;
        let curve = idle[side];
        let live = false;
        if (!reduced && rig?.ctx.state === "running" && chain) {
          chain.analyser.getByteTimeDomainData(chain.bytes);
          if (energy(chain.bytes) > 0.15) {
            resamplePeaks(chain.bytes, buffers[side]);
            curve = buffers[side];
            live = true;
          }
        }
        const start = side === 0 ? 0 : width * 0.56;
        const span = width * 0.44;
        const cy = height / 2;
        ctx.strokeStyle = "rgba(255,255,249,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(start, cy); ctx.lineTo(start + span, cy); ctx.stroke();
        ctx.strokeStyle = strokeFor(attended);
        ctx.globalAlpha = 0.28 + attended * 0.72;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        // Bars give speech a legible envelope at narrow mobile widths.
        for (let i = 0; i < 44; i++) {
          const x = start + 2 + i / 43 * (span - 4);
          const sample = Math.abs(curve[Math.floor(i / 43 * (curve.length - 1))]);
          const gain = live ? 0.85 : 0.12 + attended * 0.88;
          const h = Math.max(1, sample * height * 0.43 * gain);
          ctx.beginPath(); ctx.moveTo(x, cy - h); ctx.lineTo(x, cy + h); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });
      if (visible && !reduced && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cancelAnimationFrame(raf); draw(performance.now());
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf); if (visible) draw(performance.now());
    });
    io.observe(canvas);
    const redraw = () => { cancelAnimationFrame(raf); draw(performance.now()); };
    document.addEventListener("visibilitychange", redraw);
    repaintRef.current = redraw;
    resize();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", redraw);
      repaintRef.current = null;
    };
  }, [reduced]);

  useEffect(() => { if (reduced) repaintRef.current?.(); }, [att, reduced]);

  const aWeight = Math.round((1 - att) * 100);
  const bWeight = 100 - aWeight;
  const valueText = `${hero.leftVoice} ${aWeight}%, ${hero.rightVoice} ${bWeight}%`;
  return (
    <div id={ATTENTION_DEMO_ID} ref={rootRef} className={`attention-mixer ${className}`} style={{ "--attention": `${att * 100}%` } as CSSProperties}>
      <audio ref={audioARef} loop preload="none" aria-hidden="true"><source src="/media/voice-a.mp3" type="audio/mpeg" /></audio>
      <audio ref={audioBRef} loop preload="none" aria-hidden="true"><source src="/media/voice-b.mp3" type="audio/mpeg" /></audio>
      <div className="attention-labels">
        <button type="button" onClick={() => select(0)} className={att < 0.48 ? "is-attended" : ""} aria-label="Focus on Voice A">
          <span className="t-mono">{hero.leftVoice}</span><span className="attention-weight">{aWeight}<small>%</small></span>
        </button>
        <span className="attention-center" aria-hidden="true">↔</span>
        <button type="button" onClick={() => select(1)} className={att > 0.52 ? "is-attended" : ""} aria-label="Focus on Voice B">
          <span className="t-mono">{hero.rightVoice}</span><span className="attention-weight">{bWeight}<small>%</small></span>
        </button>
      </div>
      <canvas ref={canvasRef} aria-hidden="true" className="attention-wave" />
      <div className="attention-control">
        <div className="attention-rail" aria-hidden="true"><span style={{ left: `${Math.min(50, att * 100)}%`, width: `${Math.abs(att * 100 - 50)}%` }} /></div>
        <input type="range" min={0} max={100} step={1} value={Math.round(att * 100)} onChange={(e) => select(Number(e.target.value) / 100)} aria-label="Voice attention balance" aria-valuetext={valueText} aria-describedby="attention-instruction" />
      </div>
      <div className="attention-footer">
        <p id="attention-instruction">{hero.interactionCaptionTouch}</p>
        <button type="button" onClick={toggleSound} disabled={busy} aria-pressed={enabled} className="attention-sound">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M3 8h3l4-4v12l-4-4H3z" />{enabled ? <path d="M13 6c3 2 3 6 0 8m2-10c5 3 5 9 0 12" /> : <path d="m13 8 4 4m0-4-4 4" />}</svg>
          {busy ? "Loading" : enabled ? hero.mute : hero.unmute}
        </button>
      </div>
      {error && <p role="status" className="attention-error">Sound could not start. Please try again.</p>}
    </div>
  );
}
