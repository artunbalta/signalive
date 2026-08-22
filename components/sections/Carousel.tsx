"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { useCases } from "@/lib/copy";
import { useReducedMotion } from "@/lib/useReducedMotion";

const HEADING_ID = "use-cases-title";

/** Must match the flex gap on the track. Used by the throw clamp and by the
 *  trailing spacer, which sits one gap away from the last card. */
const GAP = 24;

/** A release velocity is projected this far into the future to choose the
 *  card the flick lands on. */
const THROW_MS = 140;

/** Cap the projection so a hard flick never skips the whole set. */
const THROW_CARDS = 1.6;

/** Snapping stays off until a programmatic scroll has settled, otherwise the
 *  browser re-snaps mid flight and cancels the throw. */
const SETTLE_MS = 620;

const clamp = (n: number, min: number, max: number) =>
  n < min ? min : n > max ? max : n;

function Chevron({ back }: { back: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={back ? "M15 5 8 12l7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

/**
 * Use cases carousel.
 *
 * The centred card is the attended one: full opacity plus a one pixel amber
 * hairline on its top edge. Everything else sits back at 55 percent with no
 * amber at all. That is the palette doing structural work rather than
 * decoration, and it is the only amber in this section apart from the global
 * focus ring.
 *
 * Which card is centred is measured from the track's real scroll position on
 * every frame that scrolls, so it stays correct during a drag, a keyboard
 * step, a native touch flick and a resize.
 */
export default function Carousel() {
  const reduced = useReducedMotion();
  const cards = useCases.cards;
  const last = cards.length - 1;

  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [active, setActive] = useState(0);
  /** Read by listeners that must not close over a stale render. */
  const activeRef = useRef(0);

  /** Only one card is expanded at a time. Attention is singular here too, and
   *  two open panels in view read as noise. */
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const rafRef = useRef(0);
  const settleRef = useRef(0);
  const drag = useRef({
    active: false,
    startX: 0,
    startScroll: 0,
    lastT: 0,
    v: 0,
  });

  /**
   * Distance in pixels from a card centre to the focal slot: the first card
   * position, one gutter in from the left edge of the track. Everything else
   * (which card is attended, where an arrow scrolls to, where a flick lands)
   * is expressed against this one reference, so moving it moves all of them
   * together.
   */
  const focusX = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    const tr = track.getBoundingClientRect();
    const list = track.firstElementChild as HTMLElement | null;
    const lead = list
      ? parseFloat(getComputedStyle(list).paddingInlineStart) || 0
      : 0;
    const cardW = cardRefs.current[0]?.offsetWidth ?? 320;
    return tr.left + lead + cardW / 2;
  }, []);

  const offsetFromCentre = useCallback(
    (el: HTMLElement) => {
      const cr = el.getBoundingClientRect();
      return cr.left + cr.width / 2 - focusX();
    },
    [focusX]
  );

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (track) {
      const maxScroll = track.scrollWidth - track.clientWidth;
      // Once the track is against its end stop, the last card is as far
      // forward as it will ever get, so it is the attended one.
      if (maxScroll > 0 && track.scrollLeft >= maxScroll - 2) {
        activeRef.current = last;
        setActive((prev) => (prev === last ? prev : last));
        return;
      }
    }
    let best = 0;
    let bestDistance = Infinity;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const d = Math.abs(offsetFromCentre(el));
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    activeRef.current = best;
    setActive((prev) => (prev === best ? prev : best));
  }, [offsetFromCentre, last]);

  const scrollToIndex = useCallback(
    (index: number, smooth = true) => {
      const track = trackRef.current;
      const target = clamp(index, 0, last);
      const el = cardRefs.current[target];
      if (!track || !el) return;
      // Claimed up front so a second key press steps on from the requested
      // card rather than from the one still passing through the centre.
      activeRef.current = target;
      const maxScroll = track.scrollWidth - track.clientWidth;
      track.scrollTo({
        left: Math.min(track.scrollLeft + offsetFromCentre(el), Math.max(0, maxScroll)),
        // The CSS reduced motion block cannot reach a scrollTo option, so the
        // behaviour is chosen here instead.
        behavior: smooth && !reduced ? "smooth" : "auto",
      });
    },
    [last, offsetFromCentre, reduced]
  );

  /* Scroll and resize both feed the same measurement, throttled to one frame. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        measure();
      });
    };

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        // Card width is viewport derived, so keep the attended card centred
        // rather than letting the layout slide out from under it.
        scrollToIndex(activeRef.current, false);
        measure();
      }, 120);
    };

    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    const first = requestAnimationFrame(measure);

    return () => {
      track.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
      cancelAnimationFrame(first);
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(settleRef.current);
    };
  }, [measure, scrollToIndex]);

  /* ----------------------------------------------------------------------
     Pointer drag. Mouse only: touch already has native momentum and snapping,
     and taking it over makes the carousel worse on the devices that need it
     most.
     ---------------------------------------------------------------------- */

  const setSnapping = (on: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    // Empty string hands the property back to the utility class.
    track.style.scrollSnapType = on ? "" : "none";
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    // A press that starts on the expand control belongs to that control.
    if ((e.target as HTMLElement).closest("button")) return;
    const track = trackRef.current;
    if (!track) return;

    track.setPointerCapture(e.pointerId);
    window.clearTimeout(settleRef.current);
    setSnapping(false);
    drag.current = {
      active: true,
      startX: e.clientX,
      startScroll: track.scrollLeft,
      lastT: performance.now(),
      v: 0,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const track = trackRef.current;
    if (!d.active || !track) return;

    const before = track.scrollLeft;
    track.scrollLeft = d.startScroll - (e.clientX - d.startX);

    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) {
      // Smoothed so one stuttering frame cannot define the throw.
      d.v = d.v * 0.7 + ((track.scrollLeft - before) / dt) * 0.3;
      d.lastT = now;
    }
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const track = trackRef.current;
    if (!d.active || !track) return;
    d.active = false;
    if (track.hasPointerCapture(e.pointerId)) {
      track.releasePointerCapture(e.pointerId);
    }

    const width = cardRefs.current[0]?.offsetWidth ?? 320;
    const step = width + GAP;
    const throwPx = clamp(
      d.v * THROW_MS,
      -step * THROW_CARDS,
      step * THROW_CARDS
    );

    // Where the flick would come to rest, expressed as a card index, measured
    // against the same focal slot the arrows and the active state use.
    const trackLeft = track.getBoundingClientRect().left;
    const projected = track.scrollLeft + throwPx + (focusX() - trackLeft);
    const trackRect = track.getBoundingClientRect();
    let target = 0;
    let bestDistance = Infinity;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const contentCentre =
        r.left - trackRect.left + track.scrollLeft + r.width / 2;
      const dist = Math.abs(contentCentre - projected);
      if (dist < bestDistance) {
        bestDistance = dist;
        target = i;
      }
    });

    scrollToIndex(target);
    settleRef.current = window.setTimeout(
      () => setSnapping(true),
      reduced ? 60 : SETTLE_MS
    );
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = activeRef.current;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      scrollToIndex(current + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrollToIndex(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      scrollToIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      scrollToIndex(last);
    }
  };

  const toggle = (i: number) => {
    setOpenIndex((prev) => (prev === i ? null : i));
    // Expanding a card is a request to attend to it, so it comes to centre.
    if (openIndex !== i) scrollToIndex(i);
  };

  const controlClass =
    "inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center " +
    "rounded-pill border border-hairline bg-paper text-ink " +
    "transition-[background-color,opacity] duration-[240ms] " +
    "[transition-timing-function:var(--ease-out-att)] hover:bg-[#F2F2F2] " +
    "disabled:cursor-default disabled:opacity-30";

  return (
    <section
      id="use-cases"
      aria-labelledby={HEADING_ID}
      className="section surface-paper bg-paper text-ink"
      style={
        {
          // The first card sits on the page gutter, aligned with the headline
          // above it, which is the Whoop pattern. The focal slot is the first
          // card position rather than the middle of the viewport. The track
          // ends on the gutter: padding it out far enough for the last card to
          // physically reach the focal slot left almost a screen of empty page
          // after card four, so the end of the track is handled in script.
          "--card-w": "min(78vw, 380px)",
          "--edge": "var(--gutter)",
          "--tail": "var(--gutter)",
        } as CSSProperties
      }
    >
      <div className="shell">
        <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
          <div>
            <Reveal>
              <p className="t-mono text-fog">{useCases.eyebrow}</p>
            </Reveal>
            <MaskHeadline
              as="h2"
              id={HEADING_ID}
              lines={[useCases.headline]}
              className="t-h1 mt-5 max-w-[15ch]"
            />
          </div>

          <div className="flex shrink-0 gap-3">
            <button
              type="button"
              aria-label={useCases.prev}
              aria-controls="use-cases-track"
              disabled={active === 0}
              onClick={() => scrollToIndex(active - 1)}
              className={controlClass}
            >
              <Chevron back />
            </button>
            <button
              type="button"
              aria-label={useCases.next}
              aria-controls="use-cases-track"
              disabled={active === last}
              onClick={() => scrollToIndex(active + 1)}
              className={controlClass}
            >
              <Chevron back={false} />
            </button>
          </div>
        </div>
      </div>

      <Reveal className="mt-14 md:mt-20">
        <div
          id="use-cases-track"
          ref={trackRef}
          role="region"
          aria-roledescription="carousel"
          aria-labelledby={HEADING_ID}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          // Lenis swallows wheel events on the window, which would otherwise
          // make a trackpad swipe across this track do nothing.
          data-lenis-prevent-wheel
          className={
            "w-full cursor-grab select-none overflow-x-auto overscroll-x-contain " +
            "snap-x snap-mandatory active:cursor-grabbing " +
            "[scroll-padding-inline-start:var(--gutter)] " +
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          }
        >
          <ul
            role="list"
            className={
              "m-0 flex list-none items-start gap-6 " +
              "ps-[var(--edge)] " +
              // A flex container's trailing padding is not part of its
              // scrollable overflow, so the end space has to be a real box.
              "after:h-px after:shrink-0 after:content-[''] " +
              "after:w-[max(0px,calc(var(--tail)_-_24px))]"
            }
          >
            {cards.map((card, i) => {
              const isActive = i === active;
              const open = openIndex === i;
              const panelId = `use-case-body-${i}`;
              const small = card.image.replace(/\.webp$/, "-800.webp");

              return (
                <li
                  key={card.kicker}
                  ref={(el) => {
                    cardRefs.current[i] = el;
                  }}
                  style={{ opacity: isActive ? 1 : 0.55 }}
                  className={
                    "relative aspect-[4/5] w-[var(--card-w)] shrink-0 snap-start " +
                    "overflow-hidden rounded-card bg-ink " +
                    "transition-opacity duration-[240ms] " +
                    "[transition-timing-function:var(--ease-out-att)]"
                  }
                >
                  <img
                    src={card.image}
                    srcSet={`${small} 800w, ${card.image} 1600w`}
                    sizes="(max-width: 487px) 78vw, 380px"
                    width={1600}
                    height={2000}
                    alt={card.alt}
                    loading={i === 0 ? "eager" : "lazy"}
                    decoding="async"
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover"
                  />

                  {/* Scrim, dark at both ends so the overlaid text holds up
                      against any part of the photograph. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(to bottom, rgba(11,11,12,0.62) 0%, rgba(11,11,12,0.14) 34%, rgba(11,11,12,0.10) 52%, rgba(11,11,12,0.82) 100%)",
                    }}
                  />
                  {/* Second layer, faded in only while the body is showing. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 transition-opacity duration-[240ms] [transition-timing-function:var(--ease-out-att)]"
                    style={{
                      opacity: open ? 1 : 0,
                      background:
                        "linear-gradient(to top, rgba(11,11,12,0.88) 0%, rgba(11,11,12,0.45) 55%, rgba(11,11,12,0) 100%)",
                    }}
                  />

                  {/* Amber marks the attended card and nothing else. */}
                  <span
                    aria-hidden="true"
                    style={{ opacity: isActive ? 1 : 0 }}
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-signal transition-opacity duration-[240ms] [transition-timing-function:var(--ease-out-att)]"
                  />

                  <div className="absolute inset-0 flex flex-col p-6">
                    <div>
                      <p className="t-mono text-paper">{card.kicker}</p>
                      <h3 className="t-h2 mt-3 text-paper">{card.title}</h3>
                    </div>

                    <div className="mt-auto flex items-end gap-4">
                      <div
                        id={panelId}
                        aria-hidden={!open}
                        style={{ opacity: open ? 1 : 0 }}
                        className={
                          "min-w-0 flex-1 transition-[opacity,transform] duration-[240ms] " +
                          "[transition-timing-function:var(--ease-out-att)] " +
                          (open ? "translate-y-0" : "pointer-events-none translate-y-2")
                        }
                      >
                        {/* Paper, not mist: inside a paper section the mist
                            token resolves dark, which would vanish here. */}
                        <p className="text-small text-paper">{card.body}</p>
                      </div>

                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        aria-label={open ? useCases.collapse : useCases.expand}
                        onClick={() => toggle(i)}
                        style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
                        className={
                          "relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center " +
                          "justify-center rounded-pill bg-paper text-ink " +
                          "transition-transform duration-[240ms] " +
                          "[transition-timing-function:var(--ease-out-att)] hover:bg-[#F2F2F2]"
                        }
                      >
                        <span aria-hidden="true" className="absolute h-[1.5px] w-[15px] bg-ink" />
                        <span aria-hidden="true" className="absolute h-[15px] w-[1.5px] bg-ink" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Reveal>
    </section>
  );
}
