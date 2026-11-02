"use client";

import { createStore } from "@/lib/client/store";

/**
 * Whether the app can be installed here, and whether it already is. Chrome,
 * Edge and Android hand the page a beforeinstallprompt event to keep for a
 * button; Safari has no such event (its Share menu adds to the home screen),
 * so iOS gets words instead of a button.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  /** The browser offered to install; the Install button uses it once. */
  prompt: BeforeInstallPromptEvent | null;
  /** Running as the installed app, or installed during this visit. */
  installed: boolean;
}

export const installState = createStore<InstallState>({ prompt: null, installed: false });

let listening = false;

/** Starts listening for the browser's offer; as early as possible, since it comes once per page load. */
export function listenForInstall() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) installState.set({ installed: true });
  window.addEventListener("beforeinstallprompt", (e) => {
    // Kept for the Install button in Settings instead of the browser's own banner.
    e.preventDefault();
    installState.set({ prompt: e as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => installState.set({ installed: true, prompt: null }));
}

/** Shows the browser's install dialog; resolves true when the wearer installed. */
export async function promptInstall(): Promise<boolean> {
  const p = installState.get().prompt;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  // The event can be used once either way.
  installState.set({ prompt: null, installed: outcome === "accepted" || installState.get().installed });
  return outcome === "accepted";
}
