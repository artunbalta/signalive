import type { ExportBundle, Note, Utterance } from "./types";

/**
 * Human readable export: notes first (what people usually want), then every
 * transcript grouped by session, then a summary of measurements. The JSON
 * export carries everything; this one is for reading.
 */

const time = (iso: string) => iso.slice(11, 19);
const day = (iso: string) => iso.slice(0, 10);

function noteMd(n: Note): string {
  const parts = [`### ${n.title}`, `${day(n.createdAt)} ${time(n.createdAt)} UTC · ${n.source} · ${n.language}`, "", n.summary];
  if (n.action_items.length) parts.push("", "**Action items**", ...n.action_items.map((a) => `- ${a}`));
  if (n.topics.length) parts.push("", `Topics: ${n.topics.join(", ")}`);
  if (n.people_mentioned.length) parts.push(`People: ${n.people_mentioned.join(", ")}`);
  return parts.join("\n");
}

function utteranceMd(u: Utterance): string {
  const who = u.source === "assistant" ? (u.role === "assistant" ? "Signalive" : "You") : "Recorded";
  return `- [${time(u.startedAt)}] **${who}:** ${u.text.replace(/\s+/g, " ")}`;
}

export function exportToMarkdown(b: ExportBundle): string {
  const out: string[] = [
    "# Signalive trial export",
    "",
    `Exported ${b.exportedAt}. User ${b.userId}.`,
    "",
    `## Notes (${b.notes.length})`,
    "",
  ];
  if (b.notes.length === 0) out.push("No notes.", "");
  for (const n of [...b.notes].sort((x, y) => y.createdAt.localeCompare(x.createdAt))) out.push(noteMd(n), "");

  out.push(`## Transcripts (${b.utterances.length} lines)`, "");
  const bySession = new Map<string, Utterance[]>();
  for (const u of b.utterances) {
    const list = bySession.get(u.sessionId) ?? [];
    list.push(u);
    bySession.set(u.sessionId, list);
  }
  if (bySession.size === 0) out.push("No transcripts.", "");
  for (const [sid, list] of bySession) {
    list.sort((x, y) => x.startedAt.localeCompare(y.startedAt));
    out.push(`### Session ${sid.slice(0, 8)}, ${day(list[0]!.startedAt)}`, "", ...list.map(utteranceMd), "");
  }

  if (b.marks.length) {
    out.push(`## Marked moments (${b.marks.length})`, "");
    for (const m of b.marks) out.push(`- ${m.startAt} to ${m.endAt}${m.label ? `: ${m.label}` : ""}`);
    out.push("");
  }

  out.push(
    "## Measurements",
    "",
    `- Lab runs: ${b.labRuns.length}, scored transcripts: ${b.labResults.length}`,
    `- Timed assistant exchanges: ${b.latencyEvents.length}`,
    `- Device profiles: ${b.deviceProfiles.length}`,
    `- Stored recordings: ${b.audioObjects.length}`,
    `- Consent records: ${b.consents.length}`,
    "",
    "The JSON export contains every field of every record.",
    "",
  );
  return out.join("\n");
}
