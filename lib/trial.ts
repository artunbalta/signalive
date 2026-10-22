/**
 * Where the web trial (the separate app in trial/) runs. Set
 * NEXT_PUBLIC_TRIAL_URL once it is deployed; until then /features points
 * people to the waitlist. In development it is the trial's local server.
 */
export const TRIAL_URL: string | null =
  process.env.NEXT_PUBLIC_TRIAL_URL?.replace(/\/+$/, "") ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : null);

/** In-page anchors written for the home page, made to work from any page. */
export function anchored(href: string, base = ""): string {
  return href.startsWith("#") ? `${base}${href}` : href;
}
