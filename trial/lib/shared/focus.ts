import type { Lang } from "./types";

/**
 * The Focus scene: three people talking at once around the listener, each
 * a separate recording placed in space. Which one comes forward follows the
 * listener's head (or a stand-in for it), through the attention extension
 * point. The scripts are fixed, so a recap can be checked against them.
 */

export interface FocusSpeaker {
  /** Source id in the audio graph's SourceStage. */
  sourceId: string;
  /** Degrees from straight ahead; right is positive. */
  azimuth: number;
  name: Record<Lang, string>;
  topic: Record<Lang, string>;
  /** OpenAI voice, and how it should sound. */
  voice: string;
  style: string;
  script: Record<Lang, string>;
}

export const FOCUS_SPEAKERS: readonly FocusSpeaker[] = [
  {
    sourceId: "focus:left",
    azimuth: -45,
    name: { tr: "Ayşe", en: "Emma" },
    topic: { tr: "Kapadokya gezisi", en: "A trip to Cappadocia" },
    voice: "coral",
    style: "Warm and lively, telling a close friend about a trip, smiling as she talks.",
    script: {
      tr: "Ya inanmayacaksın, Kapadokya'da sabah dörtte kalktık. Otelin önüne beşe çeyrek kala minibüs geldi, rehberimizin adı Hasan'dı, çok tatlı bir adamdı. Balon tam altı buçukta havalandı, güneş Uçhisar'ın arkasından doğarken yüz kadar balon aynı anda yükseldi. Bin metreye çıktık diyorlar, ben aşağı bakamadım bile. İnişte pilot herkese şampanya açtı, bir de madalya verdiler, düşünebiliyor musun, madalya! Bir dahakine kesinlikle Ekim'de gideceğim, hava tam kıvamındaydı. Sen de gelirsin değil mi? Bu sefer Güvercinlik Vadisi'nde yürüyüş de yapalım.",
      en: "You won't believe it, we were up at four in the morning in Cappadocia. The van picked us up at a quarter to five, and our guide, Hasan, was the sweetest man. The balloon lifted off at exactly six thirty, and as the sun came up behind Uçhisar about a hundred balloons rose at once. They said we got to a thousand meters, I couldn't even look down. When we landed, the pilot opened champagne for everyone and handed out medals, can you imagine, medals! Next time I'm definitely going in October, the weather was perfect. You'll come too, right? This time let's hike Pigeon Valley as well.",
    },
  },
  {
    sourceId: "focus:center",
    azimuth: 0,
    name: { tr: "Mert", en: "Daniel" },
    topic: { tr: "Girişim fikri", en: "A startup idea" },
    voice: "onyx",
    style: "Confident and quick, pitching an idea to a friend with real enthusiasm.",
    script: {
      tr: "Bak, fikir şu: saksına küçük bir sensör takıyorsun, toprak kuruyunca telefonuna bildirim geliyor. O kadar basit. Ama asıl olay şu, sensör bitkinin türünü de biliyor, fesleğenle kaktüsü aynı sulamıyorsun. İlk ay bin iki yüz kişi indirdi, hiç reklam vermeden. Aylık kırk dokuz lira düşünüyoruz, ilk sensör hediye. Önümüzdeki salı bir yatırımcıyla görüşmem var, kırk dakika ayırdı. Ondan önce sunumu bir kere daha üzerinden geçmemiz lazım, özellikle rakamlar kısmını. Perşembeye kadar demo videosunu da bitirirsek çok iyi olur.",
      en: "So here's the idea: you clip a tiny sensor onto your plant pot, and when the soil dries out, your phone gets a notification. That simple. But here's the real thing, the sensor knows the plant, so you don't water basil like a cactus. Twelve hundred people downloaded it in the first month, without a single ad. We're thinking four ninety-nine a month, and the first sensor is free. Next Tuesday I'm meeting an investor, she gave us forty minutes. Before that we need to go through the deck once more, especially the numbers. If we finish the demo video by Thursday, that would be great.",
    },
  },
  {
    sourceId: "focus:right",
    azimuth: 45,
    name: { tr: "Barista", en: "Barista" },
    topic: { tr: "Siparişler", en: "Orders up" },
    voice: "verse",
    style: "An upbeat café barista calling out finished orders across a busy counter, loud and friendly.",
    script: {
      tr: "Selin, yulaf sütlü latten hazır! İki americano, biri buzlu, kimindi? Kemal Bey, filtre kahveniz bardakta. Bir de karamelli frappe var, ekstra şurup istemiştiniz. Arkadaşlar beş dakikaya kruvasanlar fırından çıkıyor, bademli de var. Kartla ödeyenler şu yandan alsın lütfen. Elif, sıcak çikolatan, üstüne tarçın serptim! Duble espresso, şekersiz, kasaya yakın tarafta duruyor. Bir orta boy chai tea latte, Burak'ın. Teşekkürler, iyi günler!",
      en: "Selin, oat milk latte! Two americanos, one iced, whose was that? Kevin, your filter coffee's on the counter. And a caramel frappé, with the extra syrup you asked for. Folks, croissants are out of the oven in five minutes, almond ones too. If you're paying by card, pick up on this side, please. Ellie, hot chocolate, I put cinnamon on top! Double espresso, no sugar, by the register. One medium chai tea latte, for Ben. Thanks, have a good one!",
    },
  },
];

/** The faced voice stays at full level; the others drop this far. */
export const FOCUS_CUT_DB = -16;
/** When no one is faced, every voice sits here, so three together are not too loud. */
export const FOCUS_NEUTRAL_DB = -4;
/** A speaker counts as faced within this many degrees of their direction. */
export const FOCUS_FACE_HALF_DEG = 18;
/** A recap covers this many of the speaker's latest seconds. */
export const FOCUS_RECAP_SEC = 15;

/**
 * The speaker the head faces, if any, and how squarely: confidence is 1 when
 * facing them dead on and 0.5 at the edge of their zone. Turning past the
 * outermost speaker still faces them.
 */
export function facedSpeaker(yawDeg: number, speakers: readonly Pick<FocusSpeaker, "azimuth">[] = FOCUS_SPEAKERS): { index: number; confidence: number } | null {
  const outer = speakers.map((s) => s.azimuth);
  const lo = Math.min(...outer);
  const hi = Math.max(...outer);
  let index = -1;
  let off = Infinity;
  speakers.forEach((s, i) => {
    const beyond = (s.azimuth === lo && yawDeg < lo) || (s.azimuth === hi && yawDeg > hi);
    const d = beyond ? 0 : Math.abs(yawDeg - s.azimuth);
    if (d < off) {
      off = d;
      index = i;
    }
  });
  if (index < 0 || off > FOCUS_FACE_HALF_DEG) return null;
  return { index, confidence: 1 - off / (2 * FOCUS_FACE_HALF_DEG) };
}

/**
 * Splits a script at sentence ends into about `parts` pieces of similar
 * length, so they can be synthesized side by side and joined in order.
 */
export function splitScript(text: string, parts: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const target = text.length / Math.max(1, parts);
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    current = current ? `${current} ${s}` : s;
    if (current.length >= target && out.length < parts - 1) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Moves the start of a clip of a looping recording back to just after a
 * pause, so it does not begin mid-word (a number cut in half recaps wrong).
 * Positions are absolute sample counts into the loop; the result is never
 * before `earliest` nor more than `maxBackSec` before `start`, and is
 * `start` itself when no pause is found.
 */
export function startAfterPause(
  samples: Float32Array,
  start: number,
  rate: number,
  { earliest = 0, maxBackSec = 4, minPauseSec = 0.16, quietDb = -40 }: { earliest?: number; maxBackSec?: number; minPauseSec?: number; quietDb?: number } = {},
): number {
  const n = samples.length;
  if (!n) return start;
  const frame = Math.max(1, Math.round(rate * 0.02));
  const quiet = 10 ** (quietDb / 10);
  const need = Math.ceil((minPauseSec * rate) / frame);
  const floor = Math.max(earliest, start - maxBackSec * rate);
  let run = 0;
  for (let end = Math.floor(start); end - frame >= floor; end -= frame) {
    let sum = 0;
    for (let k = end - frame; k < end; k++) {
      const s = samples[((k % n) + n) % n]!;
      sum += s * s;
    }
    if (sum / frame < quiet) {
      run++;
      // The pause ends where the frames after it began: start the clip there.
      if (run >= need) return end + (run - 1) * frame;
    } else {
      run = 0;
    }
  }
  return start;
}

/**
 * The last `count` samples of a looping recording that has played up to
 * position `at` (in samples, any number of loops), oldest first.
 */
export function loopTail(samples: Float32Array, at: number, count: number): Float32Array<ArrayBuffer> {
  const n = samples.length;
  const out = new Float32Array(Math.max(0, Math.min(count, Math.floor(at), n)));
  if (!n || !out.length) return out;
  let start = (((Math.floor(at) - out.length) % n) + n) % n;
  for (let i = 0; i < out.length; i++) {
    out[i] = samples[start]!;
    start = start + 1 === n ? 0 : start + 1;
  }
  return out;
}
