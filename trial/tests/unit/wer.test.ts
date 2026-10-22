import { describe, expect, it } from "vitest";
import { align, levenshtein } from "@/lib/shared/text/levenshtein";
import { scoreTranscript } from "@/lib/shared/text/wer";

describe("levenshtein", () => {
  it("computes the classic distances", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("counts code points, not UTF-16 units", () => {
    expect(levenshtein("ışık", "isik")).toBe(3);
    expect(levenshtein("😀a", "a")).toBe(1);
  });

  it("splits edits into substitutions, deletions and insertions", () => {
    expect(align(["a", "b", "c", "d"], ["a", "x", "c"])).toEqual({
      distance: 2, hits: 2, substitutions: 1, deletions: 1, insertions: 0,
    });
    expect(align(["a"], ["a", "b", "c"])).toEqual({
      distance: 2, hits: 1, substitutions: 0, deletions: 0, insertions: 2,
    });
    expect(align([], [])).toEqual({ distance: 0, hits: 0, substitutions: 0, deletions: 0, insertions: 0 });
  });

  it("always reports S + D + I equal to the distance", () => {
    const cases: [string, string][] = [
      ["the cat sat on the mat", "a cat sat mat on"],
      ["one two three", "three two one"],
      ["x", "y z w"],
    ];
    for (const [r, h] of cases) {
      const res = align(r.split(" "), h.split(" "));
      expect(res.substitutions + res.deletions + res.insertions).toBe(res.distance);
      expect(res.hits + res.substitutions + res.deletions).toBe(r.split(" ").length);
      expect(res.hits + res.substitutions + res.insertions).toBe(h.split(" ").length);
    }
  });
});

describe("scoreTranscript", () => {
  it("scores a perfect transcript as zero despite formatting", () => {
    const s = scoreTranscript("Yarın saat 15:30'da İstanbul'a gidiyorum.", "yarın saat on beş otuzda istanbula gidiyorum", "tr");
    expect(s.wer).toBe(0);
    expect(s.cer).toBe(0);
  });

  it("computes WER with S, D and I", () => {
    const s = scoreTranscript("set a timer for ten minutes", "set timer for two minutes please", "en");
    // timer ok, "a" deleted, ten -> two substituted, "please" inserted
    expect(s.refWords).toBe(6);
    expect(s.deletions).toBe(1);
    expect(s.substitutions).toBe(1);
    expect(s.insertions).toBe(1);
    expect(s.wer).toBeCloseTo(3 / 6);
  });

  it("can exceed 1 when the hypothesis adds many words", () => {
    const s = scoreTranscript("stop", "please please stop now", "en");
    expect(s.wer).toBe(3);
  });

  it("scores an empty hypothesis as all deletions", () => {
    const s = scoreTranscript("üç kahve lütfen", "", "tr");
    expect(s.wer).toBe(1);
    expect(s.deletions).toBe(3);
    expect(s.cer).toBe(1);
  });

  it("counts a dotless i spelling mistake in Turkish", () => {
    const s = scoreTranscript("İstanbul'a gidiyorum", "Istanbul'a gidiyorum", "tr");
    expect(s.substitutions).toBe(1);
    expect(s.wer).toBe(0.5);
    expect(s.charErrors).toBe(1);
  });

  it("counts a number as one token", () => {
    const s = scoreTranscript("Toplantı 2025'te yapılacak", "toplantı 2026'da yapılacak", "tr");
    // "iki bin yirmi beşte" vs "iki bin yirmi altıda": only the suffixed last word differs,
    // and the run before it joins into one token on both sides.
    expect(s.normalizedReference).toBe("toplantı ikibinyirmi beşte yapılacak");
    expect(s.normalizedHypothesis).toBe("toplantı ikibinyirmi altıda yapılacak");
    expect(s.substitutions).toBe(1);
  });

  it("handles empty references without dividing by zero", () => {
    expect(scoreTranscript("", "", "en").wer).toBe(0);
    expect(scoreTranscript("", "noise", "en").wer).toBe(1);
  });

  it("computes CER on normalized text", () => {
    const s = scoreTranscript("merhaba dünya", "merhaba dunya", "tr");
    expect(s.charErrors).toBe(1);
    expect(s.refChars).toBe("merhaba dünya".length);
    expect(s.cer).toBeCloseTo(1 / 13);
  });
});
