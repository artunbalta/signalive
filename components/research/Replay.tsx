"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { research } from "@/lib/copy";
import { AttentionDecoder, type DecoderModel } from "@/lib/sense/decoder";

/**
 * A real recording, decoded live. The raw EEG of one person (500 Hz, the
 * eight electrodes the decoder uses) goes through the earbud pipeline in
 * lib/sense one sample at a time: band pass, resampling, each ear referenced
 * to itself, the decoder. Every second the last 10 seconds are judged; every
 * 10 seconds of story one verdict is counted, the way the analysis counted
 * them, and moves a gain one step toward the story it names.
 *
 * Nothing loads until Play: the recording is about 2 MB.
 */

type Person = { label: "clearest" | "typical" | "hardest"; id: string; accuracy60: number; attended: string; name: string };

type Meta = {
  id: string;
  fsRaw: number;
  channels: string[];
  lsbUv: number;
  offsetsUv: number[];
  samples: number;
  leadSamples: number;
  envelopes: [number[], number[]];
  attendedStory: number;
  model: DecoderModel;
  timeline: Record<string, [number, number][]>;
};

type Loaded = { meta: Meta; codes: Int16Array };

const SPEEDS = [1, 4, 16];
const VIEW_S = 12;
const WINDOW_S = 10;
const STEPS = 5;

function useColors(ref: RefObject<HTMLElement | null>) {
  const [c, set] = useState({ paper: "#FFFFF9", fog: "#8A8A8F", mist: "#B4B4B9", slate: "#2A2D33", signal: "#FFC24B", hair: "rgba(255,255,249,0.12)" });
  useEffect(() => {
    if (!ref.current) return;
    const s = getComputedStyle(ref.current);
    const v = (n: string, d: string) => s.getPropertyValue(n).trim() || d;
    set((d) => ({
      paper: v("--color-paper", d.paper),
      fog: v("--color-fog", d.fog),
      mist: v("--color-mist", d.mist),
      slate: v("--color-slate", d.slate),
      signal: v("--color-signal", d.signal),
      hair: v("--hairline", d.hair),
    }));
  }, [ref]);
  return c;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function Replay({ people }: { people: Person[] }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const colors = useColors(root);
  const [who, setWho] = useState<Person["label"]>("clearest");
  const [speed, setSpeed] = useState(4);
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "paused" | "done" | "error">("idle");
  const [view, setView] = useState({ t: 0, verdict: -1, r: [0, 0], right: 0, total: 0, gain: 0 });
  const cache = useRef(new Map<string, Promise<Loaded>>());
  const run = useRef<{
    data: Loaded;
    decoder: AttentionDecoder;
    cursor: number;
    envPushed: number;
    frame: Float64Array;
    lastTick: number;
    lastView: number;
    carry: number;
    nextJudge: number;
    nextCount: number;
    right: number;
    total: number;
    gain: number;
    verdict: number;
    r: number[];
  } | null>(null);
  const raf = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const person = people.find((p) => p.label === who)!;

  const load = useCallback((label: string) => {
    let p = cache.current.get(label);
    if (!p) {
      p = Promise.all([
        fetch(`/research/people/${label}.json`).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<Meta>;
        }),
        fetch(`/research/people/${label}.bin`).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        }),
      ]).then(([meta, buf]) => ({ meta, codes: new Int16Array(buf) }));
      p.catch(() => cache.current.delete(label));
      cache.current.set(label, p);
    }
    return p;
  }, []);

  const draw = useCallback(() => {
    const cv = canvas.current;
    const st = run.current;
    if (!cv || !st) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const fs = st.decoder.fs;
    const { recon, envelopes } = st.decoder.recent(VIEW_S * fs);
    const n = VIEW_S * fs;
    const lanes = [
      { data: envelopes[0], color: st.data.meta.attendedStory === 0 ? colors.signal : colors.fog },
      { data: envelopes[1], color: st.data.meta.attendedStory === 1 ? colors.signal : colors.fog },
      { data: recon, color: colors.paper },
    ];
    const laneH = h / lanes.length;
    lanes.forEach((lane, li) => {
      const mid = laneH * li + laneH / 2;
      ctx.strokeStyle = colors.hair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();
      const d = lane.data;
      let mean = 0;
      let cnt = 0;
      for (const v of d) if (Number.isFinite(v)) (mean += v), cnt++;
      if (cnt < 2) return;
      mean /= cnt;
      let sd = 0;
      for (const v of d) if (Number.isFinite(v)) sd += (v - mean) ** 2;
      sd = Math.sqrt(sd / cnt) || 1;
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = li === 2 ? 1.5 : 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let pen = false;
      const offset = n - d.length;
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const x = ((i + offset) / (n - 1)) * w;
        const y = mid - Math.max(-2.6, Math.min(2.6, (v - mean) / sd)) * (laneH * 0.17);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    });
  }, [colors]);

  const tick = useCallback(
    (now: number) => {
      const st = run.current;
      if (!st) return;
      const { meta, codes } = st.data;
      const C = meta.channels.length;
      const dt = Math.min(0.1, (now - st.lastTick) / 1000);
      st.lastTick = now;
      // Whole samples only, with the fraction carried over, so 1x is real time on any display rate.
      st.carry += dt * speedRef.current * meta.fsRaw;
      const advance = Math.floor(st.carry);
      st.carry -= advance;
      const target = Math.min(meta.samples, st.cursor + advance);
      const fs = st.decoder.fs;
      const lead = Math.round((meta.leadSamples * fs) / meta.fsRaw);
      for (let k = st.cursor; k < target; k++) {
        for (let c = 0; c < C; c++) st.frame[c] = codes[k * C + c] * meta.lsbUv + meta.offsetsUv[c];
        st.decoder.pushRaw(st.frame);
        // Envelopes keep pace with the features: silence before the stories start.
        const due = Math.floor(((k + 1) * fs) / meta.fsRaw);
        while (st.envPushed < due) {
          const j = st.envPushed - lead;
          for (let s = 0; s < 2; s++) st.decoder.pushEnvelope(s, j >= 0 && j < meta.envelopes[s].length ? meta.envelopes[s][j] : 0);
          st.envPushed++;
        }
      }
      st.cursor = target;
      const count = st.decoder.count;
      // A live verdict every second over the last 10 seconds of story.
      while (count >= st.nextJudge) {
        const d = st.decoder.decideRange(st.nextJudge - WINDOW_S * fs, WINDOW_S * fs);
        if (d) {
          st.verdict = d.talker;
          st.r = d.r;
        }
        st.nextJudge += fs;
      }
      // One counted verdict per 10 seconds of story, non overlapping, as analysed.
      while (count >= st.nextCount) {
        const d = st.decoder.decideRange(st.nextCount - WINDOW_S * fs, WINDOW_S * fs);
        if (d) {
          st.total++;
          if (d.talker === meta.attendedStory) st.right++;
          st.gain = Math.max(-STEPS, Math.min(STEPS, st.gain + (d.talker === 1 ? 1 : -1)));
        }
        st.nextCount += WINDOW_S * fs;
      }
      // The readouts change at most ten times a second; the traces every frame.
      if (now - st.lastView > 100 || st.cursor >= meta.samples) {
        st.lastView = now;
        setView({ t: st.cursor / meta.fsRaw, verdict: st.verdict, r: st.r, right: st.right, total: st.total, gain: st.gain });
      }
      draw();
      if (st.cursor >= meta.samples) {
        setStatus("done");
        return;
      }
      raf.current = requestAnimationFrame(tick);
    },
    [draw],
  );

  const start = useCallback(
    async (label: Person["label"]) => {
      cancelAnimationFrame(raf.current);
      setStatus("loading");
      try {
        const data = await load(label);
        const fs = data.meta.model.fs;
        const lead = Math.round((data.meta.leadSamples * fs) / data.meta.fsRaw);
        run.current = {
          data,
          decoder: new AttentionDecoder(data.meta.model, 2, { historySeconds: 30 }),
          cursor: 0,
          envPushed: 0,
          frame: new Float64Array(data.meta.channels.length),
          lastTick: performance.now(),
          lastView: 0,
          carry: 0,
          nextJudge: lead + WINDOW_S * fs,
          nextCount: lead + WINDOW_S * fs,
          right: 0,
          total: 0,
          gain: 0,
          verdict: -1,
          r: [0, 0],
        };
        setStatus("playing");
        raf.current = requestAnimationFrame(tick);
      } catch {
        setStatus("error");
      }
    },
    [load, tick],
  );

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function play() {
    if (status === "paused" && run.current) {
      run.current.lastTick = performance.now();
      setStatus("playing");
      raf.current = requestAnimationFrame(tick);
    } else void start(who);
  }

  function pause() {
    cancelAnimationFrame(raf.current);
    setStatus("paused");
  }

  function choose(label: Person["label"]) {
    setWho(label);
    if (status === "playing" || status === "paused" || status === "done") void start(label);
  }

  const meta = run.current?.data.meta;
  const attended = meta?.attendedStory ?? (person.attended === "left" ? 0 : 1);
  const lead = meta ? meta.leadSamples / meta.fsRaw : 20;
  const storyName = (s: number) => (s === 0 ? research.replay.leftStory : research.replay.rightStory);
  const timeline = meta && meta.id === person.id ? meta.timeline["60"] : null;
  const c = research.replay;

  return (
    <div ref={root} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="t-mono text-fog">{c.pick}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={c.pick}>
          {people.map((p) => (
            <button key={p.label} type="button" role="radio" aria-checked={who === p.label} className="room-pill research-choice" onClick={() => choose(p.label)}>
              {p.name}
            </button>
          ))}
        </div>
        <p className="text-small text-fog">{c.personNote.replace("{n}", String(Math.round(person.accuracy60 * 100)))}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {status === "playing" ? (
          <button type="button" className="room-pill" onClick={pause}>
            {c.pause}
          </button>
        ) : (
          <button type="button" className="room-pill" onClick={play} disabled={status === "loading"}>
            {status === "loading" ? c.loading : c.play}
          </button>
        )}
        {status !== "idle" && status !== "loading" ? (
          <button type="button" className="room-pill" onClick={() => void start(who)}>
            {c.restart}
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2" role="radiogroup" aria-label={c.speed}>
          <span className="t-mono text-fog">{c.speed}</span>
          {SPEEDS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={speed === s} className="research-chip" onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
      </div>

      {status === "error" ? <p className="text-small text-mist">{c.error}</p> : null}

      <div className="rounded-[var(--radius-card)] border border-hairline p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-small text-mist">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="chart-key" style={{ background: "var(--color-signal)" }} />
            {c.followed}: {storyName(attended)}
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="chart-key" style={{ background: "var(--color-fog)" }} />
            {c.other}: {storyName(1 - attended)}
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="chart-key" style={{ background: "var(--color-paper)" }} />
            {c.recon}
          </span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <div className="flex flex-col justify-around text-right">
            <span className="t-mono text-fog">{c.laneLeft}</span>
            <span className="t-mono text-fog">{c.laneRight}</span>
            <span className="t-mono text-fog">{c.eegLane}</span>
          </div>
          <canvas ref={canvas} className="h-[220px] w-full" role="img" aria-label={c.canvasLabel} />
        </div>
        <div className="mt-4 flex items-center justify-between text-small text-fog">
          <span>
            {c.elapsed} {clock(Math.max(0, view.t - lead))}
          </span>
          {status === "playing" && view.t < lead + WINDOW_S ? <span>{c.warming}</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <p className="t-mono text-fog">{c.verdictLabel}</p>
          <p className="text-[1.375rem] font-medium">{view.verdict >= 0 ? storyName(view.verdict) : c.pending}</p>
          <div className="mt-2 flex flex-col gap-1.5" aria-hidden="true">
            {[0, 1].map((s) => (
              <div key={s} className="flex items-center gap-3 text-small text-fog">
                <span className="w-24 shrink-0">{storyName(s)}</span>
                <span className="relative h-1.5 flex-1 rounded-full bg-[var(--color-slate)]">
                  <span
                    className="absolute left-1/2 top-0 h-full rounded-full"
                    style={{
                      width: `${Math.min(50, Math.abs(view.r[s] ?? 0) * 250)}%`,
                      transform: (view.r[s] ?? 0) < 0 ? "translateX(-100%)" : undefined,
                      background: s === attended ? "var(--color-signal)" : "var(--color-fog)",
                    }}
                  />
                </span>
                <span className="w-14 text-right tabular-nums">{(view.r[s] ?? 0).toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <p className="t-mono text-fog">{c.truthLabel}</p>
          <p className="text-[1.375rem] font-medium">{storyName(attended)}</p>
          <p className="text-small text-mist" aria-live="polite">
            {c.tally.replace("{n}", String(view.right)).replace("{m}", String(view.total))}
          </p>
          <div className="mt-2 flex items-center gap-3 text-small text-fog" aria-hidden="true">
            <span>{research.replay.leftStory}</span>
            <span className="relative h-px flex-1 bg-[var(--hairline)]">
              <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-[600ms]"
                style={{ left: `${50 + (view.gain / STEPS) * 50}%`, background: "var(--color-paper)" }}
              />
            </span>
            <span>{research.replay.rightStory}</span>
          </div>
        </div>
      </div>

      {timeline ? (
        <div className="flex flex-col gap-3 border-t border-hairline pt-4">
          <p className="t-mono text-fog">{c.timelineLabel}</p>
          <div className="flex flex-wrap gap-1" role="img" aria-label={`${c.timelineLabel}: ${timeline.filter(([a, b]) => a > b).length} / ${timeline.length}`}>
            {timeline.map(([a, b], i) => (
              <span key={i} className="h-4 w-2.5 rounded-[2px]" style={{ background: a > b ? "var(--color-mist)" : "var(--color-slate)" }} />
            ))}
          </div>
          <div className="flex gap-5 text-small text-fog">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-2 rounded-[2px] bg-[var(--color-mist)]" />
              {c.timelineRight}
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-2 rounded-[2px] bg-[var(--color-slate)]" />
              {c.timelineWrong}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
