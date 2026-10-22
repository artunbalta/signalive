import { describe, expect, it } from "vitest";
import { normalizeToString, normalizeTranscript } from "@/lib/shared/text/normalize";
import { integerToWords, ordinalToWords } from "@/lib/shared/text/numbers";

const tr = (s: string) => normalizeToString(s, "tr");
const en = (s: string) => normalizeToString(s, "en");

describe("Turkish dotted and dotless i", () => {
  it("lowercases İ to i and I to ı in Turkish", () => {
    expect(tr("İSTANBUL")).toBe("istanbul");
    expect(tr("IŞIK")).toBe("ışık");
    expect(tr("Iğdır")).toBe("ığdır");
    expect(tr("İzmir ve Isparta")).toBe("izmir ve ısparta");
  });

  it("treats a plain capital I in a Turkish word as a real spelling difference", () => {
    // "Istanbul" written with ASCII I is not the Turkish spelling.
    expect(tr("Istanbul")).toBe("ıstanbul");
    expect(tr("Istanbul")).not.toBe(tr("İstanbul"));
  });

  it("does not leave a combining dot when İ appears in English text", () => {
    expect(en("İstanbul")).toBe("istanbul");
    expect(en("İstanbul")).not.toContain("̇");
  });

  it("keeps ı and i distinct after lowercasing", () => {
    expect(tr("kır")).not.toBe(tr("kir"));
    expect(tr("KIR")).toBe("kır");
    expect(tr("KİR")).toBe("kir");
  });

  it("handles a decomposed İ (I plus combining dot)", () => {
    expect(tr("İstanbul")).toBe("istanbul");
  });
});

describe("Turkish apostrophes in suffixes", () => {
  it("joins proper noun suffixes with any apostrophe variant", () => {
    expect(tr("İstanbul'a")).toBe("istanbula");
    expect(tr("İstanbul’a")).toBe("istanbula");
    expect(tr("İstanbul‘a")).toBe("istanbula");
    expect(tr("İstanbula")).toBe("istanbula");
  });

  it("matches common inflected names", () => {
    expect(tr("Ankara'dan")).toBe(tr("Ankaradan"));
    expect(tr("Ayşe'nin")).toBe("ayşenin");
    expect(tr("Elif'e")).toBe("elife");
  });

  it("does not merge a suffix written as a separate word", () => {
    expect(normalizeTranscript("İstanbul a", "tr")).toEqual(["istanbul", "a"]);
  });
});

describe("Turkish digits", () => {
  it("writes numbers as words", () => {
    expect(integerToWords(15, "tr")).toEqual(["on", "beş"]);
    expect(integerToWords(100, "tr")).toEqual(["yüz"]);
    expect(integerToWords(1000, "tr")).toEqual(["bin"]);
    expect(integerToWords(1100, "tr")).toEqual(["bin", "yüz"]);
    expect(integerToWords(2025, "tr")).toEqual(["iki", "bin", "yirmi", "beş"]);
    expect(integerToWords(1_000_000, "tr")).toEqual(["bir", "milyon"]);
    expect(integerToWords(0, "tr")).toEqual(["sıfır"]);
  });

  it("treats digits, spaced words and joined words the same", () => {
    expect(tr("15")).toBe(tr("on beş"));
    expect(tr("15")).toBe(tr("onbeş"));
    expect(tr("3 kahve")).toBe(tr("üç kahve"));
  });

  it("attaches case suffixes written after digits", () => {
    expect(tr("15'te")).toBe("on beşte");
    expect(tr("15te")).toBe("on beşte");
    expect(tr("2025'te")).toBe(tr("iki bin yirmi beşte"));
    expect(tr("3'ü")).toBe("üçü");
  });

  it("reads times written with a colon or a dot", () => {
    expect(tr("Saat 15:30'da")).toBe(tr("saat on beş otuzda"));
    expect(tr("15.30")).toBe(tr("15:30"));
    expect(tr("09:05")).toBe(tr("dokuz sıfır beş"));
    expect(tr("saat 7:00")).toBe(tr("saat yedi"));
  });

  it("reads percentages, decimals, thousands and ordinals", () => {
    expect(tr("%20")).toBe(tr("yüzde yirmi"));
    expect(tr("20%")).toBe(tr("yüzde yirmi"));
    expect(tr("%20'si")).toBe(tr("yüzde yirmisi"));
    expect(tr("3,5")).toBe(tr("üç virgül beş"));
    expect(tr("1.000")).toBe(tr("bin"));
    expect(tr("2.500.000")).toBe(tr("iki milyon beş yüz bin"));
    expect(tr("3'üncü")).toBe("üçüncü");
    expect(ordinalToWords(21, "tr")).toEqual(["yirmi", "birinci"]);
  });

  it("does not mistake a sentence end for a decimal or a time", () => {
    expect(normalizeTranscript("Saat 15.", "tr")).toEqual(["saat", "onbeş"]);
  });

  it("keeps the indefinite article bir on its own", () => {
    expect(normalizeTranscript("bir kahve", "tr")).toEqual(["bir", "kahve"]);
    expect(normalizeTranscript("bir milyon", "tr")).toEqual(["birmilyon"]);
  });
});

describe("Turkish circumflex", () => {
  it("folds â, î and û but no other Turkish letter", () => {
    expect(tr("kâr")).toBe("kar");
    expect(tr("hâlâ")).toBe("hala");
    expect(tr("çğıöşü")).toBe("çğıöşü");
  });
});

describe("English", () => {
  it("lowercases and strips punctuation", () => {
    expect(en("Hello, World!")).toBe("hello world");
    expect(en("Don't stop.")).toBe("dont stop");
    expect(en("Don’t")).toBe("dont");
  });

  it("treats digits and number words the same", () => {
    expect(en("25")).toBe(en("twenty-five"));
    expect(en("25")).toBe(en("twenty five"));
    expect(en("1,000")).toBe(en("one thousand"));
    expect(en("3.5")).toBe(en("three point five"));
    expect(en("50%")).toBe(en("fifty percent"));
    expect(integerToWords(2025, "en")).toEqual(["two", "thousand", "twenty", "five"]);
  });

  it("reads times and am pm", () => {
    expect(en("10:30")).toBe(en("ten thirty"));
    expect(en("3:05 p.m.")).toBe(en("three oh five pm"));
    expect(en("3pm")).toBe(en("3 PM"));
    expect(en("7:00")).toBe(en("seven"));
  });

  it("reads ordinals", () => {
    expect(en("1st")).toBe("first");
    expect(en("22nd")).toBe(en("twenty second"));
    expect(ordinalToWords(40, "en")).toEqual(["fortieth"]);
    expect(ordinalToWords(12, "en")).toEqual(["twelfth"]);
  });

  it("only joins point between two number words", () => {
    expect(normalizeTranscript("the point is three", "en")).toEqual(["the", "point", "is", "three"]);
  });

  it("folds accents", () => {
    expect(en("Café")).toBe("cafe");
  });
});

describe("general", () => {
  it("normalizes full width digits and odd whitespace", () => {
    expect(tr("１５")).toBe(tr("15"));
    expect(en("  hello \n\t world  ")).toBe("hello world");
  });

  it("returns no tokens for punctuation only input", () => {
    expect(normalizeTranscript("...!?", "en")).toEqual([]);
    expect(normalizeTranscript("", "tr")).toEqual([]);
  });
});
