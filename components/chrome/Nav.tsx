"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nav, a11y } from "@/lib/copy";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { anchored } from "@/lib/trial";

/**
 * Fixed chrome. Spec 3.2.
 *
 * Sits directly under the announcement bar by reading --bar-now, the height
 * that bar publishes for itself, falling back to the --bar-h token before the
 * bar has measured. Solid ink over the hero, then 12px blur over a translucent
 * ink once the hero has left the viewport, so the wordmark stays readable
 * against whatever section is passing behind it.
 *
 * The overlay menu lives inside this header so that one focus trap covers both
 * the menu and the hamburger that closes it.
 */
export default function Nav({ base = "" }: { base?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reduced = useReducedMotion();

  const headerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  /* --- Past the hero? ---------------------------------------------------- */
  useEffect(() => {
    const hero = document.getElementById("hero");
    if (hero) {
      const io = new IntersectionObserver(
        ([entry]) => setScrolled(!entry.isIntersecting),
        { threshold: 0 }
      );
      io.observe(hero);
      return () => io.disconnect();
    }
    // Defensive fallback if the hero is ever not on the page.
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* --- Scroll lock while the menu is open -------------------------------- */
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const body = document.body;

    // Measure the classic scrollbar before removing it, then hold that width
    // as padding so neither the page nor the fixed chrome shifts sideways.
    // Zero on overlay scrollbar platforms, so this costs nothing there.
    const pad = window.innerWidth - root.clientWidth;
    const prevOverflow = root.style.overflow;
    const prevPad = body.style.paddingRight;

    root.style.setProperty("--lock-pad", `${pad}px`);
    root.style.overflow = "hidden";
    body.style.paddingRight = `${pad}px`;

    return () => {
      root.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
      root.style.removeProperty("--lock-pad");
    };
  }, [open]);

  /* --- Everything outside the menu is inert while it is open ------------- */
  useEffect(() => {
    if (!open) return;
    const header = headerRef.current;
    const others = Array.from(document.body.children).filter(
      (el) => el !== header
    );
    others.forEach((el) => el.setAttribute("inert", ""));
    return () => others.forEach((el) => el.removeAttribute("inert"));
  }, [open]);

  /* --- Focus: into the menu on open, back to the hamburger on close ------ */
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      overlayRef.current
        ?.querySelector<HTMLElement>("a[href]")
        ?.focus({ preventScroll: true });
    } else if (wasOpen.current) {
      wasOpen.current = false;
      buttonRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  /* --- Escape, and a Tab cycle that cannot leave the header -------------- */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;

      const root = headerRef.current;
      if (!root) return;
      // getClientRects rather than offsetParent: these controls are inside a
      // fixed overlay, where offsetParent is always null.
      const items = Array.from(
        root.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")
      ).filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;

      const i = items.indexOf(document.activeElement as HTMLElement);
      if (i === -1) {
        e.preventDefault();
        items[0].focus();
      } else if (e.shiftKey && i === 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const FAST = "var(--d-fast) var(--ease-out-att)";
  // visibility flips instantly on open and waits for the fade on close, which
  // is what keeps the closed menu out of the tab order without killing the
  // exit transition.
  const overlayTransition = reduced
    ? "none"
    : `opacity var(--d-fast) var(--ease-out-att), visibility 0s linear ${open ? "0s" : "240ms"}`;

  // data-lenis-prevent: Lenis reads wheel and touch from the window, so
  // overflow:hidden alone would not stop it. This makes it ignore the menu.
  return (
    <header
      ref={headerRef}
      data-lenis-prevent={open ? "" : undefined}
      className="fixed inset-x-0 z-[150]"
      style={{
        top: "var(--bar-now, var(--bar-h))",
        height: "var(--nav-h)",
        paddingRight: "var(--lock-pad, 0px)",
        transition: `top ${FAST}`,
      }}
    >
      {/* Overlay first in the DOM so the bar paints over it. */}
      <div
        id="nav-menu"
        ref={overlayRef}
        aria-hidden={!open}
        className="fixed inset-0 bg-ink"
        style={{
          opacity: open ? 1 : 0,
          visibility: open ? "visible" : "hidden",
          paddingRight: "var(--lock-pad, 0px)",
          transition: overlayTransition,
        }}
      >
        <nav className="shell flex h-full flex-col justify-center gap-3 pb-[10vh] pt-[calc(var(--bar-h)_+_var(--nav-h))]">
          {nav.links.map((link, i) => (
            <a
              key={link.href}
              href={anchored(link.href, base)}
              onClick={close}
              className="t-h2 text-paper w-fit py-1 transition-opacity duration-[240ms] hover:opacity-60"
            >
              {/* Entrance lives on an inner span so the anchor keeps its own
                  hover and focus states free of inline overrides. */}
              <span
                className="block"
                style={
                  reduced
                    ? undefined
                    : {
                        opacity: open ? 1 : 0,
                        transform: open ? "none" : "translateY(16px)",
                        // 600ms in, 240ms out so the exit never outlasts the
                        // overlay fade underneath it.
                        transition: open
                          ? "opacity var(--d-base) var(--ease-out-att), transform var(--d-base) var(--ease-out-att)"
                          : "opacity var(--d-fast) var(--ease-out-att), transform var(--d-fast) var(--ease-out-att)",
                        // 40ms apart on the way in (spec 3.2), together on the
                        // way out.
                        transitionDelay: open ? `${i * 40}ms` : "0ms",
                      }
                }
              >
                {link.label}
              </span>
            </a>
          ))}
        </nav>
      </div>

      <div
        className="relative z-10 h-full"
        style={{
          backgroundColor:
            scrolled && !open
              ? "color-mix(in srgb, var(--color-ink) 72%, transparent)"
              : "var(--color-ink)",
          backdropFilter: scrolled && !open ? "blur(12px)" : undefined,
          WebkitBackdropFilter: scrolled && !open ? "blur(12px)" : undefined,
          borderBottom: `1px solid ${scrolled && !open ? "var(--hairline)" : "transparent"}`,
          transition: `background-color ${FAST}, border-color ${FAST}`,
        }}
      >
        <div className="shell relative flex h-full items-center justify-end">
          {/* Centred on the viewport, matching where the loader parks the
              wordmark so the handoff between the two is seamless. */}
          {/* The drawn wordmark, light variant, since this bar is always ink.
              Height is fixed and width follows, so the 900x77 artwork never
              shifts the bar. */}
          <img
            src="/media/wordmark-light.png"
            alt={nav.wordmark}
            width={900}
            height={77}
            className="absolute left-1/2 h-[15px] w-auto -translate-x-1/2 select-none"
            draggable={false}
          />

          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="nav-menu"
            aria-label={open ? a11y.closeMenu : a11y.openMenu}
            className="relative -mr-3 grid h-11 w-11 place-items-center"
          >
            {/* Three 1px lines, 20px wide, that become a close mark. */}
            {[0, 1, 2].map((n) => (
              <span
                key={n}
                aria-hidden="true"
                className="bg-paper absolute h-px w-5"
                style={{
                  opacity: open && n === 1 ? 0 : 1,
                  transform: open
                    ? n === 1
                      ? "none"
                      : `rotate(${n === 0 ? 45 : -45}deg)`
                    : `translateY(${(n - 1) * 6}px)`,
                  transition: `transform ${FAST}, opacity ${FAST}`,
                }}
              />
            ))}
          </button>
        </div>
      </div>
    </header>
  );
}
