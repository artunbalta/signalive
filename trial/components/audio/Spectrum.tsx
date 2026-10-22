"use client";

import { useEffect, useRef } from "react";

/**
 * Log frequency spectrum, 30 Hz to Nyquist, on a fixed scale of -110 to
 * -10 dB relative to full scale, so silence sits at the bottom instead of
 * being stretched to fill the box. The band below 200 Hz, where wind noise
 * sits, is shaded. The trace is amber while it shows the live input.
 */
const DB_TOP = -10;
const DB_RANGE = 100;
export function Spectrum({
  read,
  sampleRate,
  live,
  label,
  height = 160,
}: {
  /** Returns the latest spectrum in dB (bins 0..n/2), or null. */
  read: () => Float32Array | null;
  sampleRate: number;
  live: boolean;
  label: string;
  height?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const css = getComputedStyle(document.documentElement);
    const signal = css.getPropertyValue("--color-signal").trim() || "#ffc24b";
    const paper = css.getPropertyValue("--color-paper").trim() || "#fffff9";

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const fMin = 30;
      const fMax = sampleRate / 2;
      const x = (f: number) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;

      // Wind band
      ctx.fillStyle = "rgba(255,255,249,0.05)";
      ctx.fillRect(0, 0, x(200), h);

      // Grid at decades and 200 Hz
      ctx.strokeStyle = "rgba(255,255,249,0.08)";
      ctx.lineWidth = 1;
      ctx.font = "10px var(--font-mono), monospace";
      ctx.fillStyle = "rgba(255,255,249,0.4)";
      for (const f of [100, 200, 1000, 4000, 8000, 16000]) {
        if (f >= fMax) continue;
        const gx = Math.round(x(f)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, gx + 3, h - 4);
      }

      const spec = read();
      if (spec && spec.length > 2) {
        const top = DB_TOP;
        const range = DB_RANGE;
        const binHz = sampleRate / ((spec.length - 1) * 2);
        ctx.beginPath();
        let started = false;
        for (let k = 1; k < spec.length; k++) {
          const f = k * binHz;
          if (f < fMin) continue;
          const yv = Math.max(2, Math.min(h - 1, h - ((spec[k]! - (top - range)) / range) * (h - 14)));
          const px = x(f);
          if (!started) {
            ctx.moveTo(px, yv);
            started = true;
          } else ctx.lineTo(px, yv);
        }
        ctx.strokeStyle = live ? signal : paper;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [read, sampleRate, live]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className="block w-full rounded-[10px] bg-well-2"
      style={{ height }}
    />
  );
}
