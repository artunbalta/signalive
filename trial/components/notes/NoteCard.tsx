"use client";

import { useI18n } from "@/components/providers/AppProviders";
import type { Note } from "@/lib/shared/types";

export function NoteCard({ note, score }: { note: Note; score?: number }) {
  const { m, f, locale } = useI18n();
  const when = new Date(note.createdAt).toLocaleString(locale === "tr" ? "tr-TR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <article lang={note.language} className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="t-label">{when}</p>
        <p className="t-label">{m.notes.sources[note.source]}</p>
        {note.source === "mark" ? (
          <span className="t-mono rounded-full border border-[var(--hairline-strong)] px-2 py-0.5 text-[0.68rem] uppercase tracking-wider text-paper">
            {m.notes.marked}
          </span>
        ) : null}
        {score !== undefined ? <span className="t-mono ml-auto text-[0.7rem] text-fog">{f(m.notes.match, { n: score.toFixed(3) })}</span> : null}
      </div>
      <h3 className="mt-2 text-[1.15rem] leading-snug">{note.title}</h3>
      <p className="mt-2 leading-relaxed text-mist">{note.summary}</p>
      {note.action_items.length ? (
        <div className="mt-3">
          <p className="t-label">{m.notes.actionItems}</p>
          <ul className="mt-1.5 space-y-1">
            {note.action_items.map((a) => (
              <li key={a} className="flex gap-2 text-[0.95rem]">
                <span aria-hidden="true" className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-mist" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {note.topics.length || note.people_mentioned.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {note.topics.map((t) => (
            <span key={`t-${t}`} className="rounded-full bg-well-2 px-2.5 py-1 text-[0.8rem] text-mist">
              {t}
            </span>
          ))}
          {note.people_mentioned.map((p) => (
            <span key={`p-${p}`} className="rounded-full border border-[var(--hairline-strong)] px-2.5 py-1 text-[0.8rem]">
              {p}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
