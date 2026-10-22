"use client";

import { useEffect, useState } from "react";
import CTAButton from "@/components/ui/CTAButton";
import { stickyCta } from "@/lib/copy";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * The one persistent action. Spec 3.12.
 *
 * It exists only in the stretch of the page where the waitlist is out of
 * reach: after the hero has left the viewport, and until the waitlist section
 * arrives. Hiding on the waitlist is what keeps it off the form on small
 * screens, where 24px from the bottom would otherwise sit on top of the
 * submit button.
 *
 * This is the sole element on the site allowed a drop shadow, because it
 * floats over content rather than sitting on a surface.
 */
export default function StickyCTA({ heroId = "hero" }: { heroId?: string } = {}) {
  const [heroOut, setHeroOut] = useState(false);
  const [waitlistIn, setWaitlistIn] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const hero = document.getElementById(heroId);
    const waitlist = document.getElementById("waitlist");
    if (!hero && !waitlist) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.target.id === heroId) setHeroOut(!entry.isIntersecting);
          else setWaitlistIn(entry.isIntersecting);
        });
      },
      // Any part of either section counts: the pill should be gone the moment
      // the waitlist starts to appear, not once it is centred.
      { threshold: 0 }
    );
    if (hero) io.observe(hero);
    if (waitlist) io.observe(waitlist);
    return () => io.disconnect();
  }, [heroId]);

  const visible = heroOut && !waitlistIn;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-[90]"
      style={{
        opacity: visible ? 1 : 0,
        // translateX keeps it centred; the 8px lift is the entrance itself.
        transform: `translate(-50%, ${visible || reduced ? "0px" : "8px"})`,
        // visibility, not display, so the hidden pill leaves the tab order and
        // the accessibility tree without losing the transition.
        visibility: visible ? "visible" : "hidden",
        transition: reduced
          ? "none"
          : `opacity var(--d-fast) var(--ease-out-att), transform var(--d-fast) var(--ease-out-att), visibility 0s linear ${visible ? "0s" : "240ms"}`,
      }}
    >
      <CTAButton href="#waitlist" className="shadow-[0_6px_24px_rgba(0,0,0,0.32)]">
        {stickyCta.label}
      </CTAButton>
    </div>
  );
}
