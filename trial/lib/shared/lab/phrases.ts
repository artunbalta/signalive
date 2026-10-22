import type { Lang } from "../types";

/**
 * The lab's fixed reading list, version v1 (PHRASE_SET_VERSION). Results from
 * different versions are never pooled, so changing any text here means
 * bumping the version in lib/shared/constants.ts.
 *
 * Each set mixes short assistant commands with longer sentences, and includes
 * numbers (digits and words), times, a percentage, an ordinal, and proper
 * nouns. The Turkish set exercises dotted and dotless i (one phrase starts
 * with "Iş"), apostrophe suffixes on names ("İstanbul'da", "Elif'i"), and
 * every Turkish letter.
 *
 * Wording avoids things that would score as recognition errors without being
 * one: contractions ("what's" versus "what is"), spelling variants
 * ("summarise", "Wi-Fi"), and "o'clock".
 */

export interface Phrase {
  id: string;
  lang: Lang;
  text: string;
  kind: "command" | "sentence";
  tags: ("number" | "name" | "short" | "time")[];
}

const en: Omit<Phrase, "lang">[] = [
  { id: "en-01", text: "Set a timer for 10 minutes.", kind: "command", tags: ["number"] },
  { id: "en-02", text: "What is the weather like in London tomorrow?", kind: "sentence", tags: ["name"] },
  { id: "en-03", text: "Remind me to call Elif at 3 pm.", kind: "command", tags: ["name", "time"] },
  { id: "en-04", text: "Take a note.", kind: "command", tags: ["short"] },
  { id: "en-05", text: "Stop recording.", kind: "command", tags: ["short"] },
  { id: "en-06", text: "Mark this moment.", kind: "command", tags: ["short"] },
  { id: "en-07", text: "Play the next episode of my podcast.", kind: "command", tags: [] },
  { id: "en-08", text: "Send a message to Daniel saying I will be 15 minutes late.", kind: "command", tags: ["name", "number"] },
  { id: "en-09", text: "How long does it take to walk to King's Cross station?", kind: "sentence", tags: ["name"] },
  { id: "en-10", text: "Add oat milk, eggs and two loaves of bread to my shopping list.", kind: "command", tags: ["number"] },
  { id: "en-11", text: "The meeting with the Berlin team moved to Thursday at 9:30.", kind: "sentence", tags: ["name", "time"] },
  { id: "en-12", text: "Turn the volume down a little.", kind: "command", tags: [] },
  { id: "en-13", text: "What did Sarah say about the budget review?", kind: "sentence", tags: ["name"] },
  { id: "en-14", text: "Book a table for 4 at the Italian place on Friday evening.", kind: "command", tags: ["number", "name"] },
  { id: "en-15", text: "My flight to New York leaves from gate 22.", kind: "sentence", tags: ["name", "number"] },
  { id: "en-16", text: "Read me my last three notes.", kind: "command", tags: ["number"] },
  { id: "en-17", text: "Please give me a summary of what we discussed this morning.", kind: "command", tags: [] },
  { id: "en-18", text: "Call Mom.", kind: "command", tags: ["short", "name"] },
  { id: "en-19", text: "I need to renew my passport before the end of March.", kind: "sentence", tags: ["name"] },
  { id: "en-20", text: "Translate good morning into Turkish.", kind: "command", tags: ["name"] },
  { id: "en-21", text: "The quarterly report is due on the 21st of November.", kind: "sentence", tags: ["number", "name"] },
  { id: "en-22", text: "Pause.", kind: "command", tags: ["short"] },
  { id: "en-23", text: "Navigate to the nearest pharmacy.", kind: "command", tags: [] },
  { id: "en-24", text: "Tell Alex the presentation starts at 2:15.", kind: "command", tags: ["name", "time"] },
  { id: "en-25", text: "Our sales grew by 12% in the third quarter.", kind: "sentence", tags: ["number"] },
  { id: "en-26", text: "Find a quiet cafe near Hyde Park.", kind: "command", tags: ["name"] },
  { id: "en-27", text: "How many steps did I walk today?", kind: "sentence", tags: [] },
  { id: "en-28", text: "Schedule a call with Priya and Tom for next Monday.", kind: "command", tags: ["name"] },
  { id: "en-29", text: "Cancel my alarm for tomorrow morning.", kind: "command", tags: [] },
  { id: "en-30", text: "The train to Manchester is delayed by 25 minutes.", kind: "sentence", tags: ["name", "number"] },
];

const tr: Omit<Phrase, "lang">[] = [
  { id: "tr-01", text: "On dakikalık bir zamanlayıcı kur.", kind: "command", tags: ["number"] },
  { id: "tr-02", text: "Yarın İstanbul'da hava nasıl olacak?", kind: "sentence", tags: ["name"] },
  { id: "tr-03", text: "Saat 15:30'da Elif'i aramamı hatırlat.", kind: "command", tags: ["name", "time"] },
  { id: "tr-04", text: "Not al.", kind: "command", tags: ["short"] },
  { id: "tr-05", text: "Kaydı durdur.", kind: "command", tags: ["short"] },
  { id: "tr-06", text: "Bu anı işaretle.", kind: "command", tags: ["short"] },
  { id: "tr-07", text: "Ahmet'e beş dakika geç kalacağımı yaz.", kind: "command", tags: ["name", "number"] },
  { id: "tr-08", text: "Ankara'dan gelen tren kaçta varıyor?", kind: "sentence", tags: ["name"] },
  { id: "tr-09", text: "Alışveriş listeme süt, yumurta ve iki ekmek ekle.", kind: "command", tags: ["number"] },
  { id: "tr-10", text: "Toplantı perşembe günü saat 9'a alındı.", kind: "sentence", tags: ["time"] },
  { id: "tr-11", text: "Sesi biraz kıs.", kind: "command", tags: ["short"] },
  { id: "tr-12", text: "Zeynep bütçe hakkında ne demişti?", kind: "sentence", tags: ["name"] },
  { id: "tr-13", text: "Cuma akşamı dört kişilik bir masa ayırt.", kind: "command", tags: ["number"] },
  { id: "tr-14", text: "İzmir uçuşum 22 numaralı kapıdan kalkıyor.", kind: "sentence", tags: ["name", "number"] },
  { id: "tr-15", text: "Son üç notumu oku.", kind: "command", tags: ["number"] },
  { id: "tr-16", text: "Bu sabah konuştuklarımızı özetle.", kind: "command", tags: [] },
  { id: "tr-17", text: "Annemi ara.", kind: "command", tags: ["short"] },
  { id: "tr-18", text: "Pasaportumu mart sonundan önce yenilemem gerekiyor.", kind: "sentence", tags: [] },
  { id: "tr-19", text: "Günaydın kelimesini İngilizceye çevir.", kind: "command", tags: ["name"] },
  { id: "tr-20", text: "Çeyrek raporu 21 Kasım'a kadar teslim edilmeli.", kind: "sentence", tags: ["number", "name"] },
  { id: "tr-21", text: "Duraklat.", kind: "command", tags: ["short"] },
  { id: "tr-22", text: "En yakın eczaneye yol tarifi al.", kind: "command", tags: [] },
  { id: "tr-23", text: "Murat'a sunumun 14:15'te başlayacağını söyle.", kind: "command", tags: ["name", "time"] },
  { id: "tr-24", text: "Satışlarımız üçüncü çeyrekte %12 arttı.", kind: "sentence", tags: ["number"] },
  { id: "tr-25", text: "Kadıköy'de sessiz bir kafe bul.", kind: "command", tags: ["name"] },
  { id: "tr-26", text: "Bugün kaç adım yürüdüm?", kind: "sentence", tags: [] },
  { id: "tr-27", text: "Pazartesi Selin ve Burak ile bir görüşme ayarla.", kind: "command", tags: ["name"] },
  { id: "tr-28", text: "Yarın sabahki alarmımı iptal et.", kind: "command", tags: [] },
  { id: "tr-29", text: "İzmir'e giden otobüs 25 dakika gecikmeli.", kind: "sentence", tags: ["name", "number"] },
  { id: "tr-30", text: "Işıkları kapat ve kapıyı kilitle.", kind: "command", tags: [] },
];

export const PHRASES: readonly Phrase[] = [
  ...en.map((p) => ({ ...p, lang: "en" as const })),
  ...tr.map((p) => ({ ...p, lang: "tr" as const })),
];

const byId = new Map(PHRASES.map((p) => [p.id, p]));

export function phraseById(id: string): Phrase | undefined {
  return byId.get(id);
}

export function phrasesFor(lang: Lang): Phrase[] {
  return PHRASES.filter((p) => p.lang === lang);
}

/**
 * The quick run: ten phrases chosen to keep the mix of the full set, short
 * commands, numbers, times, names, and in Turkish the apostrophe suffixes and
 * the dotless I.
 */
const QUICK: Record<Lang, string[]> = {
  en: ["en-01", "en-03", "en-04", "en-09", "en-11", "en-13", "en-15", "en-21", "en-25", "en-30"],
  tr: ["tr-01", "tr-02", "tr-03", "tr-04", "tr-08", "tr-14", "tr-20", "tr-23", "tr-25", "tr-30"],
};

export function quickSet(lang: Lang): Phrase[] {
  return QUICK[lang].map((id) => byId.get(id)!);
}
