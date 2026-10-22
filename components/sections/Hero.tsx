"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hero, oneClench } from "@/lib/copy";
import CTAButton from "@/components/ui/CTAButton";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * The room (WebGL, its voices and its loop) is the heaviest thing on the page
 * and none of it is needed to read the hero. Loading it client side only
 * keeps it out of first paint and out of the server render entirely.
 */
const FocusRoom = dynamic(() => import("@/components/focus-room/FocusRoom"), { ssr: false });

/**
 * Full bleed opening: the copy, and the Focus room beside it. Three people
 * talk around you and the one you turn to comes forward, which is the
 * headline, shown. On wide screens the copy holds the left half, over the
 * earbud macro loop, and the room the right; stacked, the room sits between
 * the headline and the rest, and there is no video at all.
 *
 * The h1 and the subhead are ordinary server rendered markup, and the room's
 * slot has its size before the room loads, so the hero reads, and nothing
 * moves, with the room refused or JavaScript off.
 */
export default function Hero() {
  const [section, setSection] = useState<HTMLElement | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);

  // The loop is only fetched where it is shown, and never plays for someone
  // who asked for less motion. React does not reliably reflect `muted`, and
  // an unmuted video is refused autoplay, so it is set here too.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (reduced || !matchMedia("(min-width: 1024px)").matches) return v.pause();
    v.muted = true;
    v.play().catch(() => {});
  }, [reduced]);

  return (
    <section
      ref={setSection}
      id="hero"
      aria-labelledby="hero-headline"
      className="relative isolate min-h-[100svh] w-full overflow-hidden bg-ink"
    >
      {/* The earbud, in the corner the copy leaves free, fading out before the
          room and the headline. */}
      <div aria-hidden="true" data-intro-fade className="hero-backdrop">
        <video ref={video} muted loop playsInline preload="none" tabIndex={-1} disablePictureInPicture>
          <source src="/media/hero.webm" type="video/webm" />
          <source src="/media/hero.mp4" type="video/mp4" />
        </video>
      </div>

      {section && slot ? <FocusRoom hero={section} slot={slot} /> : null}

      <div className="relative z-10 flex min-h-[100svh] flex-col pt-[calc(var(--bar-h)+var(--nav-h)+24px)] pb-20 lg:pb-16">
        <div className="shell grid flex-1 grid-cols-1 lg:grid-cols-12 lg:grid-rows-[1fr_auto] lg:gap-x-6">
          {/* Names the second channel before the headline names the first, so a
              visitor who never scrolls has still met both. The string is the
              next section's own eyebrow, nothing invented. */}
          <div className="lg:col-span-6 lg:row-start-1 lg:self-end">
            <Reveal as="p" className="t-mono mb-6 text-mist">
              {oneClench.eyebrow}
            </Reveal>

            {/* The only h1 on the page. */}
            <MaskHeadline
              as="h1"
              id="hero-headline"
              lines={hero.headlineLines}
              className="hero-headline t-hero max-w-[19ch] text-paper"
            />
          </div>

          {/* The room's slot. Sized here, not by the room, so its arrival
              moves nothing; a drag across it turns your head. */}
          <div
            ref={setSlot}
            className="relative mt-6 h-[min(150vw,620px)] touch-pan-y lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:h-auto"
          />

          <div className="mt-10 lg:col-span-6 lg:row-start-2 lg:mt-10">
            <Reveal as="p" delay={160} className="t-lead max-w-[44ch] text-mist">
              {hero.subhead}
            </Reveal>

            <Reveal delay={280} className="mt-9">
              <CTAButton href="#waitlist" magnetic>
                {hero.cta}
              </CTAButton>
            </Reveal>
          </div>
        </div>
      </div>

      {/* Amber is legitimate here: it marks the live scroll affordance. */}
      <div
        aria-hidden="true"
        data-intro-fade
        className="pointer-events-none absolute bottom-6 left-1/2 h-12 w-px -translate-x-1/2 lg:left-[calc(50%-12px)]"
      >
        <span className="hero-scroll-cue block h-full w-full bg-signal" />
      </div>
    </section>
  );
}
