"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { ErrorCallout } from "@/components/ErrorCallout";
import { NoteCard } from "@/components/notes/NoteCard";
import { useI18n } from "@/components/providers/AppProviders";
import { api, ApiError } from "@/lib/client/api";
import type { Note, NoteSearchHit, SearchMode } from "@/lib/shared/types";

export default function NotesPage() {
  const { m } = useI18n();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [notes, setNotes] = useState<Note[]>([]);
  const [hits, setHits] = useState<NoteSearchHit[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (before?: string) => {
    setLoading(true);
    try {
      const page = await api<Note[]>(`/api/notes?limit=20${before ? `&before=${encodeURIComponent(before)}` : ""}`);
      setNotes((prev) => (before ? [...prev, ...page] : page));
      setMore(page.length === 20);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "network");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        setHits(
          await api<NoteSearchHit[]>(`/api/notes/search?q=${encodeURIComponent(q)}&mode=${mode}`, { signal: ctrl.signal }),
        );
        setError(null);
      } catch (err) {
        if (!ctrl.signal.aborted) setError(err instanceof ApiError ? err.code : "network");
      }
    }, 280);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, mode]);

  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <h1 className="t-display text-[1.9rem]">{m.notes.title}</h1>
      <div className="space-y-3">
        <label className="relative block">
          <span className="sr-only">{m.notes.search}</span>
          <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fog" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.notes.search}
            className="min-h-13 w-full rounded-full border border-[var(--hairline-strong)] bg-well py-3.5 pl-11 pr-5 text-[1rem] placeholder:text-fog"
          />
        </label>
        <Segmented<SearchMode>
          label={m.notes.search}
          value={mode}
          onChange={setMode}
          options={[
            { value: "hybrid", label: m.notes.modes.hybrid },
            { value: "text", label: m.notes.modes.text },
            { value: "semantic", label: m.notes.modes.semantic },
          ]}
        />
      </div>

      {error ? <ErrorCallout code={error} /> : null}

      {hits ? (
        hits.length ? (
          <div className="space-y-3">
            {hits.map((h) => (
              <NoteCard key={h.note.id} note={h.note} score={h.score} />
            ))}
          </div>
        ) : (
          <p className="text-mist">{m.notes.noResults}</p>
        )
      ) : notes.length ? (
        <div className="space-y-3">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
          {more ? (
            <Button busy={loading} onClick={() => void loadPage(notes.at(-1)?.createdAt)}>
              {m.notes.loadMore}
            </Button>
          ) : null}
        </div>
      ) : loading ? null : (
        <p className="text-mist">{m.notes.empty}</p>
      )}
    </div>
  );
}
