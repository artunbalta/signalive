/**
 * Splits streamed LLM text into speakable chunks for TTS.
 *
 * A chunk ends at a sentence end (. ! ? or an ellipsis, then whitespace) or a
 * newline. Not at: decimals ("3.5"), abbreviations ("Dr.", "e.g.", "örn."),
 * single initials ("J. Smith"), or Turkish ordinals ("3. kat").
 *
 * The first chunk may end early at a clause break (, ; :) once it is long
 * enough, because the first audio is what the listener waits for. Any later
 * chunk that grows very long is split at its last clause break or space, so
 * one TTS request never carries a paragraph.
 */

const ABBREVIATIONS = new Set([
  // English
  "dr", "mr", "mrs", "ms", "prof", "st", "vs", "etc", "e.g", "i.e", "no", "jr", "sr", "approx", "inc", "ltd", "mt", "ave",
  // Turkish
  "örn", "vb", "vs", "sn", "doç", "yrd", "av", "mah", "cad", "sok", "apt", "bkz", "yy", "s", "dk", "sa",
]);

const FIRST_CHUNK_MIN = 40;
const LONG_CHUNK = 220;

/** true, false, or "wait" when the text that decides it has not arrived yet. */
function isSentenceEnd(text: string, i: number): boolean | "wait" {
  const ch = text[i]!;
  if (ch === "\n") return true;
  if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") return false;
  const next = text[i + 1];
  // Needs whitespace after it; at the very end we cannot know yet.
  if (next === undefined) return "wait";
  if (!/\s/.test(next)) return false;
  if (ch !== ".") return true;

  // The word right before the period.
  let j = i - 1;
  while (j >= 0 && /[\p{L}\p{N}.]/u.test(text[j]!)) j--;
  const word = text.slice(j + 1, i).toLowerCase();
  if (/^\d+$/.test(word)) {
    // "3. kat": a Turkish ordinal is followed by a lowercase word.
    const after = text.slice(i + 1).trimStart();
    if (!after) return "wait";
    if (/^\p{Ll}/u.test(after)) return false;
  }
  if (ABBREVIATIONS.has(word.replace(/\.$/, ""))) return false;
  if (/^\p{L}$/u.test(word)) return false; // initials
  return true;
}

export class SentenceChunker {
  private buf = "";
  private emitted = 0;

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut < 0) break;
      const chunk = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (chunk) {
        out.push(chunk);
        this.emitted++;
      }
    }
    return out;
  }

  /** The rest of the text, once the stream has ended. */
  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    if (!rest) return null;
    this.emitted++;
    return rest;
  }

  private findCut(): number {
    for (let i = 0; i < this.buf.length; i++) {
      const end = isSentenceEnd(this.buf, i);
      if (end === "wait") return -1;
      if (end) return i + 1;
    }
    const clause = (from: number) => {
      for (let i = this.buf.length - 2; i >= from; i--) {
        if (/[,;:]/.test(this.buf[i]!) && /\s/.test(this.buf[i + 1]!)) return i + 1;
      }
      return -1;
    };
    if (this.emitted === 0 && this.buf.length >= FIRST_CHUNK_MIN) {
      const c = clause(FIRST_CHUNK_MIN - 16);
      if (c > 0) return c;
    }
    if (this.buf.length >= LONG_CHUNK) {
      const c = clause(LONG_CHUNK / 2);
      if (c > 0) return c;
      const space = this.buf.lastIndexOf(" ", LONG_CHUNK);
      if (space > LONG_CHUNK / 2) return space + 1;
    }
    return -1;
  }
}
