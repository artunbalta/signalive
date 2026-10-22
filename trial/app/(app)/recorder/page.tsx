"use client";

import { Button } from "@/components/ui/Button";
import { Callout, Card, SectionTitle } from "@/components/ui/Card";
import { ErrorCallout } from "@/components/ErrorCallout";
import { NoteCard } from "@/components/notes/NoteCard";
import { RawAudioToggle } from "@/components/notes/RawAudioToggle";
import { useI18n } from "@/components/providers/AppProviders";
import { recorder } from "@/lib/client/recorder";
import { useStore } from "@/lib/client/store";

export default function RecorderPage() {
  const { m, f, locale } = useI18n();
  const v = useStore(recorder.view);
  const running = v.state === "on" || v.state === "paused";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <header>
        <h1 className="t-display text-[1.9rem]">{m.recorder.title}</h1>
        <p className="mt-2 max-w-2xl text-mist">{m.recorder.lead}</p>
      </header>

      <Card>
        {!running ? (
          <div className="space-y-4">
            <Button
              variant="primary"
              size="lg"
              icon="wave"
              busy={v.state === "starting" || v.state === "stopping"}
              onClick={() => void recorder.start()}
            >
              {v.state === "starting" ? m.recorder.vadLoading : m.recorder.start}
            </Button>
            <p className="text-[0.9rem] text-mist">{m.recorder.othersReminder}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3" role="status">
              {v.state === "on" ? <span className="rec-dot" aria-hidden="true" /> : <span className="h-2.5 w-2.5 rounded-full border border-mist" aria-hidden="true" />}
              <p className="font-medium">{v.state === "on" ? m.status.recording : m.status.recordingPaused}</p>
              {v.state === "on" && v.speaking ? (
                <span className="t-mono text-[0.75rem] text-mist">{m.status.states.hearing}</span>
              ) : null}
              {v.pending ? <span className="t-mono ml-auto text-[0.75rem] text-fog">{f(m.recorder.pending, { n: v.pending })}</span> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button variant="primary" size="lg" icon="flag" busy={v.marking} onClick={() => void recorder.mark()} className="w-full">
                {v.marking ? m.recorder.marked : m.recorder.mark}
              </Button>
              <Button size="lg" icon="notes" busy={v.makingNotes} onClick={() => void recorder.makeNotes("on_demand")} className="w-full">
                {v.makingNotes ? m.recorder.makingNotes : m.recorder.makeNotes}
              </Button>
            </div>
            <p className="-mt-2 text-[0.85rem] text-fog">{m.recorder.markHint}</p>
            <div className="flex flex-wrap gap-3 border-t border-[var(--hairline)] pt-4">
              <Button icon={v.state === "on" ? "pause" : "play"} onClick={() => (v.state === "on" ? recorder.pause() : recorder.resume())}>
                {v.state === "on" ? m.recorder.pause : m.recorder.resume}
              </Button>
              <Button variant="ghost" icon="stop" onClick={() => void recorder.stop()}>
                {m.recorder.stop}
              </Button>
            </div>
            <p className="text-[0.85rem] text-fog">{m.recorder.handsFreeConflict}</p>
          </div>
        )}
        {v.error ? (
          <div className="mt-4">
            <ErrorCallout code={v.error} />
          </div>
        ) : null}
        {v.failed ? (
          <div className="mt-4">
            <Callout kind="warn" title={m.recorder.segmentFailed} />
          </div>
        ) : null}
      </Card>

      <Card>
        <RawAudioToggle />
      </Card>

      {v.notes.length ? (
        <section>
          <SectionTitle title={f(m.recorder.notesMade, { n: v.notes.length })} />
          <div className="space-y-3">
            {v.notes.map((n) => (
              <NoteCard key={n.id} note={n} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-live="polite">
        <SectionTitle title={m.recorder.transcript} />
        {v.utterances.length === 0 ? (
          <p className="text-mist">{m.recorder.emptyTranscript}</p>
        ) : (
          <ol className="divide-y divide-[var(--hairline)] rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well">
            {[...v.utterances].reverse().map((u) => (
              <li key={u.id} className="flex gap-4 px-4 py-3" lang={u.language ?? undefined}>
                <span className="t-mono shrink-0 pt-0.5 text-[0.72rem] text-fog">{fmt(u.startedAt)}</span>
                <span className="leading-relaxed">{u.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
