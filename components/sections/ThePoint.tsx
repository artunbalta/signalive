"use client";

import { useEffect, useRef, useState } from "react";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { thePoint } from "@/lib/copy";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * The point.
 *
 * The section carries the argument the product rests on: an assistant you can
 * reach without stopping. Two parts, in the order the argument runs. What the
 * three gestures actually do, then why three of them is the whole vocabulary.
 *
 * The vocabulary is the part that was not explaining itself, so it is no longer
 * a list of readouts. It is a pinned panel scrubbed through the three gestures,
 * and the drawing on the right plays each one out: the ring at the ear, the
 * thing travelling to the phone, and what the phone does with it. It shares its
 * visual vocabulary with the pinned scene after the hero on purpose. The reader
 * has already been taught there that an amber ring at the ear means the device
 * registered something, and nothing here contradicts that.
 *
 * Amber appears only on the rings, on the thing in transit, and on the captured
 * item while it is still new. Everything the drawing is made of is fog.
 */

const HEADING_ID = "the-point-heading";
const VOCAB_ID = "the-point-vocabulary";

/** Scroll distance the pin holds for, in viewport heights.
 *
 *  Three gestures, and each one is a loop of about three and a half seconds
 *  that has to be seen at least once through. 2.7 gives every stage roughly
 *  0.9 of a viewport of travel, which at an ordinary scroll rate is a few
 *  seconds of dwell. Below about 2.4 the hold sequence, the longest of the
 *  three, gets cut off before the answer comes back. */
const SCROLL_VH = 2.7;

/** Where each gesture takes over, as pin progress. The last band is the widest
 *  because the hold sequence travels out and back and needs the extra dwell,
 *  and because a reader who has reached it is about to be released from the
 *  pin and should not be released mid sentence. */
const STAGE_STARTS = [0, 0.3, 0.63];

/* ==========================================================================
   STAGE GEOMETRY, in viewBox units.

   One viewBox for all three sequences, so switching gesture never moves the
   ear, the phone or the route between them. Only what happens along that route
   changes, which is the entire point being made: same channel, three meanings.
   ========================================================================== */
const W = 560;
const H = 320;

/** The wearer. A solid rounded shape at the ear, not a drawing of an ear. */
const EAR_X = 124;
const EAR_Y = 163;
const EAR_W = 22;
const EAR_H = 30;

/** The wearer.
 *
 *  Not a whole head. A full profile needs the nose, lip and chin to be right or
 *  it reads as a cartoon, and at this size those details collapse into noise.
 *  An ear reduces honestly to two nested curves, the helix and the antihelix,
 *  and it is instantly readable at any scale. The earbud sits in the concha
 *  where one actually sits, and the mandible runs out of frame below it, which
 *  is enough to say "this is on a person" without drawing the person. */
const HELIX =
  "M 150 116 C 110 100 78 124 80 162 C 82 198 104 218 128 214";
const ANTIHELIX =
  "M 141 136 C 116 128 100 148 103 172 C 105 192 116 202 128 200";

/** The mandible, running forward and out of frame. It is the part that moves,
 *  so it is the part that goes amber at the clench. */
const JAW = "M 143 196 C 166 210 182 226 190 248";

/** Base radius of the pulse rings. Larger than half the earbud shape, so a
 *  ring at rest already sits clear of it rather than cutting through it. */
const RING_R = 22;

/** The phone. Outline only: no notch, no buttons, no invented interface. */
const PHONE_X = 400;
const PHONE_Y = 55;
const PHONE_W = 105;
const PHONE_H = 210;
const PHONE_R = 16;

/** Content already in there, and the slot a captured thing lands in. */
const RULE_X = PHONE_X + 18;
const CONTENT = [
  { y: 92, w: 69 },
  { y: 114, w: 52 },
  { y: 136, w: 62 },
];
const SLOT_Y = 168;
const SLOT_W = 60;

/**
 * The route between them. One gentle arc, drawn once in very faint fog and
 * copied per sequence as the track the travelling dot runs on. Both copies use
 * the same `d`, so the dot can never drift off the line it is supposed to
 * follow at any viewport width.
 */
const LINK = "M140 156C214 108 316 106 392 148";

/**
 * Descriptions of the drawing for anyone who cannot see it. These are not
 * product copy and must never become visible text: they describe what is drawn
 * and nothing else. Every visible string in this file comes from lib/copy.
 */
const STAGE_LABELS = [
  "An earbud at the ear with one ring pulsing out from it, an amber dot travelling along a curve to a phone, and a new rule appearing among the lines inside the phone.",
  "An earbud at the ear with two rings pulsing out from it in quick succession, a rule lifting away from the lines inside the phone, and an amber dot travelling back along the curve from the phone to the ear.",
  "An earbud at the ear with one ring held open around it, an amber dot travelling along the curve to the phone and back again, and a small ring blooming at the ear as it returns.",
];

/**
 * Stage animation.
 *
 * CSS keyframes rather than JavaScript, for the same reason the figures in
 * HowItWorks are: the base rule of every animated element is that element in
 * its finished state, so switching the animation off leaves a legible still
 * rather than a blank stage or a half drawn one. No rAF, no timers, no
 * measurement, and nothing to tear down.
 *
 * Each sequence closes by fading its own artefacts out, so the loop restart is
 * a fade and not a cut. The three cycles are deliberately different lengths,
 * which matters less here than in HowItWorks because only one plays at a time,
 * but it also means each gesture has the tempo its own story needs: single is
 * quick, double has to fire twice before it does anything, hold has to hold.
 *
 * The travelling dot is a single round dash on a copy of the route, moved with
 * stroke-dashoffset against pathLength 100. Same technique as the filing figure
 * in HowItWorks: the dot follows the curve exactly with nothing measuring the
 * drawing, and one keyframe set works at every width.
 */
const STAGE_CSS = `
/* Every animated element carries .tp-a. It sets the transform box, and it is
   the single hook the two switch off rules below need. */
.tp-a { transform-box: fill-box; }

.tp-ring { fill: none; stroke: var(--color-signal); stroke-width: 1; }

/* The jaw at rest is part of the head, in fog. It only carries amber while it
   is actually moving, which is what makes the clench the thing you notice. */
.tp-jaw { stroke: var(--color-fog); stroke-width: 1; stroke-opacity: 0.55; }
@keyframes tp-jaw-flex {
  0%, 100% { stroke: var(--color-fog); stroke-width: 1; stroke-opacity: 0.55; }
  6%       { stroke: var(--color-signal); stroke-width: 2; stroke-opacity: 1; }
  22%      { stroke: var(--color-fog); stroke-width: 1; stroke-opacity: 0.55; }
}
@keyframes tp-jaw-hold {
  0%, 100%  { stroke: var(--color-fog); stroke-width: 1; stroke-opacity: 0.55; }
  9%, 34%   { stroke: var(--color-signal); stroke-width: 2; stroke-opacity: 1; }
  44%       { stroke: var(--color-fog); stroke-width: 1; stroke-opacity: 0.55; }
}
.tp-s-jaw { animation: tp-jaw-flex 3400ms var(--ease-out-att) infinite; }
.tp-d-jaw-1 { animation: tp-jaw-flex 3600ms var(--ease-out-att) infinite; animation-delay: 360ms; }
.tp-d-jaw-2 { animation: tp-jaw-flex 3600ms var(--ease-out-att) infinite; animation-delay: 510ms; }
.tp-h-jaw { animation: tp-jaw-hold 4000ms var(--ease-inout-att) infinite; }
.tp-dot {
  fill: none;
  stroke: var(--color-signal);
  stroke-width: 9;
  stroke-linecap: round;
  stroke-dasharray: 0.01 100;
}
.tp-rule { fill: var(--color-signal); }

/* ---- SINGLE, 3400ms. One ring, one trip, one thing filed. --------------
   Ring fires at 170ms and is gone by 750ms. The dot leaves at 580ms and lands
   at 1500ms. The rule draws in behind it, holds amber while it is new, and
   settles to fog at 2450ms, which is the state the still shows. */
.tp-s-ring {
  opacity: 0.9;
  transform: scale(1.15);
  animation: tp-s-ring 3400ms var(--ease-out-att) infinite;
}
@keyframes tp-s-ring {
  0%, 5%   { transform: scale(0.60); opacity: 0; }
  8%       { transform: scale(0.85); opacity: 1; }
  22%      { transform: scale(1.90); opacity: 0; }
  100%     { transform: scale(1.90); opacity: 0; }
}
.tp-s-dot {
  stroke-dashoffset: -99.5;
  opacity: 1;
  animation: tp-s-dot 3400ms var(--ease-out-att) infinite;
}
@keyframes tp-s-dot {
  0%, 17%   { stroke-dashoffset: 0;     opacity: 0; }
  19%       { stroke-dashoffset: 0;     opacity: 1; }
  44%, 53%  { stroke-dashoffset: -99.5; opacity: 1; }
  58%, 100% { stroke-dashoffset: -99.5; opacity: 0; }
}
.tp-s-file {
  transform-origin: left center;
  transform: scaleX(1);
  animation: tp-s-file 3400ms var(--ease-out-att) infinite;
}
@keyframes tp-s-file {
  0%, 44%   { transform: scaleX(0); fill: var(--color-signal); opacity: 1; }
  52%, 58%  { transform: scaleX(1); fill: var(--color-signal); opacity: 1; }
  72%, 91%  { transform: scaleX(1); fill: var(--color-fog);    opacity: 1; }
  100%      { transform: scaleX(1); fill: var(--color-fog);    opacity: 0; }
}

/* ---- DOUBLE, 3600ms. Two rings, then the thing comes back off. --------
   Both rings share one keyframe set. The second gets a delay of one cycle
   minus 150ms, which is a negative offset rather than a positive one so it is
   never sitting at its unstarted base style during the first 150ms: it simply
   fires 150ms behind the first, on every pass. That gap is what makes the
   gesture read as a double rather than as two unrelated pulses. */
@keyframes tp-d-ring {
  0%, 10%  { transform: scale(0.60); opacity: 0; }
  13%      { transform: scale(0.85); opacity: 1; }
  27%      { transform: scale(1.80); opacity: 0; }
  100%     { transform: scale(1.80); opacity: 0; }
}
.tp-d-ring-1 {
  opacity: 0.95;
  transform: scale(1.05);
  animation: tp-d-ring 3600ms var(--ease-out-att) infinite;
}
.tp-d-ring-2 {
  opacity: 0.45;
  transform: scale(1.55);
  animation: tp-d-ring 3600ms var(--ease-out-att) infinite;
  animation-delay: -3450ms;
}
/* Base is hidden, so the still is the fog trace alone: the thing is gone and
   only the mark it left is still there. */
.tp-d-file {
  opacity: 0;
  animation: tp-d-file 3600ms var(--ease-out-att) infinite;
}
@keyframes tp-d-file {
  0%, 25%  { transform: translateY(0);     opacity: 1; }
  36%, 88% { transform: translateY(-16px); opacity: 0; }
  /* Snapped back into the slot while invisible, so the next pass starts with
     the phone holding it again and the loop never jumps. */
  89%      { transform: translateY(0);     opacity: 0; }
  100%     { transform: translateY(0);     opacity: 1; }
}
.tp-d-dot {
  stroke-dashoffset: 0;
  opacity: 1;
  animation: tp-d-dot 3600ms var(--ease-out-att) infinite;
}
@keyframes tp-d-dot {
  0%, 31%   { stroke-dashoffset: -99.5; opacity: 0; }
  34%       { stroke-dashoffset: -99.5; opacity: 1; }
  58%       { stroke-dashoffset: 0;     opacity: 1; }
  64%, 100% { stroke-dashoffset: 0;     opacity: 0; }
}

/* ---- HOLD, 4000ms. The ring is held, and the answer comes back. -------
   The ring reaches full size at 440ms and stays there until 1360ms. That 920ms
   plateau is the whole difference between this and a single: it has to read as
   sustained rather than snapped, so it uses the in-out ease and the plateau is
   a real hold between two keyframes at the same scale. */
.tp-h-ring {
  opacity: 0.9;
  transform: scale(1.30);
  animation: tp-h-ring 4000ms var(--ease-inout-att) infinite;
}
@keyframes tp-h-ring {
  0%, 4%    { transform: scale(0.50); opacity: 0; }
  11%, 34%  { transform: scale(1.30); opacity: 1; }
  39%       { transform: scale(2.00); opacity: 0; }
  100%      { transform: scale(2.00); opacity: 0; }
}
/* The question going out. Hidden in the still: two dots frozen on one route
   would say nothing about which way either of them was going. */
.tp-h-out {
  stroke-dashoffset: -99.5;
  opacity: 0;
  animation: tp-h-out 4000ms var(--ease-out-att) infinite;
}
@keyframes tp-h-out {
  0%, 36%   { stroke-dashoffset: 0;     opacity: 0; }
  38%       { stroke-dashoffset: 0;     opacity: 1; }
  56%       { stroke-dashoffset: -99.5; opacity: 1; }
  59%, 100% { stroke-dashoffset: -99.5; opacity: 0; }
}
/* The answer coming back. This is the one the still keeps, sitting at the ear
   end of the route inside the bloom, because that is what the copy promises. */
.tp-h-back {
  stroke-dashoffset: 0;
  opacity: 1;
  animation: tp-h-back 4000ms var(--ease-out-att) infinite;
}
@keyframes tp-h-back {
  0%, 61%   { stroke-dashoffset: -99.5; opacity: 0; }
  63%       { stroke-dashoffset: -99.5; opacity: 1; }
  82%       { stroke-dashoffset: 0;     opacity: 1; }
  88%, 100% { stroke-dashoffset: 0;     opacity: 0; }
}
.tp-h-bloom {
  opacity: 0.8;
  transform: scale(0.90);
  animation: tp-h-bloom 4000ms var(--ease-out-att) infinite;
}
@keyframes tp-h-bloom {
  0%, 79%  { transform: scale(0.45); opacity: 0; }
  84%      { transform: scale(0.90); opacity: 1; }
  95%      { transform: scale(1.50); opacity: 0; }
  100%     { transform: scale(1.50); opacity: 0; }
}

/* Every sequence holds its finished state when it is not allowed to move.
   The !important is load bearing: globals.css neutralises animation-duration
   globally at the same weight under reduced motion, and without this the
   sequences would snap to their last keyframe, which is the fade out. */
@media (prefers-reduced-motion: reduce) {
  .tp-a { animation: none !important; }
}
/* The same switch, applied per stage rather than per user, for the stills the
   reduced motion branch renders. */
.tp-still .tp-a { animation: none !important; }
`;

/* ==========================================================================
   THE STAGE
   ========================================================================== */

/** The fixed apparatus. Identical in all three sequences and never animated:
 *  the wearer, the route, the phone, and what the phone already holds. */
function StageBase() {
  return (
    <g>
      {/* Drawn first so the ear shape and the phone sit over its ends.
          Every hairline in the drawing carries non-scaling-stroke, so a 1px
          rule stays 1px at 375px as well as at full width. Without it the
          whole apparatus thins to well under half a pixel on a phone and the
          phone outline starts dropping out on some displays. */}
      <path
        className="stroke-fog"
        d={LINK}
        fill="none"
        strokeWidth={1}
        strokeOpacity={0.28}
        vectorEffect="non-scaling-stroke"
      />

      {[HELIX, ANTIHELIX].map((d, i) => (
        <path
          key={i}
          className="stroke-fog"
          d={d}
          fill="none"
          strokeWidth={1}
          strokeOpacity={i === 0 ? 0.6 : 0.4}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      <rect
        className="fill-fog"
        x={EAR_X - EAR_W / 2}
        y={EAR_Y - EAR_H / 2}
        width={EAR_W}
        height={EAR_H}
        rx={EAR_W / 2}
      />

      <rect
        className="stroke-fog"
        x={PHONE_X}
        y={PHONE_Y}
        width={PHONE_W}
        height={PHONE_H}
        rx={PHONE_R}
        fill="none"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {CONTENT.map((line) => (
        <rect
          key={line.y}
          className="fill-fog"
          x={RULE_X}
          y={line.y}
          width={line.w}
          height={2}
          rx={1}
          fillOpacity={0.55}
        />
      ))}
    </g>
  );
}

/** A pulse ring at the ear. Scaled rather than resized so one keyframe set
 *  drives it, and non-scaling-stroke keeps it at exactly 1px at every size it
 *  passes through. A ring that thickens as it grows would read as a glow. */
/** The mandible mark. Shares each sequence's ring timing, because it is the
 *  same event seen from the other side: the jaw tightens, the device registers
 *  it. Drawn at the hinge so the two read as cause and effect, not as two
 *  decorations firing together. */
function Jaw({ cls }: { cls: string }) {
  return (
    <path
      className={`tp-a tp-jaw ${cls}`}
      d={JAW}
      fill="none"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function Ring({ cls, r = RING_R }: { cls: string; r?: number }) {
  return (
    <circle
      className={`tp-a tp-ring ${cls}`}
      cx={EAR_X}
      cy={EAR_Y}
      r={r}
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** The thing in transit, riding the same curve the faint route is drawn from. */
function Dot({ cls }: { cls: string }) {
  return <path className={`tp-a tp-dot ${cls}`} d={LINK} pathLength={100} />;
}

/** Single: one ring, one trip out, one new line in the phone. */
function SingleSequence() {
  return (
    <g>
      <Ring cls="tp-s-ring" />
      <Jaw cls="tp-s-jaw" />
      <Dot cls="tp-s-dot" />
      <rect
        className="tp-a tp-rule tp-s-file"
        x={RULE_X}
        y={SLOT_Y}
        width={SLOT_W}
        height={2}
        rx={1}
      />
    </g>
  );
}

/** Double: two rings 150ms apart, the line lifted back out, one trip home.
 *  The dashed trace stays behind so the drawing still says which line was the
 *  one taken back, rather than just showing an emptier phone. */
function DoubleSequence() {
  return (
    <g>
      <line
        className="stroke-fog"
        x1={RULE_X}
        y1={SLOT_Y + 1}
        x2={RULE_X + SLOT_W}
        y2={SLOT_Y + 1}
        strokeWidth={1.5}
        strokeDasharray="3 4"
        strokeOpacity={0.6}
        vectorEffect="non-scaling-stroke"
      />
      <rect
        className="tp-a tp-rule tp-d-file"
        x={RULE_X}
        y={SLOT_Y}
        width={SLOT_W}
        height={2}
        rx={1}
      />
      <Ring cls="tp-d-ring-1" />
      <Ring cls="tp-d-ring-2" />
      <Jaw cls="tp-d-jaw-1" />
      <Jaw cls="tp-d-jaw-2" />
      <Dot cls="tp-d-dot" />
    </g>
  );
}

/** Hold: the ring is held open, the question goes, the answer comes back and
 *  blooms at the ear. Nothing is filed, because nothing was captured. */
function HoldSequence() {
  return (
    <g>
      <Ring cls="tp-h-ring" />
      <Jaw cls="tp-h-jaw" />
      <Dot cls="tp-h-out" />
      <Dot cls="tp-h-back" />
      <Ring cls="tp-h-bloom" r={14} />
    </g>
  );
}

const SEQUENCES = [SingleSequence, DoubleSequence, HoldSequence];

/**
 * The shared stage.
 *
 * `still` freezes the sequence at its finished state, which is what the reduced
 * motion branch renders. Otherwise the sequence group is keyed on the gesture
 * index, so moving between gestures remounts it and every animation restarts
 * from its first keyframe instead of joining the new one part way through a
 * cycle, which would show the answer before the gesture that asked for it.
 */
function Stage({ mode, still = false }: { mode: number; still?: boolean }) {
  const Sequence = SEQUENCES[mode];
  return (
    <div
      className={
        "w-full rounded-card border border-[var(--hairline)] p-4 sm:p-6 lg:p-8" +
        (still ? " tp-still" : "")
      }
    >
      <svg
        role="img"
        aria-label={STAGE_LABELS[mode]}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        focusable="false"
      >
        <StageBase />
        <g key={mode}>
          <Sequence />
        </g>
      </svg>
    </div>
  );
}

/* ==========================================================================
   COPY BLOCKS
   ========================================================================== */

/** The opening. Identical in both branches, so it lives in one place. */
function Opening() {
  return (
    <div className="grid12">
      <div className="col-span-12 lg:col-span-10">
        <Reveal>
          <p className="t-mono text-fog">{thePoint.eyebrow}</p>
        </Reveal>

        <MaskHeadline
          id={HEADING_ID}
          lines={thePoint.headlineLines}
          className="t-h1 mt-8 text-paper"
        />

        <Reveal className="mt-12 flex flex-col gap-6" staggerChildren={60}>
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
  );
}

/** Why three is enough. The crux, so it gets a rule above it, a narrower
 *  measure and the largest gap on the page either side. */
function Context() {
  return (
    <div className="grid12 border-t border-hairline pt-24 lg:pt-36">
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
  );
}

/* ==========================================================================
   SECTION
   ========================================================================== */

export default function ThePoint() {
  const reduced = useReducedMotion();

  const panelRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  /* ------------------------------------------------------ pin and stages */

  useEffect(() => {
    if (reduced) return;
    const panel = panelRef.current;
    if (!panel) return;

    let dispose = () => {};
    let disposed = false;

    (async () => {
      // Dynamic so GSAP and ScrollTrigger stay out of the first paint graph.
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      gsap.registerPlugin(ScrollTrigger);
      // useReducedMotion cannot know the answer until after mount, so this
      // effect can start with motion allowed and then have the reduced motion
      // tree swap the trigger out from under it while the dynamic import is
      // still in flight. Pinning a node that is no longer in the document
      // throws inside GSAP when it tries to insert its spacer, which is a
      // WebKit visible page error. Check the node is still attached.
      if (disposed || !panel.isConnected) return;

      let current = -1;

      const st = ScrollTrigger.create({
        trigger: panel,
        start: "top top",
        // A function so the distance is remeasured on refresh rather than
        // frozen at whatever the viewport was on mount.
        end: () => "+=" + window.innerHeight * SCROLL_VH,
        pin: true,
        // Pinning a full viewport panel jumps if the pin lands late, so let
        // ScrollTrigger apply it a frame early on fast scrolls.
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const p = self.progress;
          let next = 0;
          for (let i = STAGE_STARTS.length - 1; i >= 0; i--) {
            if (p >= STAGE_STARTS[i]) {
              next = i;
              break;
            }
          }
          if (next === current) return;
          current = next;
          setIndex(next);
        },
      });

      // Everything above this section settles its own media after we mount,
      // which moves our start position. One refresh once we are live corrects
      // it, and matches what the pinned scene after the hero does.
      ScrollTrigger.refresh();

      dispose = () => st.kill(true); // true reverts the pin and its spacer
    })();

    return () => {
      disposed = true;
      dispose();
    };
  }, [reduced]);

  /* ------------------------------------------------------- reduced motion */

  if (reduced) {
    // No pin, no scrub, no loop. The vocabulary becomes what it was always
    // describing, read top to bottom: three ruled rows, each with its gesture
    // and the finished state of what that gesture produces.
    return (
      <section
        id="the-point"
        aria-labelledby={HEADING_ID}
        className="section bg-ink text-paper scroll-mt-[var(--nav-h)]"
      >
        <style href="the-point-stage" precedence="default">
          {STAGE_CSS}
        </style>

        <div className="shell">
          <Opening />

          <div className="mt-28 lg:mt-44">
            <h3 id={VOCAB_ID} className="t-mono text-fog">
              {thePoint.vocabularyHeading}
            </h3>

            <ol aria-labelledby={VOCAB_ID} className="mt-10 lg:mt-14">
              {thePoint.vocabulary.map((item, i) => (
                <li
                  key={item.label}
                  className="grid12 items-start border-t border-hairline py-14 lg:py-20"
                >
                  <div className="col-span-12 lg:col-span-5">
                    <p className="t-mono text-fog">{item.label}</p>
                    {/* h4 under the h3 above it: the section heading is the
                        h2, the subsection label is the h3, these are its
                        members. */}
                    <h4 className="t-h2 mt-5 text-paper">{item.title}</h4>
                    <p className="mt-6 max-w-[46ch] text-mist">{item.body}</p>
                  </div>

                  <div className="col-span-12 mt-12 lg:col-span-6 lg:col-start-7 lg:mt-0">
                    <Stage mode={i} still />
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-28 lg:mt-44">
            <Context />
          </div>
        </div>
      </section>
    );
  }

  /* --------------------------------------------------------------- render */

  return (
    <section
      id="the-point"
      aria-labelledby={HEADING_ID}
      data-stage-active={index}
      className="bg-ink text-paper scroll-mt-[var(--nav-h)]"
    >
      <style href="the-point-stage" precedence="default">
        {STAGE_CSS}
      </style>

      {/* OPENING. Unpinned, and the only part of the section a reader who
          never scrolls past it needs in order to get the argument. */}
      <div className="shell pt-[var(--rhythm)] pb-28 lg:pb-44">
        <Opening />
      </div>

      {/* THE VOCABULARY. Pinned, and scrubbed through the three gestures.
          Full bleed and no radius: the panel is a section, not a card. */}
      <div
        ref={panelRef}
        className="relative flex h-[100svh] min-h-[100svh] w-full flex-col overflow-hidden"
      >
        <div className="shell pt-[calc(var(--nav-h)+28px)]">
          <h3 id={VOCAB_ID} className="t-mono text-fog">
            {thePoint.vocabularyHeading}
          </h3>
        </div>

        {/* Vertical budget, measured at 375x667, which is the tightest
            viewport this has to hold: 100px of top offset, the label, then the
            copy block and the stage stacked. The mobile padding here is what
            keeps the stage from being pushed under the fold inside its own
            pin, so it is deliberately tighter than the desktop value. */}
        <div className="shell flex flex-1 items-center pb-10 pt-6 lg:pb-20 lg:pt-10">
          {/* No gap utility here: .grid12 is unlayered CSS and its 24px gap
              would beat any Tailwind gap class applied on top of it. */}
          <div className="grid12 w-full items-center">
            <div className="col-span-12 lg:col-span-5">
              {/* Three short rules, the active one amber. Amber is legitimate
                  here for the same reason it is everywhere else on the page:
                  it marks the one being attended to. Hidden from assistive
                  technology because the list below already says there are
                  three of these and which one is current. */}
              <ul aria-hidden="true" className="flex items-center gap-2">
                {thePoint.vocabulary.map((item, i) => (
                  <li
                    key={item.label}
                    className={
                      "h-px transition-[width,background-color] duration-[240ms] ease-[var(--ease-out-att)] " +
                      (i === index
                        ? "w-14 bg-signal"
                        : "w-8 bg-[var(--hairline)]")
                    }
                  />
                ))}
              </ul>

              {/* All three gestures are always in the DOM and always in the
                  accessibility tree, stacked in one grid cell so the block
                  never changes height as the scrub moves. Only opacity and
                  transform change, so a screen reader gets the whole
                  vocabulary as one ordered list. */}
              <ol aria-labelledby={VOCAB_ID} className="mt-6 grid lg:mt-10">
                {thePoint.vocabulary.map((item, i) => {
                  const active = i === index;
                  return (
                    <li
                      key={item.label}
                      style={{ gridArea: "1 / 1" }}
                      aria-current={active ? "true" : undefined}
                    >
                      <div
                        style={{
                          opacity: active ? 1 : 0,
                          transform: active ? "none" : "translateY(10px)",
                          // Inactive gestures are stacked on top of the active
                          // one, so they must not intercept a click or a text
                          // selection while they are invisible.
                          pointerEvents: active ? "auto" : "none",
                          transition:
                            "opacity var(--d-fast) var(--ease-out-att), transform var(--d-fast) var(--ease-out-att)",
                        }}
                      >
                        <p className="t-mono text-fog">{item.label}</p>
                        <h4 className="t-h2 mt-4 text-paper">{item.title}</h4>
                        <p className="mt-5 max-w-[38ch] text-mist">
                          {item.body}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="col-span-12 lg:col-span-6 lg:col-start-7">
              <Stage mode={index} />
            </div>
          </div>
        </div>
      </div>

      {/* WHY THREE IS ENOUGH. */}
      <div className="shell pt-28 pb-[var(--rhythm)] lg:pt-44">
        <Context />
      </div>
    </section>
  );
}
