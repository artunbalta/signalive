import { describe, expect, it } from "vitest";
import { DEFAULT_APP_URL, resolveAppTarget } from "../src/config";
import { decideNavigation, isAppUrl, isIgnorableLoadError, originOf, schemeOf } from "../src/shell/navigation";

const APP = "https://trial.signalive.com";

describe("originOf", () => {
  it("normalizes what a WebView reports", () => {
    expect(originOf("https://trial.signalive.com/settings?x=1#y")).toBe(APP);
    expect(originOf("HTTPS://Trial.Signalive.COM:443/")).toBe(APP);
    expect(originOf("https://user:pw@trial.signalive.com/")).toBe(APP);
    expect(originOf("http://192.168.1.20:3000/")).toBe("http://192.168.1.20:3000");
    expect(originOf("http://localhost:80")).toBe("http://localhost");
    expect(originOf("https://trial.signalive.com:8443/")).toBe("https://trial.signalive.com:8443");
    expect(originOf("https://[::1]:3000/x")).toBe("https://[::1]:3000");
    for (const none of ["about:blank", "data:text/html,hi", "blob:https://trial.signalive.com/123", "mailto:a@b.c", "", "trial.signalive.com", "https://"]) {
      expect(originOf(none)).toBeNull();
    }
  });

  it("tells the app's own pages apart", () => {
    expect(isAppUrl("https://trial.signalive.com/", APP)).toBe(true);
    expect(isAppUrl("https://trial.signalive.com.evil.example/", APP)).toBe(false);
    expect(isAppUrl("https://evil.example/?https://trial.signalive.com", APP)).toBe(false);
    expect(isAppUrl(undefined, APP)).toBe(false);
    expect(schemeOf("MailTo:x@y.z")).toBe("mailto");
  });
});

describe("decideNavigation", () => {
  const cases: [string, boolean, string][] = [
    ["https://trial.signalive.com/notes", true, "load"],
    ["https://trial.signalive.com/notes", false, "load"],
    ["https://signalive.com/", true, "external"],
    ["https://www.youtube.com/embed/x", false, "load"],
    ["http://trial.signalive.com/", true, "external"],
    ["mailto:hello@signalive.com", true, "external"],
    ["tel:+15551234567", true, "external"],
    ["maps://?q=here", true, "external"],
    ["itms-apps://apps.apple.com/app/id1", true, "external"],
    ["mailto:hello@signalive.com", false, "block"],
    ["about:blank", false, "load"],
    ["about:blank", true, "block"],
    ["blob:https://trial.signalive.com/1", false, "load"],
    ["blob:https://trial.signalive.com/1", true, "block"],
    ["data:text/html,hi", true, "block"],
    ["javascript:alert(1)", true, "block"],
    ["javascript:alert(1)", false, "block"],
    ["file:///etc/passwd", true, "block"],
    ["file:///etc/passwd", false, "block"],
    ["not a url", true, "block"],
  ];
  it.each(cases)("%s (top frame %s): %s", (url, top, expected) => {
    expect(decideNavigation(url, APP, top)).toBe(expected);
  });
});

describe("isIgnorableLoadError", () => {
  it("ignores cancellations and refused navigations, not real failures", () => {
    expect(isIgnorableLoadError({ code: -999, domain: "NSURLErrorDomain" })).toBe(true);
    expect(isIgnorableLoadError({ code: 102, domain: "WebKitErrorDomain" })).toBe(true);
    expect(isIgnorableLoadError({ code: 204, domain: "WebKitErrorDomain" })).toBe(true);
    expect(isIgnorableLoadError({ code: -1, description: "net::ERR_ABORTED" })).toBe(true);
    expect(isIgnorableLoadError({ code: -1009, domain: "NSURLErrorDomain", description: "The Internet connection appears to be offline." })).toBe(false);
    expect(isIgnorableLoadError({ code: -2, description: "net::ERR_NAME_NOT_RESOLVED" })).toBe(false);
    expect(isIgnorableLoadError({ code: -6, description: "net::ERR_CONNECTION_REFUSED" })).toBe(false);
  });
});

describe("resolveAppTarget", () => {
  it("takes an http(s) URL with a host, and falls back otherwise", () => {
    expect(resolveAppTarget(" http://192.168.1.20:3000 ")).toEqual({ url: "http://192.168.1.20:3000", origin: "http://192.168.1.20:3000" });
    expect(resolveAppTarget("https://preview.signalive.com/settings")).toEqual({ url: "https://preview.signalive.com/settings", origin: "https://preview.signalive.com" });
    const fallback = { url: DEFAULT_APP_URL, origin: originOf(DEFAULT_APP_URL) };
    for (const bad of [undefined, null, "", "trial.signalive.com", "ftp://x.y", "javascript:alert(1)", "https://"]) {
      expect(resolveAppTarget(bad)).toEqual(fallback);
    }
  });
});
