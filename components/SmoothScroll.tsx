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

      /* ---- keeping every pinned section honest about where it starts ----
       *
       * There are three pinned sections, each created in its own effect behind
       * its own dynamic import, and each one inserts a pin spacer that changes
       * the height of the page for everything below it. On top of that the
       * hero video, the lazy carousel images and the webfonts all land after
       * first paint and move things again. A ScrollTrigger that measured its
       * start before any of that has settled pins early, which puts a fixed
       * panel on top of copy that has not scrolled away yet.
       *
       * ScrollTrigger.refresh() remeasures every trigger, so this is the one
       * place that needs to own it. Debounced, because a burst of lazy images
       * would otherwise refresh once per image. */
      let refreshTimer = 0;
      const refresh = () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 150);
      };

      if (document.readyState === "complete") refresh();
      else window.addEventListener("load", refresh, { once: true });

      // Webfonts change the height of every headline on the page.
      document.fonts?.ready.then(refresh).catch(() => {});

      // Anything that changes the document height: a video reaching its poster
      // size, a lazy image arriving, a section revealing.
      const ro = new ResizeObserver(refresh);
      ro.observe(document.body);

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
        window.clearTimeout(refreshTimer);
        ro.disconnect();
        window.removeEventListener("load", refresh);
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
