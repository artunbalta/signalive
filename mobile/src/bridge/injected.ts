import {
  NATIVE_CALL_TIMEOUT_MS,
  NATIVE_CHANNEL,
  NATIVE_ERROR_NAMES,
  NATIVE_GLOBAL,
  NATIVE_PROTOCOL_VERSION,
  NATIVE_READY_EVENT,
  SCAN_MS,
} from "../shared";
import { escapeSeparators } from "./outbox";

export interface InjectedOptions {
  /** The app's origin: the bridge is defined on its pages and nowhere else. */
  origin: string;
  platform: "ios" | "android";
}

/**
 * The script the WebView runs in the page before the page's own scripts (and
 * again after load, where it does nothing if the bridge is there already). It
 * defines window.SignaliveNative (SignaliveNativeApi in the shared module):
 * each call posts one JSON message through window.ReactNativeWebView and
 * returns a promise that the shell's answer settles; events are handed to the
 * listeners registered with ble.onBytes and ble.onState. The shell delivers
 * answers and events by calling SignaliveNative.__receive (not enumerable)
 * with one message or a batch.
 *
 * It is a string, not a function turned into one: Hermes keeps no source for
 * functions. Plain ES2017, no optional chaining, for older WebViews. Every
 * constant comes from the shared module, so a test that runs this script
 * against the shell's own parser keeps the two sides in step.
 */
export function buildInjectedScript(opts: InjectedOptions): string {
  const config = {
    channel: NATIVE_CHANNEL,
    v: NATIVE_PROTOCOL_VERSION,
    global: NATIVE_GLOBAL,
    ready: NATIVE_READY_EVENT,
    origin: opts.origin,
    platform: opts.platform,
    errorNames: NATIVE_ERROR_NAMES,
    timeouts: NATIVE_CALL_TIMEOUT_MS,
    scanDefault: SCAN_MS.default,
    scanMax: SCAN_MS.max,
  };
  const json = escapeSeparators(JSON.stringify(config));
  return `(function () {
  "use strict";
  var C = ${json};
  if (typeof window === "undefined" || window[C.global]) return;
  if (!window.location || window.location.origin !== C.origin) return;

  var nextId = Math.floor(Math.random() * 1000000000) + 1;
  var pending = new Map();
  var listeners = { "ble.bytes": new Set(), "ble.state": new Set() };

  function failure(code, message) {
    var e = new Error(message || code);
    e.name = C.errorNames[code] || "Error";
    e.code = code;
    return e;
  }

  function call(method, params, extraMs) {
    return new Promise(function (resolve, reject) {
      var rn = window.ReactNativeWebView;
      if (!rn || typeof rn.postMessage !== "function") {
        reject(failure("unavailable", "The Signalive app bridge is not available on this page"));
        return;
      }
      var id = nextId++;
      var timer = setTimeout(function () {
        if (pending.delete(id)) reject(failure("timeout", method + " got no answer"));
      }, (C.timeouts[method] || 30000) + (extraMs || 0));
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        rn.postMessage(JSON.stringify({ channel: C.channel, v: C.v, kind: "call", id: id, method: method, params: params === undefined ? {} : params }));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(failure("bad_request", "These params cannot be sent: " + (err && err.message ? err.message : String(err))));
      }
    });
  }

  function nothing() {}

  function report(err) {
    setTimeout(function () { throw err; }, 0);
  }

  function deliver(m, nested) {
    if (!m || typeof m !== "object" || m.channel !== C.channel) return;
    if (m.kind === "batch") {
      if (nested || !Array.isArray(m.messages)) return;
      for (var i = 0; i < m.messages.length; i++) deliver(m.messages[i], true);
      return;
    }
    if (m.kind === "result") {
      var p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok === true) {
        p.resolve(m.value === undefined ? null : m.value);
      } else {
        var e = m.error && typeof m.error === "object" ? m.error : {};
        var code = typeof e.code === "string" && C.errorNames[e.code] ? e.code : "failed";
        p.reject(failure(code, typeof e.message === "string" ? e.message : ""));
      }
      return;
    }
    if (m.kind === "event") {
      var set = listeners[m.event];
      var d = m.data;
      if (!set || !d || typeof d !== "object" || typeof d.id !== "string") return;
      if (m.event === "ble.bytes" && typeof d.bytes !== "string") return;
      if (m.event === "ble.state" && d.state !== "connected" && d.state !== "disconnected") return;
      var event = m.event === "ble.bytes"
        ? { id: d.id, bytes: d.bytes }
        : { id: d.id, state: d.state, reason: typeof d.reason === "string" ? d.reason : null };
      set.forEach(function (fn) {
        try { fn(event); } catch (err) { report(err); }
      });
    }
  }

  function subscribe(name) {
    return function (fn) {
      if (typeof fn !== "function") throw new TypeError(name + " needs a function");
      listeners[name].add(fn);
      return function () { listeners[name].delete(fn); };
    };
  }

  function base64(bytes) {
    if (typeof bytes === "string") return bytes;
    var u;
    if (bytes instanceof Uint8Array) u = bytes;
    else if (bytes instanceof ArrayBuffer || Array.isArray(bytes)) u = new Uint8Array(bytes);
    else throw new TypeError("bytes must be a Uint8Array or base64");
    var s = "";
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }

  var api = {
    version: C.v,
    platform: C.platform,
    info: function () { return call("info", {}); },
    ble: Object.freeze({
      scan: function (timeoutMs) {
        var ms = typeof timeoutMs === "number" && timeoutMs > 0 ? Math.min(timeoutMs, C.scanMax) : C.scanDefault;
        return call("ble.scan", timeoutMs === undefined ? {} : { timeoutMs: timeoutMs }, ms);
      },
      connect: function (id) { return call("ble.connect", { id: id }); },
      disconnect: function (id) { return call("ble.disconnect", { id: id }).then(nothing); },
      write: function (id, bytes) {
        var b;
        try { b = base64(bytes); } catch (err) { return Promise.reject(failure("bad_request", "bytes must be a Uint8Array or base64")); }
        return call("ble.write", { id: id, bytes: b }).then(nothing);
      },
      onBytes: subscribe("ble.bytes"),
      onState: subscribe("ble.state")
    }),
    calendar: Object.freeze({
      addEvent: function (event) { return call("calendar.addEvent", event); },
      addReminder: function (reminder) { return call("calendar.addReminder", reminder); }
    }),
    haptics: Object.freeze({
      impact: function (style) { return call("haptics.impact", style === undefined ? {} : { style: style }).then(nothing); }
    }),
    location: Object.freeze({
      current: function (options) { return call("location.current", options === undefined ? {} : options); }
    })
  };
  Object.defineProperty(api, "__receive", {
    value: function (m) {
      try { deliver(m, false); } catch (err) { report(err); }
    }
  });
  Object.defineProperty(window, C.global, { value: Object.freeze(api), enumerable: true, configurable: false, writable: false });
  try { window.dispatchEvent(new Event(C.ready)); } catch (err) { /* no events here */ }
})();
true;`;
}
