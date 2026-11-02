/**
 * What the WebView may load, which page may talk to the bridge, and which
 * load errors mean the app cannot be reached. Pure functions, so the tests can
 * hold them to their rules without a phone.
 */

/**
 * scheme://host[:port] in lowercase, without credentials or a default port;
 * null for a URL with no host (about:, data:, blob:, mailto:). Written out
 * rather than taken from URL, which React Native implements only in part.
 */
export function originOf(url: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/.exec(url.trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  let authority = m[2];
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);
  authority = authority.toLowerCase();
  if (!authority) return null;
  if ((scheme === "https" && authority.endsWith(":443")) || (scheme === "http" && authority.endsWith(":80"))) {
    authority = authority.slice(0, authority.lastIndexOf(":"));
  }
  return `${scheme}://${authority}`;
}

export function schemeOf(url: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Does this URL belong to the app's own origin? The bridge answers only such pages. */
export function isAppUrl(url: string | undefined | null, appOrigin: string): boolean {
  return typeof url === "string" && originOf(url) === appOrigin;
}

export type NavigationDecision = "load" | "external" | "block";

/** Never handed to the system: they would run code or open local files. */
const NEVER = new Set(["javascript", "file", "content", "vbscript"]);
/** In-page content only: fine inside a frame, never as the whole page (that would replace the app). */
const IN_PAGE = new Set(["about", "blob", "data"]);

/**
 * A navigation the WebView is about to make. The app's own origin loads;
 * another site, asked for as the whole page, opens in the system browser,
 * and so do mail, phone, maps and store links; a frame inside the page loads
 * what it likes, except anything that runs code or reads files.
 */
export function decideNavigation(url: string, appOrigin: string, isTopFrame: boolean): NavigationDecision {
  const scheme = schemeOf(url);
  if (!scheme || NEVER.has(scheme)) return "block";
  if (scheme === "http" || scheme === "https") {
    if (originOf(url) === appOrigin) return "load";
    return isTopFrame ? "external" : "load";
  }
  if (IN_PAGE.has(scheme)) return isTopFrame ? "block" : "load";
  return isTopFrame ? "external" : "block";
}

export interface LoadError {
  code: number;
  description?: string;
  /** iOS only. */
  domain?: string;
}

/**
 * Errors that are not the app being unreachable: a load cancelled by the next
 * one, a navigation this shell refused (or sent to the browser), media handed
 * to the system player.
 */
export function isIgnorableLoadError(e: LoadError): boolean {
  const domain = e.domain ?? "";
  // NSURLErrorCancelled.
  if (e.code === -999) return true;
  // WebKit: frame load interrupted by a policy change (a refused navigation); plug-in handled load (media).
  if (domain === "WebKitErrorDomain" && (e.code === 102 || e.code === 204)) return true;
  // Chromium: a navigation stopped before it finished.
  if ((e.description ?? "").includes("ERR_ABORTED")) return true;
  return false;
}
