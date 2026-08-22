"use client";

import { useEffect, useRef, ReactNode } from "react";

type Props = {
  href?: string;
  children: ReactNode;
  className?: string;
  /** Magnetic attraction within 60px, capped at 8px. Spec 4.6. */
  magnetic?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
};

/**
 * Primary pill action. Paper on ink, ink text.
 *
 * Deliberately not amber: amber marks what is attended, not what is clickable.
 * Spec 2.2.
 */
export default function CTAButton({
  href,
  children,
  className = "",
  magnetic = false,
  type = "button",
  onClick,
  disabled,
}: Props) {
  const ref = useRef<HTMLAnchorElement & HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !magnetic) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const RADIUS = 60;
    const MAX = 8;
    let raf = 0;
    let tx = 0, ty = 0, cx = 0, cy = 0;

    const tick = () => {
      // Spring-ish damping toward the target offset.
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      el.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist < RADIUS + Math.max(r.width, r.height) / 2) {
        const k = Math.min(1, RADIUS / Math.max(dist, 1));
        tx = Math.max(-MAX, Math.min(MAX, dx * 0.35 * k));
        ty = Math.max(-MAX, Math.min(MAX, dy * 0.35 * k));
      } else {
        tx = 0; ty = 0;
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
      el.style.transform = "";
    };
  }, [magnetic]);

  const cls =
    "inline-flex items-center justify-center rounded-[var(--radius-pill)] " +
    "bg-paper text-ink font-medium px-7 py-3.5 text-[0.9375rem] " +
    "transition-[background-color,transform] duration-[240ms] " +
    "hover:bg-[#EDEDED] active:scale-[0.98] disabled:opacity-50 " +
    "disabled:pointer-events-none will-change-transform " +
    className;

  if (href) {
    return (
      <a ref={ref} href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button ref={ref} type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
