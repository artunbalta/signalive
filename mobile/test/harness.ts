import { BridgeHost } from "../src/bridge/host";
import { buildInjectedScript } from "../src/bridge/injected";
import type { Handlers } from "../src/bridge/router";
import { NativeBridgeError, type SignaliveNativeApi } from "../src/shared";

export const APP_URL = "https://trial.signalive.com/settings";
export const APP_ORIGIN = "https://trial.signalive.com";

/** A page in the WebView, as far as the bridge can tell: a window with ReactNativeWebView on it. */
export interface FakePage {
  window: Record<string, unknown> & { SignaliveNative?: SignaliveNativeApi };
  posted: string[];
  readyEvents: string[];
  /** Runs JavaScript in the page, as WebView.injectJavaScript does. */
  run(js: string): unknown;
  api: SignaliveNativeApi;
}

export function fakePage(opts: { origin?: string; platform?: "ios" | "android"; withBridge?: boolean } = {}): FakePage {
  const posted: string[] = [];
  const readyEvents: string[] = [];
  const window: FakePage["window"] = {
    location: { origin: opts.origin ?? APP_ORIGIN },
    dispatchEvent: (e: Event) => {
      readyEvents.push(e.type);
      return true;
    },
  };
  if (opts.withBridge !== false) window.ReactNativeWebView = { postMessage: (s: string) => posted.push(s) };
  // The script reaches the page through `window` only, so a function of window stands in for the page's realm.
  const run = (js: string) => new Function("window", js)(window);
  run(buildInjectedScript({ origin: APP_ORIGIN, platform: opts.platform ?? "ios" }));
  return {
    window,
    posted,
    readyEvents,
    run,
    get api() {
      return window.SignaliveNative as SignaliveNativeApi;
    },
  };
}

const none = () => {
  throw new NativeBridgeError("unsupported", "not in this test");
};

/** Every method refusing, for tests to override the ones they need. */
export function handlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    info: none,
    "ble.scan": none,
    "ble.connect": none,
    "ble.disconnect": none,
    "ble.write": none,
    "calendar.addEvent": none,
    "calendar.addReminder": none,
    "haptics.impact": none,
    "location.current": none,
    ...overrides,
  };
}

/**
 * A page and the shell joined up, the way the WebView joins them: what the
 * page posts goes to the host (from the app's URL), and what the host injects
 * runs in the page. Events are delivered at once (no batching delay) unless
 * the test asks otherwise.
 */
export function connected(h: Partial<Handlers> = {}, opts: { platform?: "ios" | "android"; auto?: boolean } = {}) {
  const page = fakePage(opts);
  const injected: string[] = [];
  const host = new BridgeHost({
    inject: (js) => {
      injected.push(js);
      page.run(js);
    },
    appOrigin: APP_ORIGIN,
    handlers: handlers(h),
    outbox: { delayMs: 0, schedule: (fn) => queueMicrotask(fn), cancel: () => undefined },
  });
  // Like the WebView: whatever the page posts reaches the shell a moment later, on its own.
  if (opts.auto) {
    page.window.ReactNativeWebView = {
      postMessage: (raw: string) => {
        page.posted.push(raw);
        setTimeout(() => void host.receive(raw, APP_URL), 0);
      },
    };
  }
  let delivered = 0;
  /** Hands everything the page has posted so far to the host, and waits for the answers. */
  const pump = async () => {
    const work: Promise<void>[] = [];
    while (delivered < page.posted.length) work.push(host.receive(page.posted[delivered++], APP_URL));
    await Promise.all(work);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { page, host, injected, pump };
}
