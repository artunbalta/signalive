import type { ReactNode } from "react";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { thePoint } from "@/lib/copy";

/* ==========================================================================
   FIGURE GEOMETRY, in viewBox units.

   All three figures share one axis so they read as three states of the same
   instrument rather than three illustrations. Nothing here is decorative: the
   axis is time, the mark is the moment the device registered the gesture, and
   amber only ever sits on whichever element is active at that instant.
   ========================================================================== */
const FIG_W = 260;
const FIG_H = 104;

const AXIS_Y = 74;
const X_START = 8;
const X_END = 252;
const TICK_TOP = 66;
const TICK_COUNT = 9;

/** Where the mark is laid down, and how far back behind it gets marked. */
const MARK_X = 214;
const SPAN_X0 = 138;
const MARK_TOP = 44;
const MARK_BOTTOM = 86;

/** The sustained gesture, and the channel the answer comes back on. */
const BAR_X0 = 30;
const BAR_X1 = 150;
const REPLY_Y = 32;
const REPLY_X0 = 30;
const REPLY_X1 = 200;

const TICKS = Array.from(
  { length: TICK_COUNT },
  (_, i) => X_START + (i * (X_END - X_START)) / (TICK_COUNT - 1)
);

/**
 * Descriptions of the three figures for anyone who cannot see them. These are
 * not product copy and must never become visible text: they describe the
 * drawing, nothing more. Visible strings all come from lib/copy.
 */
const FIGURE_LABELS = [
  "A timeline with a single mark laid down on it and the span behind that mark highlighted.",
  "The same timeline, with the mark and the span behind it lifted back off, leaving only a faint trace.",
  "A timeline where a bar fills for as long as the gesture is held, then a reply returns along the channel above it.",
];

/**
 * Figure animation.
 *
 * CSS rather than JavaScript because the resting state of each figure has to
 * be the readout in its finished state: with the animation switched off the
 * base rules below are what remains, which is a legible static instrument.
 * The reduced motion query does exactly that switch, so nothing needs a rAF
 * loop, a timer, or a hydration boundary, and the whole section stays server
 * rendered.
 *
 * The three cycles are deliberately different lengths so three loops sharing a
 * viewport never beat in unison.
 */
const FIGURE_CSS = `
.tp-a { transform-box: fill-box; }

/* Single: the mark drops in, then the span behind it is marked. */
.tp-s-span {
  transform-origin: right center;
  transform: scaleX(1);
  animation: tp-s-span 3200ms var(--ease-out-att) infinite;
}
@keyframes tp-s-span {
  0%, 8%   { transform: scaleX(0); opacity: 1; }
  28%, 82% { transform: scaleX(1); opacity: 1; }
  100%     { transform: scaleX(1); opacity: 0; }
}
.tp-s-mark {
  transform: translateY(0);
  animation: tp-s-mark 3200ms var(--ease-out-att) infinite;
}
@keyframes tp-s-mark {
  0%       { transform: translateY(-10px); opacity: 0; }
  8%, 82%  { transform: translateY(0); opacity: 1; }
  100%     { transform: translateY(0); opacity: 0; }
}

/* Double: the same sequence, run backwards. The mark leaves the way it came
   and the trace underneath is all that is left, which is the resting state. */
.tp-d-span {
  transform-origin: right center;
  transform: scaleX(0);
  animation: tp-d-span 3600ms var(--ease-out-att) infinite;
}
@keyframes tp-d-span {
  0%, 8%    { transform: scaleX(0); }
  26%, 50%  { transform: scaleX(1); }
  68%, 100% { transform: scaleX(0); }
}
.tp-d-mark {
  transform: translateY(-22px);
  animation: tp-d-mark 3600ms var(--ease-out-att) infinite;
}
@keyframes tp-d-mark {
  0%        { transform: translateY(-22px); opacity: 0; }
  8%, 50%   { transform: translateY(0); opacity: 1; }
  68%, 100% { transform: translateY(-22px); opacity: 0; }
}

/* Hold: the bar is amber while it is the thing being held, then hands amber
   over to the reply. The colour is the transfer of attention, not an accent. */
.tp-h-bar {
  transform-origin: left center;
  transform: scaleX(1);
  stroke: var(--color-fog);
  animation: tp-h-bar 4000ms var(--ease-out-att) infinite;
}
@keyframes tp-h-bar {
  0%       { transform: scaleX(0.08); stroke: var(--color-signal); opacity: 1; }
  14%, 46% { transform: scaleX(1); stroke: var(--color-signal); opacity: 1; }
  56%, 88% { transform: scaleX(1); stroke: var(--color-fog); opacity: 1; }
  100%     { transform: scaleX(1); stroke: var(--color-fog); opacity: 0; }
}
.tp-h-reply {
  transform-origin: right center;
  transform: scaleX(1);
  animation: tp-h-reply 4000ms var(--ease-out-att) infinite;
}
@keyframes tp-h-reply {
  0%, 50%  { transform: scaleX(0); opacity: 1; }
  70%, 88% { transform: scaleX(1); opacity: 1; }
  100%     { transform: scaleX(1); opacity: 0; }
}
.tp-h-cap { animation: tp-h-cap 4000ms var(--ease-out-att) infinite; }
@keyframes tp-h-cap {
  0%, 66%  { opacity: 0; }
  72%, 88% { opacity: 1; }
  100%     { opacity: 0; }
}

/* Reduced motion: every figure holds its finished state. The !important is
   load bearing, since globals.css neutralises durations globally with the same
   weight and would otherwise leave these snapping to their last keyframe. */
@media (prefers-reduced-motion: reduce) {
  .tp-a { animation: none !important; }
}
`;

/** The shared axis. Fog, always, in all three figures. */
function Axis() {
  return (
    <g className="stroke-fog" fill="none">
      <line x1={X_START} y1={AXIS_Y} x2={X_END} y2={AXIS_Y} strokeWidth={1} />
      {TICKS.map((x) => (
        <line
          key={x}
          x1={x}
          y1={TICK_TOP}
          x2={x}
          y2={AXIS_Y}
          strokeWidth={1}
          strokeOpacity={0.55}
        />
      ))}
    </g>
  );
}

function FigureFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${FIG_W} ${FIG_H}`}
      className="block h-auto w-full max-w-[400px] lg:ml-auto"
    >
      <Axis />
      {children}
    </svg>
  );
}

/** Single: a mark laid down, and the span behind it marked with it. */
function SingleFigure() {
  return (
    <FigureFrame label={FIGURE_LABELS[0]}>
      <line
        className="tp-a tp-s-span stroke-signal"
        x1={SPAN_X0}
        y1={AXIS_Y}
        x2={MARK_X}
        y2={AXIS_Y}
        strokeWidth={3}
      />
      <line
        className="tp-a tp-s-mark stroke-signal"
        x1={MARK_X}
        y1={MARK_TOP}
        x2={MARK_X}
        y2={MARK_BOTTOM}
        strokeWidth={2}
      />
    </FigureFrame>
  );
}

/** Double: the same mark, lifted back off. The dashed trace stays put so the
    figure still says which mark was taken back. */
function DoubleFigure() {
  return (
    <FigureFrame label={FIGURE_LABELS[1]}>
      <g className="stroke-fog" strokeOpacity={1} strokeDasharray="3 3">
        <line x1={SPAN_X0} y1={AXIS_Y} x2={MARK_X} y2={AXIS_Y} strokeWidth={3} />
        <line x1={MARK_X} y1={MARK_TOP} x2={MARK_X} y2={MARK_BOTTOM} strokeWidth={2} />
      </g>
      <line
        className="tp-a tp-d-span stroke-signal"
        x1={SPAN_X0}
        y1={AXIS_Y}
        x2={MARK_X}
        y2={AXIS_Y}
        strokeWidth={3}
      />
      <line
        className="tp-a tp-d-mark stroke-signal"
        x1={MARK_X}
        y1={MARK_TOP}
        x2={MARK_X}
        y2={MARK_BOTTOM}
        strokeWidth={2}
      />
    </FigureFrame>
  );
}

/** Hold: a bar for as long as the jaw is held, then an answer coming back. */
function HoldFigure() {
  return (
    <FigureFrame label={FIGURE_LABELS[2]}>
      <line
        className="tp-a tp-h-bar"
        x1={BAR_X0}
        y1={AXIS_Y}
        x2={BAR_X1}
        y2={AXIS_Y}
        strokeWidth={3}
      />
      <line
        className="tp-a tp-h-reply stroke-signal"
        x1={REPLY_X0}
        y1={REPLY_Y}
        x2={REPLY_X1}
        y2={REPLY_Y}
        strokeWidth={2}
      />
      <line
        className="tp-a tp-h-cap stroke-signal"
        x1={REPLY_X0}
        y1={REPLY_Y - 6}
        x2={REPLY_X0}
        y2={REPLY_Y + 6}
        strokeWidth={2}
      />
    </FigureFrame>
  );
}

/** The vocabulary is a fixed set of three in the copy deck, and each figure
    draws the specific action its row describes, so the pairing is positional
    on purpose. A fourth entry would need a fourth figure, not a fallback. */
const FIGURES = [SingleFigure, DoubleFigure, HoldFigure];

/**
 * The point.
 *
 * The largest section on the page, because it carries the argument the product
 * rests on: an assistant you can reach without stopping. Three subsections, in
 * the order the argument runs. What the gestures are, why three of them is the
 * whole vocabulary, and what happens to what you captured.
 *
 * Server rendered. The copy is the substance here and exists without
 * JavaScript; only the entrances and the figure loops are motion, and both
 * degrade to plain visible content.
 */
export default function ThePoint() {
  return (
    <section
      id="the-point"
      aria-labelledby="the-point-heading"
      className="section bg-ink text-paper scroll-mt-[var(--nav-h)]"
    >
      <style href="the-point-figures" precedence="default">
        {FIGURE_CSS}
      </style>

      <div className="shell">
        {/* OPENING */}
        <div className="grid12">
          <div className="col-span-12 lg:col-span-10">
            <Reveal>
              <p className="t-mono text-fog">{thePoint.eyebrow}</p>
            </Reveal>

            <MaskHeadline
              id="the-point-heading"
              lines={thePoint.headlineLines}
              className="t-h1 mt-8 text-paper"
            />

            <Reveal
              className="mt-12 flex max-w-[62ch] flex-col gap-6"
              staggerChildren={60}
            >
              {thePoint.paragraphs.map((paragraph) => (
                // Lead size: this is the section's argument, and at body size
                // under an 80px headline it read as fine print.
                <p key={paragraph} className="t-lead max-w-[54ch] text-mist">
                  {paragraph}
                </p>
              ))}
            </Reveal>
          </div>
        </div>

        {/* A. THE VOCABULARY. One row per gesture, each row the gesture on the
            left and the resulting action drawn on the right. */}
        <div className="mt-28 lg:mt-44">
          <Reveal>
            <h3 className="t-mono text-fog">{thePoint.vocabularyHeading}</h3>
          </Reveal>

          <ul className="mt-10 lg:mt-14">
            {thePoint.vocabulary.map((item, i) => {
              const Figure = FIGURES[i];
              return (
                <li
                  key={item.label}
                  className="grid12 items-start border-t border-hairline py-14 lg:py-20"
                >
                  <Reveal className="col-span-12 lg:col-span-6">
                    <p className="t-mono text-fog">{item.label}</p>
                    {/* h4 under the h3 above it: the section heading is the h2,
                        the subsection label is the h3, these are its members. */}
                    <h4 className="t-h2 mt-5 text-paper">{item.title}</h4>
                    <p className="mt-6 max-w-[46ch] text-mist">{item.body}</p>
                  </Reveal>

                  <Reveal
                    className="col-span-12 mt-12 lg:col-span-5 lg:col-start-8 lg:mt-2"
                    delay={120}
                  >
                    <Figure />
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </div>

        {/* B. WHY THREE IS ENOUGH. The crux, so it gets a rule above it, a
            narrower measure and the largest gap on the page either side. */}
        <div className="grid12 mt-28 border-t border-hairline pt-24 lg:mt-44 lg:pt-36">
          <div className="col-span-12 lg:col-span-8 lg:col-start-3">
            <MaskHeadline
              as="h3"
              lines={thePoint.context.headlineLines}
              className="t-h2 text-paper"
            />
            <Reveal>
              <p className="t-lead mt-10 max-w-[52ch] text-mist">
                {thePoint.context.body}
              </p>
            </Reveal>
          </div>
        </div>

        {/* C. WHERE IT GOES.

            Not a card grid. Four rounded boxes of equal weight say nothing
            about what this section is actually describing, which is routing:
            a thing heard in a conversation being sent somewhere specific. So
            it is set as a ruled index, the same instrument language the
            science figure and the filing diagram already use. Hovering a row
            draws an amber leader from the label to its destination, which is
            the route being made, and is the only amber here. */}
        <div className="mt-28 lg:mt-44">
          <Reveal>
            <h3 className="t-mono text-fog">{thePoint.destinationsHeading}</h3>
          </Reveal>

          <Reveal
            as="ul"
            className="mt-10 border-t border-hairline lg:mt-12"
            staggerChildren={60}
          >
            {thePoint.destinations.map((item) => (
              <li
                key={item.label}
                className="group border-b border-hairline"
              >
                <div className="flex flex-col gap-4 py-7 md:flex-row md:items-baseline md:gap-10 lg:py-9">
                  <p className="t-mono w-[10ch] shrink-0 text-mist transition-colors duration-[240ms] ease-[var(--ease-out-att)] group-hover:text-paper">
                    {item.label}
                  </p>

                  {/* The leader. A fog rule that an amber one grows along from
                      the label end, so the movement reads left to right, from
                      the thing captured toward where it lands. */}
                  <span
                    aria-hidden="true"
                    className="relative hidden h-px flex-1 self-center bg-[var(--hairline)] md:block"
                  >
                    <span className="absolute inset-0 origin-left scale-x-0 bg-signal transition-transform duration-[600ms] ease-[var(--ease-out-att)] group-hover:scale-x-100" />
                  </span>

                  <p className="text-mist md:max-w-[42ch] md:text-right">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
