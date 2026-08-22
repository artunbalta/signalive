"use client";
import { useEffect, useState } from "react";

/**
 * Tracks prefers-reduced-motion and keeps tracking it, because users toggle it
 * without reloading. Returns false on the server so markup matches first paint.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return reduced;
}
