import type { Lang } from "../types";
import {
  DECIMAL_WORD,
  NUMBER_WORDS,
  digitsToWords,
  integerToWords,
  ordinalToWords,
} from "./numbers";

/**
 * Text normalization for word and character error rates.
 *
 * Both the reference phrase and the transcript go through exactly the same
 * steps, in the reference phrase's language, so formatting choices a provider
 * makes (case, punctuation, digits versus words, apostrophes) do not count as
 * recognition errors. Spelling still does: in Turkish "Istanbul" with a plain
 * I lowercases to "ıstanbul", which is a different word from "istanbul".
 *
 * Steps, in order:
 *  1. NFKC (full width digits and letters become ASCII)
 *  2. every apostrophe variant becomes '
 *  3. locale aware lowercasing: Turkish maps I to ı and İ to i
 *  4. diacritics: Turkish folds only the circumflex (â î û), English folds all
 *  5. numbers become words: times, percentages, ordinals, decimals, thousands
 *     separators, and Turkish case suffixes written after digits ("15'te")
 *  6. apostrophes are removed, joining suffixes ("İstanbul'a" is "istanbula")
 *  7. punctuation and symbols become spaces
 *  8. consecutive number words join into one token, so "twenty-five", "twenty
 *     five" and "25" are all "twentyfive", and "on beş" equals "onbeş"
 */

const APOSTROPHES = /[‘’‚‛ʼʹʻ`´′＇]/g;
const TR_LETTERS = "a-zçğıöşü";

export function normalizeTranscript(input: string, lang: Lang): string[] {
  let s = input.normalize("NFKC").replace(APOSTROPHES, "'");

  // Lowercasing İ outside the Turkish locale leaves i plus U+0307 (combining
  // dot above). After NFKC no other letter carries a separate U+0307.
  s = s.toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US").replace(/̇/g, "");

  if (lang === "tr") {
    s = s.replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
  } else {
    s = s.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
    // "p.m." and "a.m." would otherwise split into single letters.
    s = s.replace(/\b([ap])\.\s?m\.(?=\s|$|[,!?;:])/g, "$1m");
  }

  s = lang === "tr" ? expandNumbersTr(s) : expandNumbersEn(s);

  s = s.replace(/'/g, "");
  s = s.replace(/[\p{P}\p{S}]+/gu, " ");

  const tokens = s.split(/\s+/).filter(Boolean);
  return joinNumberWords(tokens, lang);
}

export function normalizeToString(input: string, lang: Lang): string {
  return normalizeTranscript(input, lang).join(" ");
}

/* ----------------------------------------------------------------------------
   Numbers
   ------------------------------------------------------------------------- */

const w = (words: string[]) => words.join(" ");

function attachSuffix(words: string[], suffix: string | undefined): string {
  if (!suffix) return w(words);
  const last = words.length - 1;
  return w(words.map((word, i) => (i === last ? word + suffix : word)));
}

function minutesWords(mm: string, lang: Lang): string[] {
  const minutes = Number(mm);
  if (minutes === 0) return [];
  if (minutes < 10) return [lang === "tr" ? "sıfır" : "oh", ...integerToWords(minutes, lang)];
  return integerToWords(minutes, lang);
}

function expandNumbersEn(s: string): string {
  return (
    s
      // 25% and 25 %
      .replace(/(\d+(?:\.\d+)?)\s?%/g, (_, n: string) => `${n} percent`)
      // 10:30, 3:05, 7:00
      .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) =>
        w([...integerToWords(Number(h), "en"), ...minutesWords(m, "en")]),
      )
      // 1st 2nd 3rd 21st 100th
      .replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n: string) => w(ordinalToWords(Number(n), "en")))
      // 1,000 and 12,500,000
      .replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => m.replace(/,/g, ""))
      // 3.5 is three point five
      .replace(/(\d+)\.(\d+)/g, (_, i: string, f: string) =>
        w([...integerToWords(Number(i), "en"), DECIMAL_WORD.en, ...digitsToWords(f, "en")]),
      )
      // 10am, 5k: the letters become their own word
      .replace(/(\d+)([a-z]+)/g, (_, n: string, rest: string) => `${w(integerToWords(Number(n), "en"))} ${rest}`)
      .replace(/\d+/g, (n) => w(integerToWords(Number(n), "en")))
  );
}

function expandNumbersTr(s: string): string {
  const suffix = `'?([${TR_LETTERS}]+)?`;
  return (
    s
      // %20 and 20% are both "yüzde yirmi"
      .replace(new RegExp(`%\\s?(\\d+(?:,\\d+)?)${suffix}`, "g"), (_, n: string, sfx?: string) =>
        `yüzde ${attachSuffix(trNumberWords(n), sfx)}`,
      )
      .replace(new RegExp(`(\\d+(?:,\\d+)?)\\s?%${suffix}`, "g"), (_, n: string, sfx?: string) =>
        `yüzde ${attachSuffix(trNumberWords(n), sfx)}`,
      )
      // 15:30 and 15.30 (Turkish writes times with a dot as well), 09:05'te
      .replace(new RegExp(`\\b(\\d{1,2})[:.](\\d{2})(?!\\d)${suffix}`, "g"), (_, h: string, m: string, sfx?: string) =>
        attachSuffix([...integerToWords(Number(h), "tr"), ...minutesWords(m, "tr")], sfx),
      )
      // 1'inci, 3üncü, 4'üncü
      .replace(/(\d+)'?(inci|ıncı|uncu|üncü|nci|ncı|ncu|ncü)(?![a-zçğıöşü])/g, (_, n: string) =>
        w(ordinalToWords(Number(n), "tr")),
      )
      // 1.000 and 2.500.000 (thousands separator is a dot in Turkish)
      .replace(/\b\d{1,3}(?:\.\d{3})+(?!\d)/g, (m) => m.replace(/\./g, ""))
      // 3,5 is "üç virgül beş"; 15'te is "on beşte"
      .replace(new RegExp(`(\\d+(?:,\\d+)?)${suffix}`, "g"), (_, n: string, sfx?: string) =>
        attachSuffix(trNumberWords(n), sfx),
      )
  );
}

/** "3,25" is read "üç virgül yirmi beş"; leading zeros are read one by one. */
function trNumberWords(n: string): string[] {
  const [int, frac] = n.split(",");
  const words = integerToWords(Number(int), "tr");
  if (frac === undefined) return words;
  const zeros = frac.match(/^0+/)?.[0].length ?? 0;
  const rest = frac.slice(zeros);
  return [
    ...words,
    DECIMAL_WORD.tr,
    ...Array<string>(zeros).fill("sıfır"),
    ...(rest ? integerToWords(Number(rest), "tr") : []),
  ];
}

/** Joins runs of number words, and a decimal word between two of them. */
function joinNumberWords(tokens: string[], lang: Lang): string[] {
  const vocab = NUMBER_WORDS[lang];
  const decimal = DECIMAL_WORD[lang];
  const out: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length) out.push(run.join(""));
    run = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const isNumber = vocab.has(token);
    const isDecimalJoint =
      token === decimal && run.length > 0 && i + 1 < tokens.length && vocab.has(tokens[i + 1]!);
    if (isNumber || isDecimalJoint) {
      run.push(token);
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}
