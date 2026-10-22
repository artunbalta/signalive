import { features } from "@/lib/copy";

/* ==========================================================================
   Figures for /features. Inline SVG, deterministic, no assets.

   Same contract as the home page diagrams: the base rules ARE the reduced
   motion state, a correct and readable still, and the animation is declared
   only inside prefers-reduced-motion: no-preference. Fog draws the apparatus;
   amber marks only what is being attended: the seconds being rewound and the
   playhead on them, the voice that is forward, the sentence being spoken, the
   marked moment, the chain the lab ranks first.
   ========================================================================== */

const TAU = Math.PI * 2;

/** Deterministic 32 bit LCG, so the traces are identical on every render. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A line that reads as speech: three carriers under a syllabic envelope. */
function speech(seed: number, x0: number, x1: number, baseline: number, amp: number): string {
  const r = lcg(seed);
  const freq = [0.3 + r() * 0.08, 0.62 + r() * 0.12, 1.15 + r() * 0.2];
  const phase = [r() * TAU, r() * TAU, r() * TAU];
  const envRate = 0.045 + r() * 0.02;
  const envPhase = r() * TAU;
  let d = "";
  for (let x = x0; x <= x1; x += 2) {
    const env = 0.3 + 0.7 * Math.abs(Math.sin(x * envRate + envPhase)) ** 1.5;
    const carrier =
      0.55 * Math.sin(x * freq[0] + phase[0]) + 0.3 * Math.sin(x * freq[1] + phase[1]) + 0.15 * Math.sin(x * freq[2] + phase[2]);
    d += `${x === x0 ? "M" : "L"}${x} ${(baseline - amp * env * carrier).toFixed(2)}`;
  }
  return d;
}

/* ---- Rewind ---------------------------------------------------------------
   Thirty seconds of conversation over a timeline, one tick per second. The
   last twelve are the ones rewound: amber on the trace and on the bracket,
   and the playhead runs back to where they start, then plays forward. */

const RW_W = 340;
const RW_H = 150;
const RW_X0 = 8;
const RW_X1 = 332;
const RW_AXIS = 112;
const RW_PER_SEC = (RW_X1 - RW_X0) / 30;
const RW_FROM = RW_X1 - 12 * RW_PER_SEC;
const RW_BACK = RW_X1 - RW_FROM;
const RW_TRACE = speech(5107, RW_X0, RW_X1, 54, 26);

const REWIND_CSS = `
.rw-trace { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.rw-head { transform: translateX(-${RW_BACK.toFixed(1)}px); }
@keyframes rw-head {
  0%, 6%    { transform: translateX(0); }
  20%, 28%  { transform: translateX(-${RW_BACK.toFixed(1)}px); }
  92%, 100% { transform: translateX(0); }
}
@media (prefers-reduced-motion: no-preference) {
  .rw-head { animation: rw-head 7s var(--ease-inout-att) infinite; }
}
`;

export function RewindFigure() {
  const c = features.channels[0];
  const ticks: string[] = [];
  for (let s = 0; s <= 30; s++) {
    const x = RW_X0 + s * RW_PER_SEC;
    ticks.push(`M${x.toFixed(1)} ${RW_AXIS - (s % 5 === 0 ? 9 : 4)}V${RW_AXIS}`);
  }
  return (
    <figure className="m-0">
      <style>{REWIND_CSS}</style>
      <svg role="img" aria-label={c.figureLabel} viewBox={`0 0 ${RW_W} ${RW_H}`} className="block h-auto w-full overflow-visible">
        <defs>
          <clipPath id="rw-rewound">
            <rect x={RW_FROM} y={0} width={RW_BACK + 4} height={RW_AXIS - 12} />
          </clipPath>
        </defs>
        {/* The conversation, receded, then its last twelve seconds in amber. */}
        <path d={RW_TRACE} className="rw-trace stroke-fog" strokeWidth={1.25} opacity={0.55} />
        <path d={RW_TRACE} className="rw-trace stroke-signal" strokeWidth={2.5} clipPath="url(#rw-rewound)" />

        <path d={ticks.join("")} className="stroke-fog" strokeWidth={1} opacity={0.6} />
        <line x1={RW_X0} y1={RW_AXIS} x2={RW_X1} y2={RW_AXIS} className="stroke-fog" strokeWidth={1} />
        {/* The rewound span, and the playhead running over it. */}
        <line x1={RW_FROM} y1={RW_AXIS + 7} x2={RW_X1} y2={RW_AXIS + 7} className="stroke-signal" strokeWidth={3} strokeLinecap="round" />
        <g className="rw-head" style={{ transformBox: "view-box" }}>
          <line x1={RW_X1} y1={RW_AXIS - 76} x2={RW_X1} y2={RW_AXIS + 7} className="stroke-signal" strokeWidth={1.5} />
          <circle cx={RW_X1} cy={RW_AXIS + 7} r={5.5} className="fill-signal" />
        </g>

        <text x={RW_X0} y={RW_H - 4} className="t-mono fill-fog">
          {c.ago}
        </text>
        <text x={RW_X1} y={RW_H - 4} textAnchor="end" className="t-mono fill-fog">
          {c.now}
        </text>
      </svg>
      <figcaption className="mt-8 border-t border-hairline pt-6">
        <p className="t-mono text-fog">{c.recapLabel}</p>
        <p className="mt-3 text-body">{c.recap}</p>
      </figcaption>
    </figure>
  );
}

/* ---- Focus ----------------------------------------------------------------
   Three talkers. One at a time comes forward: amber, heavier, full opacity;
   the other two recede. Static, the middle voice is forward, which is the
   one a listener faces when the trial starts. */

const FF_W = 340;
const FF_H = 236;
const FF_ROWS = [
  { label: 16, base: 50, seed: 9137 },
  { label: 94, base: 128, seed: 4421 },
  { label: 172, base: 206, seed: 7741 },
];

const FOCUS_CSS = `
.ff-trace { fill: none; stroke: var(--color-fog); stroke-width: 1.25; opacity: 0.45; stroke-linecap: round; stroke-linejoin: round; }
.ff-trace-1 { stroke: var(--color-signal); stroke-width: 2.5; opacity: 1; }
@keyframes ff-forward {
  0%, 28%     { stroke: var(--color-signal); stroke-width: 2.5; opacity: 1; }
  33.3%, 95%  { stroke: var(--color-fog); stroke-width: 1.25; opacity: 0.45; }
  100%        { stroke: var(--color-signal); stroke-width: 2.5; opacity: 1; }
}
@media (prefers-reduced-motion: no-preference) {
  .ff-trace { animation: ff-forward 9s var(--ease-inout-att) infinite; }
  .ff-trace-0 { animation-delay: 0s; }
  .ff-trace-1 { animation-delay: -6s; }
  .ff-trace-2 { animation-delay: -3s; }
}
`;

export function FocusFigure() {
  const c = features.channels[1];
  return (
    <figure className="m-0">
      <style>{FOCUS_CSS}</style>
      <svg role="img" aria-label={c.figureLabel} viewBox={`0 0 ${FF_W} ${FF_H}`} className="block h-auto w-full">
        {FF_ROWS.map((row, i) => (
          <g key={row.seed}>
            <text x={0} y={row.label} className="t-mono fill-fog">
              {c.voices?.[i]}
            </text>
            <path d={speech(row.seed, 0, FF_W, row.base, 22)} className={`ff-trace ff-trace-${i}`} />
          </g>
        ))}
      </svg>
    </figure>
  );
}

/* ---- Small glyphs for the other three ---------------------------------- */

const G_W = 160;
const G_H = 72;

export function AssistantGlyph({ label }: { label: string }) {
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${G_W} ${G_H}`} className="block h-16 w-[142px]" preserveAspectRatio="xMinYMid meet">
      {/* The question, then the answer a sentence at a time; amber is the one being spoken. */}
      <path d={speech(3301, 0, 56, 36, 14)} fill="none" className="stroke-fog" strokeWidth={1.25} strokeLinecap="round" />
      <line x1={78} y1={22} x2={158} y2={22} className="stroke-signal" strokeWidth={3} strokeLinecap="round" />
      <line x1={78} y1={38} x2={142} y2={38} className="stroke-fog" strokeWidth={3} strokeLinecap="round" opacity={0.6} />
      <line x1={78} y1={54} x2={150} y2={54} className="stroke-fog" strokeWidth={3} strokeLinecap="round" opacity={0.6} />
    </svg>
  );
}

export function NotesGlyph({ label }: { label: string }) {
  const lines = [56, 44, 60, 38];
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${G_W} ${G_H}`} className="block h-16 w-[142px]" preserveAspectRatio="xMinYMid meet">
      {/* A transcript with one marked moment, becoming a note with two action items. */}
      {lines.map((w, i) => (
        <line key={i} x1={12} y1={12 + i * 16} x2={12 + w} y2={12 + i * 16} className="stroke-fog" strokeWidth={2.5} strokeLinecap="round" opacity={0.6} />
      ))}
      <circle cx={3.5} cy={44} r={3.5} className="fill-signal" />
      <path d="M80 36h14M89 31l5 5-5 5" fill="none" className="stroke-fog" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={102} y={8} width={56} height={56} rx={6} fill="none" className="stroke-fog" strokeWidth={1.25} />
      <rect x={111} y={22} width={8} height={8} rx={1.5} fill="none" className="stroke-fog" strokeWidth={1.25} />
      <line x1={125} y1={26} x2={149} y2={26} className="stroke-fog" strokeWidth={2.5} strokeLinecap="round" opacity={0.6} />
      <rect x={111} y={40} width={8} height={8} rx={1.5} fill="none" className="stroke-fog" strokeWidth={1.25} />
      <line x1={125} y1={44} x2={143} y2={44} className="stroke-fog" strokeWidth={2.5} strokeLinecap="round" opacity={0.6} />
    </svg>
  );
}

export function LabGlyph({ label }: { label: string }) {
  // Lower is better: the third chain ranks first, so it is the one in amber.
  const bars = [
    { x: 14, h: 40, ci: 9 },
    { x: 54, h: 30, ci: 7 },
    { x: 94, h: 18, ci: 5 },
    { x: 134, h: 26, ci: 8 },
  ];
  const floor = 66;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${G_W} ${G_H}`} className="block h-16 w-[142px]" preserveAspectRatio="xMinYMid meet">
      <line x1={0} y1={floor} x2={G_W} y2={floor} className="stroke-fog" strokeWidth={1} opacity={0.6} />
      {bars.map((b, i) => {
        const best = i === 2;
        const top = floor - b.h;
        return (
          <g key={b.x}>
            <rect x={b.x} y={top} width={14} height={b.h} rx={2} className={best ? "fill-signal" : "fill-fog"} opacity={best ? 1 : 0.5} />
            <path
              d={`M${b.x + 7} ${top - b.ci}V${top + b.ci}M${b.x + 3} ${top - b.ci}h8M${b.x + 3} ${top + b.ci}h8`}
              fill="none"
              className={best ? "stroke-signal" : "stroke-fog"}
              strokeWidth={1.25}
            />
          </g>
        );
      })}
    </svg>
  );
}
