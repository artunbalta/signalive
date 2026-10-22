import type { Lang } from "../types";

/**
 * Integer to words, used only by WER normalization so that "15", "fifteen"
 * and "on beş" compare equal to their spoken forms. Covers 0 to 999 billion,
 * which is far beyond anything a test phrase contains.
 */

const EN_ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const EN_SCALES: [number, string][] = [
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
];

const TR_ONES = ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TR_TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
const TR_SCALES: [number, string][] = [
  [1e9, "milyar"],
  [1e6, "milyon"],
  [1e3, "bin"],
];

function enBelowThousand(n: number): string[] {
  const out: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) out.push(EN_ONES[hundreds]!, "hundred");
  if (rest) {
    if (rest < 20) out.push(EN_ONES[rest]!);
    else {
      out.push(EN_TENS[Math.floor(rest / 10)]!);
      if (rest % 10) out.push(EN_ONES[rest % 10]!);
    }
  }
  return out;
}

function trBelowThousand(n: number): string[] {
  const out: string[] = [];
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  // Turkish says "yüz" for 100, never "bir yüz".
  if (hundreds) {
    if (hundreds > 1) out.push(TR_ONES[hundreds]!);
    out.push("yüz");
  }
  if (tens) out.push(TR_TENS[tens]!);
  if (ones) out.push(TR_ONES[ones]!);
  return out;
}

export function integerToWords(value: number, lang: Lang): string[] {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value) || value >= 1e12) {
    return String(value).split("");
  }
  if (value === 0) return [lang === "tr" ? TR_ONES[0]! : EN_ONES[0]!];

  const scales = lang === "tr" ? TR_SCALES : EN_SCALES;
  const below = lang === "tr" ? trBelowThousand : enBelowThousand;
  const out: string[] = [];
  let rest = value;
  for (const [size, word] of scales) {
    const count = Math.floor(rest / size);
    if (count) {
      // Turkish says "bin" for 1000, never "bir bin". Millions keep "bir".
      if (!(lang === "tr" && size === 1e3 && count === 1)) out.push(...below(count));
      out.push(word);
      rest %= size;
    }
  }
  if (rest) out.push(...below(rest));
  return out;
}

/** Digits read one at a time, for decimals: "3.14" is "three point one four". */
export function digitsToWords(digits: string, lang: Lang): string[] {
  const ones = lang === "tr" ? TR_ONES : EN_ONES;
  return digits.split("").map((d) => ones[Number(d)] ?? d);
}

const EN_ORDINAL_IRREGULAR: Record<string, string> = {
  one: "first", two: "second", three: "third", five: "fifth", eight: "eighth",
  nine: "ninth", twelve: "twelfth",
};

const TR_ORDINAL: Record<string, string> = {
  bir: "birinci", iki: "ikinci", "üç": "üçüncü", "dört": "dördüncü", "beş": "beşinci",
  "altı": "altıncı", yedi: "yedinci", sekiz: "sekizinci", dokuz: "dokuzuncu",
  on: "onuncu", yirmi: "yirminci", otuz: "otuzuncu", "kırk": "kırkıncı", elli: "ellinci",
  "altmış": "altmışıncı", "yetmiş": "yetmişinci", seksen: "sekseninci", doksan: "doksanıncı",
  "yüz": "yüzüncü", bin: "bininci", milyon: "milyonuncu", milyar: "milyarıncı",
};

/** Ordinal words: only the last word changes in both languages. */
export function ordinalToWords(value: number, lang: Lang): string[] {
  const words = integerToWords(value, lang);
  const last = words[words.length - 1]!;
  let ordinal: string;
  if (lang === "tr") {
    ordinal = TR_ORDINAL[last] ?? last;
  } else if (EN_ORDINAL_IRREGULAR[last]) {
    ordinal = EN_ORDINAL_IRREGULAR[last]!;
  } else if (last.endsWith("y")) {
    ordinal = `${last.slice(0, -1)}ieth`;
  } else {
    ordinal = `${last}th`;
  }
  return [...words.slice(0, -1), ordinal];
}

/** Words that form a number when they stand next to each other. */
export const NUMBER_WORDS: Record<Lang, ReadonlySet<string>> = {
  en: new Set([
    ...EN_ONES,
    ...EN_TENS.filter(Boolean),
    "hundred", "thousand", "million", "billion",
  ]),
  tr: new Set([
    ...TR_ONES,
    ...TR_TENS.filter(Boolean),
    "yüz", "bin", "milyon", "milyar",
  ]),
};

/** The word that joins the two halves of a spoken decimal. */
export const DECIMAL_WORD: Record<Lang, string> = { en: "point", tr: "virgül" };
