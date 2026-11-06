"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { research } from "@/lib/copy";

/**
 * One listener's real ten second decisions, with the visitor's head.
 *
 * The decisions are those of a person the decoder never saw (research/aad
 * final models), in order, sped up. Where the head points is the visitor's
 * choice, or wanders by itself. Each step, two ways of choosing the voice
 * brought forward are scored side by side: the voice faced (what platforms
 * ship), and the phone's fusion of head and belief with the head weighed at
 * kappa 1 (research/aad/hold_value.py). The belief is lib/sense/fusion.ts
 * AttentionBelief for two talkers, the same arithmetic as belief.py.
 */

export type HoldReplay = {
  /** The decision weight fitted on held out decisions. */
  weight: number;
  hazard: number;
  kappa: number;
  /** Ten second margins, followed minus other, one block after another. */
  margins: number[];
  /** Decisions in each recorded block, in order: one row of squares each. */
  blocks: number[];
  person: { accuracy60: number };
};

type Look = "followed" | "down" | "other";
const LOOKS: Look[] = ["followed", "down", "other"];
const YAW: Record<Look, number> = { followed: -60, down: 0, other: 60 };
const STEP_MS = 450;
/** Steps before scoring counts: the first minute, as in the analysis. */
const SETTLE = 6;
const WANDER = { stay: Math.exp(-10 / 20), shares: [0.75, 0.125, 0.125] };

function step(pFollowed: number, margin: number, weight: number, hazard: number): number {
  const p = (1 - hazard) * pFollowed + hazard * (1 - pFollowed);
  const lo = Math.log(p / (1 - p)) + weight * margin;
  return 1 / (1 + Math.exp(-lo));
}

/** Head and belief together, as fuseAttention does for two talkers at -60 and +60 degrees. */
function fusedFollowed(yaw: number, pFollowed: number, kappa: number): boolean {
  const r = Math.PI / 180;
  const a = kappa * Math.cos((yaw - YAW.followed) * r) + Math.log(Math.max(pFollowed, 1e-300));
  const b = kappa * Math.cos((yaw - YAW.other) * r) + Math.log(Math.max(1 - pFollowed, 1e-300));
  return a > b;
}

type Row = { look: Look; face: boolean; fused: boolean; belief: number };

export default function HoldPlay({ data }: { data: HoldReplay }) {
  const f = research.beyond.hold.play;
  const [look, setLook] = useState<Look>("followed");
  const [wander, setWander] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const state = useRef({ i: 0, belief: 0.5, look: "followed" as Look, wander: false });
  state.current.look = look;
  state.current.wander = wander;

  const n = data.margins.length;
  const widest = Math.max(...data.blocks);
  const starts = data.blocks.map((_, b) => data.blocks.slice(0, b).reduce((a, x) => a + x, 0));
  const tick = useCallback(() => {
    const s = state.current;
    if (s.i >= n) {
      setPlaying(false);
      return;
    }
    if (s.wander && Math.random() > WANDER.stay) {
      const u = Math.random();
      const next: Look = u < WANDER.shares[0]! ? "followed" : u < WANDER.shares[0]! + WANDER.shares[1]! ? "down" : "other";
      s.look = next;
      setLook(next);
    }
    s.belief = step(s.belief, data.margins[s.i]!, data.weight, data.hazard);
    const row: Row = { look: s.look, face: s.look === "followed", fused: fusedFollowed(YAW[s.look], s.belief, data.kappa), belief: s.belief };
    s.i++;
    setRows((r) => [...r, row]);
  }, [data, n]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(tick, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, tick]);

  const again = () => {
    state.current.i = 0;
    state.current.belief = 0.5;
    setRows([]);
    setPlaying(true);
  };

  const scored = rows.slice(SETTLE);
  const share = (k: "face" | "fused") => (scored.length ? scored.filter((r) => r[k]).length / scored.length : null);
  const last = rows[rows.length - 1];
  const pct = (v: number | null) => (v === null ? "" : `${Math.round(v * 100)}%`);
  const minutes = Math.floor((rows.length * 10) / 60);

  return (
    <div className="hold-play mt-12 border-t border-hairline pt-10">
      <p className="t-mono text-fog">{f.title}</p>
      <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label={f.look.label}>
        <span className="mr-2 text-small text-mist">{f.look.label}</span>
        {LOOKS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={look === k}
            onClick={() => {
              setWander(false);
              setLook(k);
            }}
            className={`hold-chip ${look === k ? "hold-chip-on" : ""}`}
          >
            {f.look[k]}
          </button>
        ))}
        <button type="button" aria-pressed={wander} onClick={() => setWander((w) => !w)} className={`hold-chip ${wander ? "hold-chip-on" : ""}`}>
          {f.wander}
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {(["face", "fused"] as const).map((k) => {
          const forwardFollowed = last ? last[k] : k === "face" ? look === "followed" : true;
          const nobody = k === "face" && look === "down";
          return (
            <figure key={k} className="hold-panel">
              <figcaption className="flex items-baseline justify-between gap-4">
                <span className="text-small text-paper">{f.panels[k]}</span>
                <span className="t-mono text-mist">{pct(share(k))}</span>
              </figcaption>
              <svg viewBox="0 0 320 150" className="mt-3 block h-auto w-full" aria-hidden="true">
                {(["followed", "other"] as const).map((v) => {
                  const x = v === "followed" ? 70 : 250;
                  const on = !nobody && (v === "followed" ? forwardFollowed : !forwardFollowed);
                  return (
                    <g key={v}>
                      {on ? <circle cx={x} cy={46} r={26} fill="none" stroke={v === "followed" ? "var(--color-signal)" : "var(--color-paper)"} strokeWidth={1.5} /> : null}
                      <circle cx={x} cy={46} r={9} fill={on ? (v === "followed" ? "var(--color-signal)" : "var(--color-paper)") : "var(--color-fog)"} />
                      <text x={x} y={92} textAnchor="middle" className="hold-label">
                        {v === "followed" ? f.voices.followed : f.voices.other}
                      </text>
                    </g>
                  );
                })}
                <circle cx={160} cy={128} r={7} fill="var(--color-mist)" />
                <line
                  x1={160}
                  y1={128}
                  x2={160 + 44 * Math.sin((YAW[look] * Math.PI) / 180)}
                  y2={128 - 44 * Math.cos((YAW[look] * Math.PI) / 180) * (look === "down" ? 0.35 : 1)}
                  stroke="var(--color-mist)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </svg>
              <div className="hold-strip mt-3" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${widest}, minmax(0, 1fr))` }}>
                {data.blocks.map((len, b) =>
                  Array.from({ length: widest }, (_, j) => {
                    const i = starts[b]! + j;
                    const r = j < len ? rows[i] : undefined;
                    return <span key={`${b}-${j}`} className={j >= len ? "hold-cell-none" : r ? (r[k] ? "hold-cell hold-cell-ok" : "hold-cell hold-cell-miss") : "hold-cell"} />;
                  }),
                )}
              </div>
            </figure>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="button" className="hold-chip hold-chip-on" onClick={() => (rows.length >= n ? again() : setPlaying((p) => !p))}>
          {rows.length >= n ? f.again : playing ? f.pause : f.play}
        </button>
        <span className="t-mono text-fog">
          {minutes} {f.minutes} · {f.belief} {last ? pct(last.belief) : "50%"}
        </span>
      </div>
      <p className="mt-6 max-w-[60ch] text-small leading-relaxed text-fog">{f.note.replace("{acc}", pct(data.person.accuracy60))}</p>
    </div>
  );
}
