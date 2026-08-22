"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { a11y, hero, oneClench } from "@/lib/copy";
import CTAButton from "@/components/ui/CTAButton";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * The audio engine, its analysers and its rAF loop are the heaviest thing on
 * the page and none of it is needed to read the hero. Loading it client side
 * only keeps it out of first paint and out of the server render entirely.
 */
const AttentionDemo = dynamic(() => import("./AttentionDemo"), { ssr: false });

/**
 * Which background video to serve, decided from the viewport rather than from
 * <source media>, which browsers only evaluate once and never re-evaluate.
 *
 *   none   under 600px. Spec 5.1: no video bytes at all, the poster stands in.
 *   small  600 to 899px. The 854 wide encode.
 *   large  900px and up. The full 1280 encode.
 */
type VideoMode = "none" | "small" | "large";

const SOURCES: Record<Exclude<VideoMode, "none">, { webm: string; mp4: string }> = {
  small: { webm: "/media/hero-854.webm", mp4: "/media/hero-854.mp4" },
  large: { webm: "/media/hero.webm", mp4: "/media/hero.mp4" },
};

/**
 * Full bleed opening. Four stacked layers: video, scrim, the signature
 * interaction, copy. Spec 3.3.
 *
 * The h1 and the subhead are ordinary server rendered markup and the poster is
 * a real <img>, so the hero still reads with the video blocked, with the audio
 * refused, and with JavaScript off. Everything below that is enhancement.
 */
export default function Hero() {
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Starts at "none" so the server, and any client without JavaScript, emits
  // no <video> and therefore requests no video bytes.
  const [mode, setMode] = useState<VideoMode>("none");

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 600px)");
    const full = window.matchMedia("(min-width: 900px)");

    const apply = () => {
      setMode(!wide.matches ? "none" : full.matches ? "large" : "small");
    };
    apply();

    // Rotating a tablet crosses both breakpoints, so keep listening.
    wide.addEventListener("change", apply);
    full.addEventListener("change", apply);
    return () => {
      wide.removeEventListener("change", apply);
      full.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // React does not reliably reflect `muted` onto the DOM property, and an
    // unmuted video is refused autoplay by every browser.
    v.muted = true;

    if (reduced) {
      // Reduced motion is allowed to be toggled without a reload, so pausing
      // here matters as much as never setting autoPlay in the first place.
      v.pause();
      return;
    }
    const started = v.play();
    // A refused autoplay is not an error worth surfacing: the poster underneath
    // is the designed fallback and it is already on screen.
    if (started) started.catch(() => {});
  }, [reduced, mode]);

  return (
    <section
      id="hero"
      aria-labelledby="hero-headline"
      className="relative isolate min-h-[100svh] w-full overflow-hidden bg-ink"
    >
      {/* The scroll cue needs real keyframes, which cannot be expressed as a
          Tailwind utility. The reduced motion block is not decoration: without
          it the cue would freeze at scaleY(0) and disappear, because the global
          rule shortens animations rather than removing them. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@keyframes signalive-scroll-cue {
  0%   { transform: scaleY(0); transform-origin: 50% 0%; }
  40%  { transform: scaleY(1); transform-origin: 50% 0%; }
  60%  { transform: scaleY(1); transform-origin: 50% 100%; }
  100% { transform: scaleY(0); transform-origin: 50% 100%; }
}
.hero-scroll-cue {
  transform-origin: 50% 0%;
  animation: signalive-scroll-cue 2s var(--ease-inout-att) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .hero-scroll-cue { animation: none; transform: none; }
}`,
        }}
      />

      {/* Layer 1. Poster first and underneath, so it covers the video's own
          loading gap, the under 600px case and the no JavaScript case with one
          piece of markup. */}
      <div data-intro-fade className="absolute inset-0">
        <img
          src="/media/hero-poster.jpg"
          alt={a11y.heroVideoAlt}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {mode !== "none" && (
          // Remounting on a breakpoint change is what makes the browser pick up
          // the new <source> set; calling load() on the same element would not.
          <video
            key={mode}
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            poster="/media/hero-poster.jpg"
            aria-hidden="true"
            tabIndex={-1}
            muted
            loop
            playsInline
            autoPlay={!reduced}
            preload={reduced ? "none" : "auto"}
            disablePictureInPicture
          >
            <source src={SOURCES[mode].webm} type="video/webm" />
            <source src={SOURCES[mode].mp4} type="video/mp4" />
          </video>
        )}
      </div>

      {/* Layer 2. Transparent at the top, fully ink by 65% down, which is where
          the copy begins. Mixed from the token so there is one ink value. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom," +
            " color-mix(in srgb, var(--color-ink) 0%, transparent) 0%," +
            " color-mix(in srgb, var(--color-ink) 55%, transparent) 42%," +
            " var(--color-ink) 65%)",
        }}
      />

      {/* A short scrim at the top as well as the bottom. The eyebrow sits in the
          first 150px of the frame, which is exactly where the macro shot puts
          its specular highlight, and fog on that highlight is unreadable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[28svh]"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--color-ink) 78%, transparent) 0%," +
            " color-mix(in srgb, var(--color-ink) 40%, transparent) 45%, transparent 100%)",
        }}
      />

      {/* Layers 3 and 4. Bottom aligned, left aligned, never centred. */}
      <div className="relative flex min-h-[100svh] flex-col justify-end pt-[calc(var(--bar-h)+var(--nav-h)+24px)] pb-24 lg:pb-28">
        <div className="shell">
          {/* Names the second channel before the headline names the first, so a
              visitor who never scrolls has still met both. Not decoration: the
              mandated subhead calls the gesture "a movement nobody sees", so
              without this the word "clench" is absent from the first viewport.
              The string is the next section's own eyebrow, nothing invented. */}
          <Reveal as="p" className="t-mono mb-6 text-mist">
            {oneClench.eyebrow}
          </Reveal>

          {/* The only h1 on the page. */}
          <MaskHeadline
            as="h1"
            id="hero-headline"
            lines={hero.headlineLines}
            className="t-hero max-w-[19ch] text-paper"
          />

          <div className="grid12 mt-10 items-end gap-y-12 lg:mt-12">
            <div className="col-span-12 lg:col-span-6">
              <Reveal as="p" delay={160} className="t-lead max-w-[52ch] text-mist">
                {hero.subhead}
              </Reveal>

              <Reveal delay={280} className="mt-9">
                <CTAButton href="#waitlist" magnetic>
                  {hero.cta}
                </CTAButton>
              </Reveal>
            </div>

            {/* The interaction lands in the lower third, to the right of the
                copy on wide screens and directly under it when stacked. It
                enters last in the load sequence. */}
            <Reveal delay={440} className="col-span-12 lg:col-span-5 lg:col-start-8">
              {/* The caption lives inside AttentionDemo, next to the control
                  it describes and worded for the active interaction mode. */}
              <AttentionDemo />
            </Reveal>
          </div>
        </div>
      </div>

      {/* Amber is legitimate here: it marks the live scroll affordance. */}
      <div
        aria-hidden="true"
        data-intro-fade
        className="pointer-events-none absolute bottom-8 left-1/2 h-12 w-px -translate-x-1/2"
      >
        <span className="hero-scroll-cue block h-full w-full bg-signal" />
      </div>
    </section>
  );
}
