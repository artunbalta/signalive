"use client";

import { useEffect, useRef, useState } from "react";
import { announcement, a11y } from "@/lib/copy";
import { anchored } from "@/lib/trial";

const KEY = "signalive:announcement";

/**
 * The one place on this site where a full amber field is correct: the bar IS
 * the element demanding attention, so the semantic reading of --signal holds.
 * Spec 3.1.
 *
 * Fixed at the very top of the viewport. It owns the height it occupies and
 * publishes it as --bar-now, which is how the nav knows where to sit without
 * the two components having to talk to each other. The measured value matters
 * because the sentence wraps to two lines on narrow screens, where a hard 44px
 * would clip it.
 */
export default function AnnouncementBar({ base = "", here = [] }: { base?: string; here?: readonly string[] } = {}) {
  const barRef = useRef<HTMLDivElement>(null);

  // Rendered on the server and on the first client paint, then removed if this
  // session already dismissed it. Reading sessionStorage during render would
  // produce markup the server cannot match.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === "1") setDismissed(true);
    } catch {
      // Blocked or full storage. The bar simply stays for this session.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (dismissed) {
      root.style.setProperty("--bar-now", "0px");
      return;
    }
    const el = barRef.current;
    if (!el) return;

    const publish = () =>
      root.style.setProperty(
        "--bar-now",
        `${Math.round(el.getBoundingClientRect().height)}px`
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dismissed]);

  // Never leave a stale offset behind if this component ever unmounts.
  useEffect(
    () => () => {
      // removeProperty returns the old value, so it needs a block body: an
      // effect cleanup has to return void, not a string.
      document.documentElement.style.removeProperty("--bar-now");
    },
    []
  );

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      // Dismissal just does not persist. The bar is still gone for this view.
    }
  };

  if (dismissed) return null;

  // The global focus ring is amber, which is invisible against an amber field,
  // so the focused control here also flips to ink. That is an addition to the
  // ring, not a replacement, and amber on the focused chip is the same
  // semantics as everywhere else: this is the element being attended to.
  const focusChip = "focus-visible:bg-ink focus-visible:text-signal";

  return (
    <div
      ref={barRef}
      className="fixed inset-x-0 top-0 z-[120] bg-signal text-ink"
    >
      <div className="t-mono relative flex min-h-[var(--bar-h)] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-12 py-2 text-center">
        <span>{announcement.text}</span>

        <a
          href={anchored("#waitlist", base, here)}
          className={`px-1 underline underline-offset-[3px] transition-opacity duration-[240ms] hover:opacity-70 focus-visible:no-underline ${focusChip}`}
        >
          {announcement.cta}
        </a>

        <button
          type="button"
          onClick={dismiss}
          aria-label={a11y.dismissAnnouncement}
          className={`absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-[2px] transition-opacity duration-[240ms] hover:opacity-70 ${focusChip}`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d="M1 1 L11 11 M11 1 L1 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="square"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
