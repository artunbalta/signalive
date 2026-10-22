import { describe, expect, it } from "vitest";
import { SentenceChunker } from "@/lib/shared/sentences";

function chunks(text: string, step = 3): string[] {
  const c = new SentenceChunker();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += step) out.push(...c.push(text.slice(i, i + step)));
  const rest = c.flush();
  if (rest) out.push(rest);
  return out;
}

describe("SentenceChunker", () => {
  it("splits English sentences as tokens stream in", () => {
    expect(chunks("Sure. It is sunny today! Want more?")).toEqual(["Sure.", "It is sunny today!", "Want more?"]);
  });

  it("splits Turkish sentences", () => {
    expect(chunks("Tabii. Yarın hava güneşli olacak. Başka bir şey ister misiniz?")).toEqual([
      "Tabii.",
      "Yarın hava güneşli olacak.",
      "Başka bir şey ister misiniz?",
    ]);
  });

  it("does not split decimals, abbreviations or initials", () => {
    expect(chunks("Dr. Smith said it is 3.5 degrees. J. Doe agreed.")).toEqual([
      "Dr. Smith said it is 3.5 degrees.",
      "J. Doe agreed.",
    ]);
    expect(chunks("Örn. yarın gel. Tamam.")).toEqual(["Örn. yarın gel.", "Tamam."]);
  });

  it("keeps a Turkish ordinal with its noun", () => {
    expect(chunks("Toplantı 3. katta. Saat ikide başlıyor.")).toEqual(["Toplantı 3. katta.", "Saat ikide başlıyor."]);
  });

  it("waits for whitespace before deciding a period ends a sentence", () => {
    const c = new SentenceChunker();
    expect(c.push("It costs 3.")).toEqual([]);
    expect(c.push("5 lira. Okay")).toEqual(["It costs 3.5 lira."]);
    expect(c.flush()).toBe("Okay");
  });

  it("lets the first chunk end at a clause break once it is long", () => {
    const out = chunks("Your meeting with Elif is tomorrow morning, and the notes mention the budget review");
    expect(out[0]).toBe("Your meeting with Elif is tomorrow morning,");
    expect(out[1]).toBe("and the notes mention the budget review");
  });

  it("does not cut short first chunks at a comma", () => {
    expect(chunks("Yes, of course. Done.")).toEqual(["Yes, of course.", "Done."]);
  });

  it("splits very long chunks", () => {
    const long = `${"word ".repeat(70)}end.`;
    const out = chunks(long, 7);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((s) => s.length <= 230)).toBe(true);
  });

  it("splits on newlines and drops empty pieces", () => {
    expect(chunks("First line\n\nSecond line")).toEqual(["First line", "Second line"]);
    const c = new SentenceChunker();
    expect(c.flush()).toBeNull();
  });
});
