/** Shared motion constants. Mirrors the CSS custom properties in globals.css. */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.30, 1)";
export const EASE_INOUT = "cubic-bezier(0.76, 0, 0.24, 1)";
export const D_FAST = 240;
export const D_BASE = 600;
export const D_SLOW = 900;

/** GSAP eases, expressed the way gsap wants them. */
export const GSAP_EASE_OUT = "power4.out";
export const GSAP_EASE_INOUT = "power4.inOut";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
