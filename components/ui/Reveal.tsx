"use client";

import { useEffect, useRef, ReactNode, ElementType } from "react";

type Props = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Delay in ms before this element enters. Spec 4.4 staggers children 60ms. */
  delay?: number;
  /** Stagger direct children instead of revealing the wrapper as one unit. */
  staggerChildren?: number;
  id?: string;
};

/**
 * Scroll reveal. translateY 24px to 0, opacity 0 to 1, triggered at 80% of the
 * viewport, and it runs exactly once. Never replays on scroll back. Spec 4.4.
 *
 * The actual transition lives in globals.css under [data-reveal] so that the
 * reduced motion media query can neutralise it in one place.
 */
export default function Reveal({
  children,
  as: Tag = "div",
  className = "",
  delay = 0,
  staggerChildren,
  id,
}: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const targets: HTMLElement[] =
      staggerChildren != null
        ? (Array.from(el.children) as HTMLElement[])
        : [el];

    targets.forEach((t, i) => {
      t.setAttribute("data-reveal", "");
      const d = delay + (staggerChildren != null ? i * staggerChildren : 0);
      if (d) t.style.setProperty("--reveal-delay", `${d}ms`);
    });

    // Reduced motion: show immediately, observe nothing.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((t) => t.classList.add("is-in"));
      return;
    }

    const show = () => targets.forEach((t) => t.classList.add("is-in"));

    // Anything already on screen at mount reveals straight away. The -20%
    // rootMargin below is there to delay elements that are scrolled INTO view
    // until they are properly on screen, but applied to content that starts in
    // the lower part of the first viewport it waits for a scroll that may never
    // happen, and the element simply stays invisible. The hero CTA sat at
    // opacity 0 for exactly that reason.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) {
      show();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          show();
          io.disconnect();
        });
      },
      // Trigger when the element reaches 80% down the viewport.
      { threshold: 0, rootMargin: "0px 0px -20% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay, staggerChildren]);

  return (
    <Tag ref={ref as never} className={className} id={id}>
      {children}
    </Tag>
  );
}
