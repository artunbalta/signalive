import type { Lang } from "./types";

/**
 * Guesses Turkish versus English for a short piece of text. Used to choose a
 * voice for the reply and to label notes when a provider does not report a
 * language. Two languages only, so a few strong signals are enough: letters
 * that only Turkish uses, and very common function words.
 */

const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/g;
const TR_WORDS = new Set([
  "ve", "bir", "bu", "da", "de", "ne", "mi", "mı", "mu", "mü", "için", "ile", "çok", "var", "yok",
  "ben", "sen", "biz", "siz", "o", "ama", "gibi", "daha", "sonra", "şimdi", "nasıl", "neden",
  "evet", "hayır", "lütfen", "teşekkürler", "merhaba", "yarın", "bugün", "saat", "hangi",
]);
const EN_WORDS = new Set([
  "the", "a", "an", "and", "is", "are", "to", "of", "in", "for", "on", "with", "what", "how", "why",
  "i", "you", "we", "it", "this", "that", "please", "thanks", "hello", "tomorrow", "today", "my",
  "can", "do", "does", "set", "remind", "me", "at", "time",
]);

export function guessLanguage(text: string, fallback: Lang = "en"): Lang {
  const letters = text.match(TURKISH_LETTERS)?.length ?? 0;
  // Each language is lowercased by its own rules: under Turkish rules "It"
  // would become "ıt" and stop matching.
  const split = (s: string) => s.split(/[^\p{L}]+/u).filter(Boolean);
  let tr = letters * 2;
  let en = 0;
  for (const w of split(text.toLocaleLowerCase("tr-TR"))) if (TR_WORDS.has(w)) tr += 1;
  for (const w of split(text.toLocaleLowerCase("en-US"))) if (EN_WORDS.has(w)) en += 1;
  if (tr === en) return fallback;
  return tr > en ? "tr" : "en";
}
