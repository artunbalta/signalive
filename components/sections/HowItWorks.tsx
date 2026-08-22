"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { howItWorks } from "@/lib/copy";
import { useReducedMotion } from "@/lib/useReducedMotion";

/* ==========================================================================
   STEP 03 FIGURE GEOMETRY, in viewBox units.

   The stage keeps its own aspect (width 100%, height auto), so the four slot
   centres at 12.5 / 37.5 / 62.5 / 87.5 percent of the viewBox land on the
   centres of the four equal columns of the HTML row underneath at every width.
   That alignment is the whole trick: the drawing and the labels are different
   technologies sharing one set of proportions.
   ========================================================================== */
const FIG_W = 400;
const FIG_H = 132;
const AXIS_Y = 22;
/** The dot lands here, a few units clear of the bottom edge so its round cap
 *  is never clipped, which reads as resting on the slot rule below. */
const DEST_Y = FIG_H - 4;
/** Control point reach. Each route leaves the axis straight down and enters
 *  its slot straight down, so the curves bundle instead of scribbling. */
const CURVE = 46;

const DEST_X = [50, 150, 250, 350];

/**
 * Each thing heard, in the order the conversation produces it, with the slot
 * it belongs in. The order along the axis is deliberately not the order of the
 * slots: what a thing IS decides where it goes, not when it was said. That is
 * the only reason two of the routes cross.
 */
const CAPTURES = [
  { x: 48, dest: 1 },
  { x: 140, dest: 0 },
  { x: 236, dest: 3 },
  { x: 330, dest: 2 },
];

const CYCLE_MS = 4800;
const BEAT_MS = CYCLE_MS / CAPTURES.length;

/** Negative delays put every element at its own phase from the very first
 *  frame, rather than each one waiting out a lead in before it joins. */
const DELAY = CAPTURES.map((_, i) => `${i === 0 ? 0 : i * BEAT_MS - CYCLE_MS}ms`);

/** Which capture feeds each slot, so a slot lights on its own sender's clock. */
const SRC_OF_DEST = DEST_X.map((_, d) => CAPTURES.findIndex((c) => c.dest === d));

/** The capture frozen mid flight in the static state. See the CSS below. */
const LEAD = 0;
const LEAD_DEST = CAPTURES[LEAD].dest;

const ROUTES = CAPTURES.map(
  (c) =>
    `M${c.x} ${AXIS_Y}C${c.x} ${AXIS_Y + CURVE} ${DEST_X[c.dest]} ${DEST_Y - CURVE} ${DEST_X[c.dest]} ${DEST_Y}`
);

/** Ruler ticks along the axis. Every fourth one is longer, which is what makes
 *  the line read as elapsed conversation rather than as a border. */
function ticks(major: boolean): string {
  let d = "";
  for (let i = 0, x = 8; x <= FIG_W - 8; i++, x += 16) {
    if ((i % 4 === 0) !== major) continue;
    d += `M${x} ${AXIS_Y - (major ? 9 : 5)}V${AXIS_Y}`;
  }
  return d;
}
const TICKS_MINOR = ticks(false);
const TICKS_MAJOR = ticks(true);

/** Not visible copy. The slot names are taken from the copy module so the
 *  description cannot drift from the labels the figure actually draws. */
const FIGURE_LABEL =
  "Diagram of a conversation running left to right. Each thing heard is marked on the line, and one at a time it is carried down into the slot it belongs in: " +
  howItWorks.destinations.map((d) => d.label.toLowerCase()).join(", ") +
  ".";

/**
 * Step 02 diagram.
 *
 * Two abstract streams. The attended one is amber, thicker and fully opaque,
 * the other is fog, thinner and set back. The loop swaps which one is forward,
 * which is the only story this section tells, so the motion is on brief rather
 * than decorative. Each swap takes 600ms (12.5% of the 4800ms cycle) and the
 * rest of the cycle is a hold, so no transition ever runs longer than base.
 *
 * The animation is declared only inside prefers-reduced-motion: no-preference,
 * so the base rules below ARE the reduced motion state: a correct, readable,
 * completely static diagram with no JS involved and no hydration flash. The
 * step 03 figure further down is built on exactly the same contract.
 */
const DIAGRAM_CSS = `
/* The sticky rail is five columns wide. The shared display scale is built for
   a nine column measure and breaks to one word per line in here, so this
   headline alone steps down. Layout constraint, not a new type style. */
#how-it-works-title { font-size: clamp(2.25rem, 3.2vw, 3rem); }

/* Step 03 is the payoff, so its title steps up above the shared h2 scale.
   Same 3rem ceiling as the section headline, so it reads as the equal of the
   headline rather than as a fourth size nobody else on the page uses. */
#how-it-works-step-03 { font-size: clamp(2.25rem, 4.2vw, 3rem); }

.hiw-stream { fill: none; stroke-linecap: round; }
.hiw-stream--fore { stroke: var(--color-signal); stroke-width: 3; opacity: 1; }
.hiw-stream--back { stroke: var(--color-fog); stroke-width: 1.25; opacity: 0.45; }

@keyframes hiw-fore {
  0%, 37.5%  { stroke: var(--color-signal); stroke-width: 3; opacity: 1; }
  50%, 87.5% { stroke: var(--color-fog); stroke-width: 1.25; opacity: 0.45; }
  100%       { stroke: var(--color-signal); stroke-width: 3; opacity: 1; }
}
@keyframes hiw-back {
  0%, 37.5%  { stroke: var(--color-fog); stroke-width: 1.25; opacity: 0.45; }
  50%, 87.5% { stroke: var(--color-signal); stroke-width: 3; opacity: 1; }
  100%       { stroke: var(--color-fog); stroke-width: 1.25; opacity: 0.45; }
}

@media (prefers-reduced-motion: no-preference) {
  .hiw-stream--fore { animation: hiw-fore 4800ms var(--ease-inout-att) infinite; }
  .hiw-stream--back { animation: hiw-back 4800ms var(--ease-inout-att) infinite; }
  /* Only runs while its own step is the attended one. */
  .hiw-paused .hiw-stream--fore,
  .hiw-paused .hiw-stream--back { animation-play-state: paused; }
}

/* ---- Step 03 figure -----------------------------------------------------
   Fog draws the fixed apparatus: the conversation, the four routes and the
   four slots. Amber is only ever on the one item being captured or the one
   slot receiving it, and never on both of two different captures at once.  */

.hiw-axis, .hiw-tick { fill: none; stroke: var(--color-fog); stroke-width: 1; }
.hiw-tick--minor { opacity: 0.32; }
.hiw-tick--major { opacity: 0.6; }
.hiw-route { fill: none; stroke: var(--color-fog); stroke-width: 1; opacity: 0.4; }

/* A thing said, sitting on the line. */
.hiw-heard { fill: var(--color-fog); }

/* The thing in transit: a single round dash travelling its own route. Driving
   it with dashoffset rather than a translate means the dot follows the curve
   without anything having to measure the figure at each width, and pathLength
   normalises every route to 100 so all four share one keyframe. */
.hiw-item {
  fill: none;
  stroke: var(--color-signal);
  stroke-width: 7;
  stroke-linecap: round;
  stroke-dasharray: 0.01 100;
  stroke-dashoffset: 0;
  opacity: 0;
}

.hiw-dest { border-top: 1px solid var(--hairline); color: var(--color-fog); }
/* Labels inherit the slot colour, so one animation drives the rule and the
   name together. The step down in size is a fit constraint: four slots across
   a 375px viewport, and the names must not wrap to two lines in some columns
   and one in others. */
.hiw-dest .hiw-dest-label {
  font-size: clamp(0.6875rem, 2.9vw, 0.75rem);
  color: inherit;
  white-space: nowrap;
}

/* THE STATIC STATE, which is also the reduced motion state: one capture frozen
   at the instant it lands, its slot receiving, everything else at rest. It is
   a true frame of the loop, not a placeholder. */
.hiw-item--lead { stroke-dashoffset: -99.5; opacity: 1; }
.hiw-dest--lead { border-top-color: var(--color-signal); color: var(--color-ink); }

@keyframes hiw-heard {
  0%        { fill: var(--color-fog); }
  5%, 9%    { fill: var(--color-signal); }
  14%, 100% { fill: var(--color-fog); }
}
/* 6% to 18.5% of 4800ms is 600ms of travel. The 5% steps are 240ms. */
@keyframes hiw-item {
  0%, 5%    { stroke-dashoffset: 0;     opacity: 0; }
  6%        { stroke-dashoffset: 0;     opacity: 1; }
  18.5%     { stroke-dashoffset: -99.5; opacity: 1; }
  25%       { stroke-dashoffset: -99.5; opacity: 1; }
  30%, 100% { stroke-dashoffset: -99.5; opacity: 0; }
}
@keyframes hiw-dest {
  0%, 14%   { border-top-color: var(--hairline); color: var(--color-fog); }
  19%, 27%  { border-top-color: var(--color-signal); color: var(--color-ink); }
  32%, 100% { border-top-color: var(--hairline); color: var(--color-fog); }
}

@media (prefers-reduced-motion: no-preference) {
  .hiw-heard { animation: hiw-heard var(--hiw-cycle) var(--ease-out-att) infinite; }
  .hiw-item  { animation: hiw-item var(--hiw-cycle) var(--ease-out-att) infinite; }
  .hiw-dest  { animation: hiw-dest var(--hiw-cycle) var(--ease-out-att) infinite; }
  .hiw-paused .hiw-heard,
  .hiw-paused .hiw-item,
  .hiw-paused .hiw-dest { animation-play-state: paused; }
}
`;

/* A gentle wave rather than a waveform: eight quadratic arcs from x=12 to
   x=196 inside a 200x120 box, which matches the 1200x670 still's aspect so the
   two landscape media slots line up. The second stream starts in antiphase. */
const STREAM_FORE = "M12 46 q11.5 -9 23 0 t23 0 t23 0 t23 0 t23 0 t23 0 t23 0 t23 0";
const STREAM_BACK = "M12 74 q11.5 9 23 0 t23 0 t23 0 t23 0 t23 0 t23 0 t23 0 t23 0";

/**
 * Step 03 figure: a thing heard in conversation, captured and filed.
 *
 * The gesture footage deliberately does not appear here. It belongs to the
 * pinned scene, and spending it twice would cost that scene its only surprise.
 * What this figure adds instead is the half the footage cannot show: where the
 * captured thing actually goes.
 */
function FilingFigure({ paused }: { paused: boolean }) {
  return (
    <div
      role="img"
      aria-label={FIGURE_LABEL}
      className={
        "hiw-file w-full rounded-card border border-[var(--hairline)] p-5 sm:p-8" +
        (paused ? " hiw-paused" : "")
      }
      style={{ "--hiw-cycle": `${CYCLE_MS}ms` } as CSSProperties}
    >
      <svg
        viewBox={`0 0 ${FIG_W} ${FIG_H}`}
        className="block h-auto w-full"
        aria-hidden="true"
        focusable="false"
      >
        {/* Routes first, so the axis crosses them cleanly. */}
        {ROUTES.map((d, i) => (
          <path key={i} className="hiw-route" d={d} />
        ))}

        <path className="hiw-tick hiw-tick--minor" d={TICKS_MINOR} />
        <path className="hiw-tick hiw-tick--major" d={TICKS_MAJOR} />
        <line
          className="hiw-axis"
          x1={0}
          y1={AXIS_Y}
          x2={FIG_W}
          y2={AXIS_Y}
        />

        {CAPTURES.map((c, i) => (
          <circle
            key={`heard-${i}`}
            className="hiw-heard"
            cx={c.x}
            cy={AXIS_Y}
            r={3}
            style={{ animationDelay: DELAY[i] }}
          />
        ))}

        {ROUTES.map((d, i) => (
          <path
            key={`item-${i}`}
            className={"hiw-item" + (i === LEAD ? " hiw-item--lead" : "")}
            d={d}
            pathLength={100}
            style={{ animationDelay: DELAY[i] }}
          />
        ))}
      </svg>

      {/* No gap, so the four top rules meet as one continuous line under the
          figure and only the receiving quarter of it goes amber. */}
      <ul className="grid grid-cols-4">
        {howItWorks.destinations.map((d, i) => (
          <li
            key={d.label}
            className={
              "hiw-dest pt-4 text-center" + (i === LEAD_DEST ? " hiw-dest--lead" : "")
            }
            style={{ animationDelay: DELAY[SRC_OF_DEST[i]] }}
          >
            <span className="t-mono hiw-dest-label">{d.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HowItWorks() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const stepRefs = useRef<Array<HTMLLIElement | null>>([]);

  /**
   * One observer for all three steps. A band across the middle of the viewport
   * decides which step is being attended to. When the band falls between two
   * steps nothing intersects, and we deliberately keep the previous value so
   * there is always exactly one active step and never a frame with none.
   */
  useEffect(() => {
    const els = stepRefs.current.filter(Boolean) as HTMLLIElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;

    const visible = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const i = Number((entry.target as HTMLElement).dataset.stepIndex);
          if (entry.isIntersecting) visible.add(i);
          else visible.delete(i);
        });
        if (visible.size === 0) return;
        // Topmost wins, so scrolling up and down both land on the same step.
        setActive(Math.min(...visible));
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Under reduced motion the active step still changes, it just switches
  // classes with no tween.
  const tint = reduced
    ? ""
    : " transition-colors duration-[600ms] ease-[var(--ease-out-att)]";
  const fade = reduced
    ? ""
    : " transition-opacity duration-[600ms] ease-[var(--ease-out-att)]";
  const markerMotion = reduced
    ? ""
    : " transition-[width,background-color] duration-[240ms] ease-[var(--ease-out-att)]";

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="section surface-paper bg-paper text-ink"
    >
      <style dangerouslySetInnerHTML={{ __html: DIAGRAM_CSS }} />

      <div className="shell">
        <div className="grid12">
          {/* Sticky only from lg up. self-start keeps the grid item at its
              content height, otherwise it stretches and sticky has no travel. */}
          <div
            className="col-span-12 lg:col-span-5 lg:sticky self-start mb-16 lg:mb-0"
            style={{ top: "calc(var(--nav-h) + 56px)" }}
          >
            <Reveal>
              <p className="t-mono text-fog">{howItWorks.eyebrow}</p>
            </Reveal>
            <MaskHeadline
              id="how-it-works-title"
              lines={howItWorks.headlineLines}
              className="t-h1 mt-6 text-ink"
            />
          </div>

          <ol className="col-span-12 lg:col-start-7 lg:col-span-6">
            {howItWorks.steps.map((step, i) => {
              const isActive = i === active;
              const titleId = `how-it-works-step-${step.index}`;
              /* Step 03 is the reason the other two exist, so it takes the
                 whole column: text at full measure, figure full width below
                 it rather than in the 240px slot the first two share. */
              const isPayoff = i === 2;

              return (
                <li
                  key={step.index}
                  data-step-index={i}
                  aria-labelledby={titleId}
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  className={
                    i === 0
                      ? ""
                      : "mt-20 xl:mt-28 pt-12 xl:pt-16 border-t border-[var(--hairline)]"
                  }
                >
                  <Reveal
                    className={
                      isPayoff
                        ? "block"
                        : "grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_240px] gap-10 xl:gap-8 items-start"
                    }
                  >
                    <div>
                      <div className="flex items-center gap-4">
                        {/* Amber marks the step being attended to. It is the
                            same rule as everywhere else on this page. */}
                        <span
                          aria-hidden="true"
                          className={
                            "block h-px" +
                            markerMotion +
                            (isActive
                              ? " w-8 bg-signal"
                              : " w-3 bg-[var(--hairline)]")
                          }
                        />
                        <span
                          className={
                            "t-mono" + tint + (isActive ? " text-ink" : " text-fog")
                          }
                        >
                          {step.index}
                        </span>
                      </div>

                      <h3
                        id={titleId}
                        className={
                          "t-h2 mt-5" + tint + (isActive ? " text-ink" : " text-fog")
                        }
                      >
                        {step.title}
                      </h3>

                      {/* Body copy never dims with the active state. 17px sits
                          under the 18px threshold, so it holds the mist value
                          at full opacity whether or not this step is attended. */}
                      <p className="mt-5 max-w-[46ch] text-mist">{step.body}</p>
                    </div>

                    <div
                      className={
                        "w-full" +
                        (isPayoff ? " mt-12 xl:mt-16" : "") +
                        fade +
                        (isActive ? "" : " opacity-60")
                      }
                    >
                      {i === 0 && (
                        <img
                          src="/media/step-01.webp"
                          alt={step.alt}
                          width={1200}
                          height={670}
                          loading="lazy"
                          decoding="async"
                          className="block w-full h-auto max-w-[520px] xl:max-w-none rounded-card object-cover"
                        />
                      )}

                      {i === 1 && (
                        <svg
                          role="img"
                          aria-label={step.alt}
                          viewBox="0 0 200 120"
                          width={200}
                          height={120}
                          className={
                            "block w-full h-auto max-w-[520px] xl:max-w-none rounded-card border border-[var(--hairline)]" +
                            (isActive ? "" : " hiw-paused")
                          }
                        >
                          <path className="hiw-stream hiw-stream--fore" d={STREAM_FORE} />
                          <path className="hiw-stream hiw-stream--back" d={STREAM_BACK} />
                        </svg>
                      )}

                      {isPayoff && <FilingFigure paused={!isActive} />}
                    </div>
                  </Reveal>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
