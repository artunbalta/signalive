"use client";

import { useEffect, useRef, useState } from "react";
import { nav } from "@/lib/copy";

/**
 * The orchestrated page load. One sequence, not scattered effects. Spec 4.7.
 *
 *   0ms    ink screen, wordmark centred
 *   300ms  wordmark travels to the nav position (700ms)
 *   1000ms data-intro is released: the hero video fades up, the headline lines
 *          mask in staggered, and the signature interaction follows last
 *
 * Total is comfortably under 2.5s.
 *
 * The holding of the hero content is done in CSS via html[data-intro] rather
 * than by prop drilling, so sections stay independent of this component. The
 * attribute is set by an inline script in the document head so there is no
 * flash of revealed content before hydration.
 */
export default function PageLoader() {
  // Only render the overlay if the inline script decided the intro should run.
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<"hold" | "travel" | "done">("hold");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-intro")) return;
    setActive(true);

    const release = () => {
      root.removeAttribute("data-intro");
      try {
        sessionStorage.setItem("signalive:seen-intro", "1");
      } catch {
        // Private mode or blocked storage. The intro simply runs again.
      }
    };

    const t = timers.current;
    t.push(window.setTimeout(() => setPhase("travel"), 300));
    t.push(
      window.setTimeout(() => {
        release();
        setPhase("done");
      }, 1000)
    );
    // Remove the overlay from the tree once it has finished fading.
    t.push(window.setTimeout(() => setActive(false), 1950));

    return () => {
      t.forEach(clearTimeout);
      timers.current = [];
      // If we unmount mid sequence, never leave the page held hidden.
      root.removeAttribute("data-intro");
    };
  }, []);

  if (!active) return null;

  // The nav wordmark sits centred, vertically inside the 72px bar that follows
  // the 44px announcement bar. Measured against those tokens rather than
  // querying the nav, so the loader does not depend on the nav being mounted.
  const NAV_CENTRE_Y = 44 + 72 / 2;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[300] pointer-events-none"
      style={{
        background: "var(--color-ink)",
        opacity: phase === "done" ? 0 : 1,
        transition: "opacity 900ms var(--ease-out-att)",
      }}
    >
      {/* Travels from the optical centre of the screen up to the nav slot,
          shrinking to the size the nav renders it at so the handoff between
          the loader and the bar is invisible. */}
      <img
        src="/media/wordmark-light.png"
        alt=""
        width={900}
        height={77}
        draggable={false}
        className="absolute left-1/2 w-auto select-none"
        style={{
          top: phase === "hold" ? "50%" : `${NAV_CENTRE_Y}px`,
          height: phase === "hold" ? "clamp(18px, 4vw, 30px)" : "15px",
          transform: "translate(-50%, -50%)",
          transition:
            "top 700ms var(--ease-inout-att), height 700ms var(--ease-inout-att)",
        }}
      />
    </div>
  );
}
