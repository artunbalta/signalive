"use client";

import { useEffect } from "react";
import { listenForInstall } from "./install";

/**
 * Registers the service worker (public/sw.js) in production builds, and
 * starts listening for the browser's install offer. During development the
 * worker would hold on to files the dev server keeps changing, so any worker
 * left on this origin is removed instead.
 */
export function PwaRegister() {
  useEffect(() => {
    listenForInstall();
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
      return;
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
