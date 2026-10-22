import "server-only";
import { cookies, headers } from "next/headers";
import { getMessages, isLocale, LOCALE_COOKIE, negotiate, type Locale } from "./index";

/** Locale for this request: the user's choice (cookie), else the browser's. */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return negotiate((await headers()).get("accept-language"));
}

export async function getRequestMessages() {
  const locale = await getLocale();
  return { locale, messages: getMessages(locale) };
}
