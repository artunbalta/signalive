"use client";

import { useEffect, useRef, useState } from "react";
import { oneClench } from "@/lib/copy";
import {
  CLENCH_TIME,
  CLENCH_LEAD,
  EAR_X,
  EAR_Y,
} from "@/lib/clench";
import { useReducedMotion } from "@/lib/useReducedMotion";

/** Four scroll beats share a portrait film and a fixed editorial column.
 * The registration ring follows the video's coordinates and playback clock.
 * The final beat reveals the calendar entry below the narrative. */

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

export default function OneClench() {
  const reduced = useReducedMotion();

  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);

  const [beat, setBeat] = useState(0);

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

  const cardIn = reduced || beat === 3;
  const card = (
    <div className="clench-calendar" data-visible={cardIn} aria-label={oneClench.cardAlt}>
      <div className="clench-calendar-header"><span className="t-mono">Calendar</span><span className="clench-saved"><span aria-hidden="true">✓</span> Saved</span></div>
      <div className="clench-calendar-body">
        <div className="clench-date"><span className="t-mono">Thu</span><strong>14</strong><span className="t-mono">May</span></div>
        <div className="clench-event"><span className="t-mono">{oneClench.card.time}</span><p>{oneClench.card.title}</p><span className="clench-event-rule" /></div>
      </div>
      <div className="clench-calendar-footer"><span className="clench-confirm-dot" />Captured from your conversation</div>
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
                  coordinates land exactly where they do in the file. Mirrored,
                  like the moving version, so the person looks at the story. */}
              <div className="relative aspect-[9/16] w-full max-w-[380px] -scale-x-100 overflow-hidden rounded-card bg-slate">
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

  return (
    <section ref={sectionRef} id="one-clench" aria-labelledby={HEADING_ID} data-beat-active={beat} className="clench-scene">
      <div className="clench-film" aria-hidden="true">
        <div className="clench-film-stage">
          <video ref={videoRef} poster="/media/gesture-poster.jpg" muted loop playsInline preload="metadata">
            <source src="/media/gesture.webm" type="video/webm" />
            <source src="/media/gesture.mp4" type="video/mp4" />
          </video>
          {ring}
        </div>
        <div className="clench-film-shade" />
        <span className="clench-film-caption t-mono">In the conversation. In the moment.</span>
      </div>
      <div className="shell clench-content">
        <div className="clench-heading"><h2 id={HEADING_ID} className="t-mono">{oneClench.eyebrow}</h2><span className="t-mono text-fog">0{beat + 1} / 04</span></div>
        <div className="clench-story">
          <ol className="clench-beats">
            {oneClench.beats.map((line, i) => (
              <li key={line} aria-hidden={i !== beat} data-active={i === beat}>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          <div className="clench-calendar-slot">{card}</div>
        </div>
        <div className="clench-progress" aria-hidden="true">
          {oneClench.beats.map((_, i) => <span key={i} data-active={i <= beat} />)}
        </div>
      </div>
    </section>
  );
}
