"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Lenis smooth scroll, synced to the GSAP ticker so ScrollTrigger stays
 * accurate. Spec 4.2.
 *
 * Disabled entirely under prefers-reduced-motion (spec 4.8), in which case the
 * browser's native scrolling is left alone.
 */
export default function SmoothScroll() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let destroy = () => {};
    let cancelled = false;

    (async () => {
      const [{ default: Lenis }, { gsap }, { ScrollTrigger }] = await Promise.all([
        import("lenis"),
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled) return;

      gsap.registerPlugin(ScrollTrigger);

      const lenis = new Lenis({
        lerp: 0.09,
        duration: 1.2,
        smoothWheel: true,
        syncTouch: false, // native momentum is better on iOS
      });

      lenis.on("scroll", ScrollTrigger.update);

      const raf = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);

      // Anchor links have to go through Lenis or they fight it.
      const onClick = (e: MouseEvent) => {
        const el = (e.target as HTMLElement)?.closest?.('a[href^="#"]');
        if (!el) return;
        const id = el.getAttribute("href");
        if (!id || id === "#") return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target as HTMLElement, { offset: -72 });
      };
      document.addEventListener("click", onClick);

      destroy = () => {
        document.removeEventListener("click", onClick);
        gsap.ticker.remove(raf);
        lenis.destroy();
      };
    })();

    return () => {
      cancelled = true;
      destroy();
    };
  }, [pathname]);

  return null;
}
