"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { oneClench } from "@/lib/copy";
import {
  CLENCH_TIME,
  CLENCH_LEAD,
  EAR_X,
  EAR_Y,
  VIDEO_ASPECT,
} from "@/lib/clench";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * One clench. The pinned scene straight after the hero.
 *
 * Four beats of a single continuous take. Nothing cuts, nothing splits into
 * panels: the footage runs underneath the whole thing and the only edit is the
 * line of copy on top of it. The beat that matters is the third one, where the
 * amber ring fires at the ear on the frame the jaw actually moves, and the
 * fourth, where the calendar entry it produced settles in and stays.
 *
 * Amber appears exactly twice here, and both times it marks something the
 * device is acting on: the ring at the moment the clench is registered, and the
 * hairline on the confirmation that command produced.
 */

const HEADING_ID = "one-clench-heading";

/** Scroll distance the pin holds for, in viewport heights.
 *
 *  This is a budget, not a preference. The balance check requires that someone
 *  who scrolls only the first two viewports has already seen the clench. The
 *  hero spends the first viewport, and the clench beat starts at 0.46 of pin
 *  progress, so the pin gets at most (2 - 1) / 0.46 = 2.17 viewports of travel.
 *  Measured rather than assumed: at 1.9 the beat landed at 1762px of an 1800px
 *  budget, a 2 percent margin, because the hero renders taller than one bare
 *  viewport. 1.6 puts it near 1650px and still gives the clench beat about
 *  0.45 of a viewport of dwell.
 *  scripts/balance.mjs measures this for real rather than trusting the maths. */
const SCROLL_VH = 1.6;

/** Where each beat takes over, as pin progress. The clench beat and the
 *  confirmation get the widest bands because both carry motion that has to
 *  finish before the reader moves on. */
const BEAT_STARTS = [0, 0.22, 0.46, 0.74];

/** Index of the beat that narrates the clench. */
const CLENCH_BEAT = 2;

/**
 * Once currentTime falls back below this the clip has looped, so the marker
 * re-arms for the next pass. Comfortably below the cue point, and comfortably
 * above the largest jump a single frame can make.
 */
const REARM_TIME = 0.4;

/* Ring geometry. A precise instrument marker: 1px amber, no fill, no blur, no
   glow, no shadow. Sized as a fraction of the stage width, which is the video's
   own display width, so it tracks the head at every viewport. */
const RING_PCT = 0.08;
const RING_TO = 1.6;
const PULSE_MS = 400;

/* Confirmation card timing: in, hold, then settle to its resting position. */
const CARD_IN_MS = 600;
const CARD_HOLD_MS = 1200;

/**
 * THE COVER STAGE.
 *
 * The source is portrait 720x1280 and this is a landscape stage, so something
 * has to be cropped. Rather than object-cover on the video (which crops from
 * the centre and takes the ear, the one part of the frame that matters, out of
 * frame on wide viewports), the video is given a box locked to its own 9/16
 * ratio and scaled up until it covers the section. The pulse ring then lives
 * inside that same box and is positioned in the video's own coordinates, so it
 * stays on the ear at every viewport size with no JS measurement at all.
 *
 * 100vw rather than 100% because a percentage height would resolve against the
 * parent's height, not its width. That counts the scrollbar, so the stage can
 * be a handful of pixels wider than the section, which the section clips.
 */
const STAGE_W = `max(100vw, calc(100svh * ${VIDEO_ASPECT}))`;
const STAGE_H = `max(100svh, calc(100vw / ${VIDEO_ASPECT}))`;

/** Where the ear should sit vertically inside the section. Biasing the stage
 *  up like this is what keeps the head in frame instead of centring the video
 *  and cropping the top third away. Clamped so the stage can never leave a gap
 *  at the top or bottom on tall viewports, where it only just covers. */
const EAR_TARGET_Y = 0.32;
const STAGE_TOP = `clamp(calc(100% - ${STAGE_H}), calc(${
  EAR_TARGET_Y * 100
}% - ${STAGE_H} * ${EAR_Y}), 0px)`;

const stageStyle: CSSProperties = {
  left: "50%",
  top: STAGE_TOP,
  width: STAGE_W,
  height: STAGE_H,
  transform: "translateX(-50%)",
};

/** Two scrims in one layer: a heavier one under the copy at the bottom, a
 *  lighter one under the eyebrow at the top, and a clear band across the middle
 *  so the ring reads as a mark on the footage rather than through a wash. */
const SCRIM =
  "linear-gradient(to bottom, rgba(11,11,12,0.78) 0%, rgba(11,11,12,0.20) 26%, rgba(11,11,12,0) 44%)," +
  "linear-gradient(to top, rgba(11,11,12,0.94) 0%, rgba(11,11,12,0.62) 30%, rgba(11,11,12,0.10) 62%, rgba(11,11,12,0) 78%)";

type CardPhase = "out" | "in" | "settled";

export default function OneClench() {
  const reduced = useReducedMotion();

  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);

  const [beat, setBeat] = useState(0);
  const [cardPhase, setCardPhase] = useState<CardPhase>("out");

  /** Read by the rAF loop, which must not re-subscribe every time a beat
   *  changes or it would drop the armed state mid clip. */
  const beatRef = useRef(0);
  beatRef.current = beat;

  /** Set by the playback effect, called by the beat effect. Same reason: the
   *  loop that owns the armed state has to survive a beat change. */
  const cueRef = useRef<(() => void) | null>(null);

  /* ------------------------------------------------------ pin and beats */

  useEffect(() => {
    if (reduced) return;
    const section = sectionRef.current;
    if (!section) return;

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
      if (disposed || !section.isConnected) return;

      let current = -1;

      const st = ScrollTrigger.create({
        trigger: section,
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
          for (let i = BEAT_STARTS.length - 1; i >= 0; i--) {
            if (p >= BEAT_STARTS[i]) {
              next = i;
              break;
            }
          }
          if (next === current) return;
          current = next;
          setBeat(next);
        },
      });

      // The hero settles its own media after we mount, which moves our start
      // position. One refresh once we are live corrects it.
      ScrollTrigger.refresh();

      dispose = () => st.kill(true); // true reverts the pin and its spacer
    })();

    return () => {
      disposed = true;
      dispose();
    };
  }, [reduced]);

  /* ----------------------------------------------------- playback + pulse */

  useEffect(() => {
    if (reduced) return;
    const video = videoRef.current;
    const ring = ringRef.current;
    if (!video || !ring) return;

    let raf = 0;
    let armed = true;
    /** The marker re-arms once currentTime falls below this. Normally that
     *  means the clip has looped. A cue lowers it to just under the clench so
     *  the seek itself re-arms the marker for the pass it just set up. */
    let rearmBelow = REARM_TIME;

    const pulse = () => {
      ring.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          { transform: `translate(-50%, -50%) scale(${RING_TO})`, opacity: 0 },
        ],
        { duration: PULSE_MS, easing: "cubic-bezier(0.16, 1, 0.30, 1)" }
      );
    };

    /**
     * The marker is driven off the video's own currentTime rather than a timer,
     * so it stays locked to the footage across every loop, after a stall, and
     * after a tab has been backgrounded. Note what this is NOT doing: it never
     * writes currentTime from scroll progress. Continuously scrubbing a video
     * from scroll is unreliable across browsers, and in Safari, which coalesces
     * and throttles seeks, it is visibly broken. One seek, then let it play.
     */
    const tick = () => {
      const t = video.currentTime;
      if (armed) {
        // Held until the clench beat so the ring fires once, with its line,
        // rather than quietly on every earlier loop.
        if (t >= CLENCH_TIME && beatRef.current >= CLENCH_BEAT) {
          armed = false;
          rearmBelow = REARM_TIME;
          pulse();
        }
      } else if (t < rearmBelow) {
        armed = true;
      }
      raf = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const stopLoop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    // The stage is deliberately larger than the viewport, so observing the
    // video would never reach a meaningful threshold. Watch the section.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void video.play().catch(() => {
            /* Autoplay refused. The poster stays, the copy still stands. */
          });
          startLoop();
        } else {
          video.pause();
          stopLoop();
        }
      },
      { threshold: 0 }
    );
    if (sectionRef.current) io.observe(sectionRef.current);

    /* Cueing the clench is the one thing this component asks of the reader's
       sense of timing, so it is done on the transition into the beat: seek to
       CLENCH_LEAD before the movement, then play, so the line lands and then
       the jaw moves. */
    const cue = () => {
      const seek = () => {
        // Disarmed first, so a frame landing between here and the seek taking
        // effect cannot fire the ring at whatever time the clip happened to be
        // at. The lowered floor re-arms it as soon as the seek lands.
        armed = false;
        rearmBelow = CLENCH_TIME - 0.05;
        try {
          video.currentTime = Math.max(0, CLENCH_TIME - CLENCH_LEAD);
        } catch {
          /* A seek before the media is seekable is not fatal, the loop
             continues and the marker fires on the next pass. */
        }
        void video.play().catch(() => {});
      };
      if (video.readyState >= 1) seek();
      else video.addEventListener("loadedmetadata", seek, { once: true });
    };

    cueRef.current = cue;

    return () => {
      io.disconnect();
      stopLoop();
      cueRef.current = null;
    };
  }, [reduced]);

  /* Arriving at the clench beat cues the footage. Going through a ref rather
     than a dependency is deliberate: the rAF loop above owns the armed state,
     and re-running it on every beat change would reset that mid clip. */
  useEffect(() => {
    if (reduced || beat !== CLENCH_BEAT) return;
    cueRef.current?.();
  }, [beat, reduced]);

  /* ------------------------------------------------------ the confirmation */

  useEffect(() => {
    if (reduced) return;
    if (beat < 3) {
      // Scrubbing back retracts it. It only exists once the command has landed.
      setCardPhase("out");
      return;
    }
    setCardPhase("in");
    const t = window.setTimeout(
      () => setCardPhase("settled"),
      CARD_IN_MS + CARD_HOLD_MS
    );
    return () => window.clearTimeout(t);
  }, [beat, reduced]);

  /* ------------------------------------------------------------- fragments */

  const ring = (
    <span
      ref={ringRef}
      className="absolute block aspect-square rounded-pill border border-signal"
      style={{
        left: `${EAR_X * 100}%`,
        top: `${EAR_Y * 100}%`,
        width: `${RING_PCT * 100}%`,
        transform: "translate(-50%, -50%) scale(1)",
        // Held invisible until the clench fires. Under reduced motion it is
        // simply always on, marking the same point.
        opacity: reduced ? 0.9 : 0,
      }}
    />
  );

  /**
   * The confirmation.
   *
   * A slab that fades in says "a notification arrived". What actually happened
   * is that a line was written into a day, so it is drawn as a fragment of a
   * calendar column: ruled empty slots above and below, a day column edge, and
   * the entry sitting in one of the slots behind an amber event bar. The rules
   * carry no text, so no copy is invented by the structure.
   *
   * The entrance is staggered off one state change rather than popping: the
   * rules settle, the amber bar wipes down, the entry is clipped open to the
   * right of it, then the three lines arrive. It reads as being written.
   */
  const cardIn = cardPhase !== "out";
  const ease = "var(--ease-out-att)";
  const at = (delay: number, ms = 320) => ({
    transition: `opacity ${ms}ms ${ease} ${delay}ms, transform ${ms}ms ${ease} ${delay}ms, clip-path ${ms}ms ${ease} ${delay}ms`,
  });

  const card = (
    <div
      role="img"
      aria-label={oneClench.cardAlt}
      className="w-[min(22rem,82vw)]"
    >
      <div className="relative pl-9">
        {/* The edge of the day column. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-9 w-px bg-[var(--hairline)]"
          style={{ opacity: cardIn ? 1 : 0, ...at(0) }}
        />

        {/* An empty slot above and below, so the entry reads as placed into a
            day rather than floating on its own. */}
        <span
          aria-hidden="true"
          className="block h-9 border-t border-hairline"
          style={{ opacity: cardIn ? 1 : 0, ...at(0) }}
        />

        <div
          className="relative overflow-hidden border-y border-hairline bg-slate"
          style={{
            clipPath: cardIn ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
            ...at(220, 480),
          }}
        >
          {/* The event bar, wiping down the way a calendar block is drawn.
              Amber because this is the thing that just landed. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-[3px] origin-top bg-signal"
            style={{ transform: `scaleY(${cardIn ? 1 : 0})`, ...at(140) }}
          />

          <div className="py-4 pl-5 pr-4">
            {[
              { key: "day", cls: "t-mono text-mist", text: oneClench.card.day },
              { key: "title", cls: "pt-2 text-paper", text: oneClench.card.title },
              { key: "time", cls: "t-mono pt-2 text-mist", text: oneClench.card.time },
            ].map((line, i) => (
              <p
                key={line.key}
                className={line.cls}
                style={{
                  opacity: cardIn ? 1 : 0,
                  transform: cardIn ? "none" : "translateY(6px)",
                  ...at(460 + i * 90),
                }}
              >
                {line.text}
              </p>
            ))}
          </div>
        </div>

        <span
          aria-hidden="true"
          className="block h-9 border-b border-hairline"
          style={{ opacity: cardIn ? 1 : 0, ...at(0) }}
        />
      </div>
    </div>
  );

  /* ------------------------------------------------------- reduced motion */

  if (reduced) {
    // No pin, no scrub, no rAF, no autoplay. The scene becomes what it is
    // describing, read top to bottom: the still at the moment of the clench,
    // all four beats at once, and the entry that came out of it.
    return (
      <section
        id="one-clench"
        aria-labelledby={HEADING_ID}
        className="section bg-ink"
      >
        <div className="shell">
          <h2 id={HEADING_ID} className="t-mono text-fog">
            {oneClench.eyebrow}
          </h2>

          <div className="grid12 pt-12">
            <div className="col-span-12 md:col-span-5">
              {/* The box is the source ratio, so nothing is cropped and the ear
                  coordinates land exactly where they do in the file. */}
              <div className="relative aspect-[9/16] w-full max-w-[380px] overflow-hidden rounded-card bg-slate">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/media/gesture-poster.jpg"
                  alt={oneClench.videoAlt}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div
                  className="pointer-events-none absolute inset-0"
                  aria-hidden="true"
                >
                  {ring}
                </div>
              </div>
            </div>

            <div className="col-span-12 pt-12 md:col-span-7 md:pt-0">
              <ol className="flex flex-col gap-6">
                {oneClench.beats.map((line, i) => (
                  <li key={i} className="t-h2 max-w-[22ch] text-paper">
                    {line}
                  </li>
                ))}
              </ol>
              <div className="pt-12">{card}</div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* --------------------------------------------------------------- render */

  return (
    <section
      ref={sectionRef}
      id="one-clench"
      aria-labelledby={HEADING_ID}
      data-beat-active={beat}
      className="relative bg-ink"
    >
      <div className="relative h-[100svh] min-h-[100svh] w-full overflow-hidden">
        <div className="absolute" style={stageStyle}>
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            poster="/media/gesture-poster.jpg"
            aria-label={oneClench.videoAlt}
            muted
            loop
            playsInline
            preload="metadata"
          >
            <source src="/media/gesture.webm" type="video/webm" />
            <source src="/media/gesture.mp4" type="video/mp4" />
          </video>

          {/* Inside the stage, so the marker is positioned in the video's own
              coordinates and needs no measurement to stay on the ear. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {ring}
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{ background: SCRIM }}
        />

        {/* Persistent. It does not move or change between beats: it is the
            name of the scene, not a caption on one part of it. */}
        <div className="pointer-events-none absolute inset-x-0 top-0">
          <div className="shell pt-[calc(var(--nav-h)+28px)]">
            <h2 id={HEADING_ID} className="t-mono text-fog">
              {oneClench.eyebrow}
            </h2>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="shell pb-[112px] md:pb-20">
            <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between md:gap-16">
              {/* All four beats are always in the DOM and always in the
                  accessibility tree. Only opacity and transform change, so a
                  screen reader gets the whole scene as one ordered list. */}
              <ol className="grid max-w-[21ch] md:max-w-[20ch] lg:max-w-[22ch]">
                {oneClench.beats.map((line, i) => {
                  const active = i === beat;
                  return (
                    <li
                      key={i}
                      className="t-h1 text-paper"
                      style={{
                        gridArea: "1 / 1",
                        fontSize: "clamp(1.75rem, 3.2vw, 3.25rem)",
                      }}
                    >
                      {/* Clip extended below the baseline and pulled back by an
                          equal negative margin, so descenders are not sheared
                          off by the mask. Same trick as .line-mask. */}
                      <span className="mb-[-0.22em] block overflow-hidden pb-[0.22em]">
                        <span
                          className="block"
                          style={{
                            transform: active
                              ? "translateY(0)"
                              : i < beat
                              ? "translateY(calc(-100% - 0.3em))"
                              : "translateY(calc(100% + 0.3em))",
                            opacity: active ? 1 : 0,
                            // The outgoing line clears out fast and the
                            // incoming one waits for it, so two lines are never
                            // half visible in the same box at once.
                            transition: active
                              ? "transform var(--d-base) var(--ease-out-att) var(--d-fast), opacity var(--d-base) var(--ease-out-att) var(--d-fast)"
                              : "transform var(--d-fast) var(--ease-inout-att), opacity var(--d-fast) var(--ease-inout-att)",
                          }}
                        >
                          {line}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div
                className="self-end"
                style={{
                  transform:
                    cardPhase === "out"
                      ? "translateY(32px)"
                      : cardPhase === "in"
                      ? "translateY(0)"
                      : // Settles a little lower and stays there. It is a
                        // record of something that happened, not a toast.
                        "translateY(10px)",
                  opacity: cardPhase === "out" ? 0 : 1,
                  transition:
                    cardPhase === "settled"
                      ? "transform var(--d-slow) var(--ease-inout-att), opacity var(--d-base) var(--ease-out-att)"
                      : "transform var(--d-base) var(--ease-out-att), opacity var(--d-base) var(--ease-out-att)",
                }}
              >
                {card}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
