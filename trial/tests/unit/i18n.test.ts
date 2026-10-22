import { describe, expect, it } from "vitest";
import { format, negotiate } from "@/lib/i18n";
import { en } from "@/lib/i18n/messages/en";
import { tr } from "@/lib/i18n/messages/tr";

// En dash and em dash, built from code points so this file contains neither.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("i18n", () => {
  it("formats placeholders and English plurals", () => {
    expect(format("{n} note{s}", { n: 1 })).toBe("1 note");
    expect(format("{n} note{s}", { n: 3 })).toBe("3 notes");
    expect(format("{n} not", { n: 3 })).toBe("3 not");
    // An explicit {s} (seconds) is never overwritten.
    expect(format("Listening, {s} s left", { s: 4 })).toBe("Listening, 4 s left");
    expect(format("{missing} stays", {})).toBe("{missing} stays");
  });

  it("prefers Turkish only when the browser does", () => {
    expect(negotiate("tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr");
    expect(negotiate("en-US,en;q=0.9,tr;q=0.5")).toBe("en");
    expect(negotiate("de-DE")).toBe("en");
    expect(negotiate(null)).toBe("en");
  });

  it("has the same keys in both languages and no dashes in any string", () => {
    const keys = (o: unknown, prefix = ""): string[] =>
      typeof o === "object" && o !== null && !Array.isArray(o)
        ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    expect(keys(tr).sort()).toEqual(keys(en).sort());
    const strings = (o: unknown): string[] =>
      typeof o === "string" ? [o] : typeof o === "object" && o !== null ? Object.values(o).flatMap(strings) : [];
    for (const s of [...strings(en), ...strings(tr)]) expect(s).not.toMatch(DASHES);
  });

  it("makes no health or hearing claims", () => {
    const strings = (o: unknown): string[] =>
      typeof o === "string" ? [o] : typeof o === "object" && o !== null ? Object.values(o).flatMap(strings) : [];
    const claims = /\b(improves? your hearing|hearing aid|treats?|diagnos|cures?|noise[- ]proof|works in any noise)\b/i;
    for (const s of strings(en)) {
      // The one sentence that denies such claims is allowed.
      if (s === en.consent.medicalBody) continue;
      expect(s).not.toMatch(claims);
    }
  });
});
