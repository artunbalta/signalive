"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionCard } from "@/components/ask/ActionCard";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useI18n } from "@/components/providers/AppProviders";
import { Button, Spinner } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { copyText } from "@/lib/client/agent";
import { formatDateTime, formatDue, momentShareText } from "@/lib/client/moments-format";
import { addToCalendar, eventItem, reminderItem } from "@/lib/client/moments-ics";
import { moments } from "@/lib/client/moments";
import { momentsStore, useMoments } from "@/lib/client/moments-store";
import { useStore } from "@/lib/client/store";
import type { Moment } from "@/lib/shared/moments";

/**
 * One moment: when and where, the summary, the key points, what to do (each
 * with Remind me, Add to calendar and Draft), what Ask suggested, the people
 * and topics, and what was said. Share and Delete act on the whole moment.
 */
export function MomentDetail({ id }: { id: string }) {
  const { m, f, locale } = useI18n();
  const d = m.moments.detail;
  const router = useRouter();
  const snap = useMoments();
  const moment = snap.moments.find((x) => x.id === id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const readingState = useStore(moments.view).reading;
  const reading = readingState?.id === id && readingState.state !== "error" ? readingState : null;
  const readingError = readingState?.id === id && readingState.state === "error" ? readingState.error : null;

  // Leaving the moment stops reading it.
  useEffect(() => () => {
    if (moments.view.get().reading?.id === id) moments.stopSpeaking();
  }, [id]);

  if (snap.storage === "loading") return null;
  if (!moment) {
    return (
      <div className="mx-auto max-w-[760px] space-y-6">
        <BackLink label={d.back} />
        <Callout kind="info" title={d.notFound}>
          {d.notFoundBody}
        </Callout>
      </div>
    );
  }

  async function share(x: Moment) {
    const text = momentShareText(x, locale, { keyPoints: d.keyPoints, actionItems: d.actionItems, footer: m.moments.share.footer });
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: x.title, text });
        setStatus(d.shared);
      } else {
        await copyText(text);
        setStatus(d.copied);
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name !== "AbortError") setStatus(`${m.errors.generic.title} ${m.errors.generic.action}`);
    }
  }

  async function remove() {
    await momentsStore.remove(id);
    router.push("/moments");
  }

  const place = moment.place;
  const mapUrl = place ? `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}` : null;
  const suggested = moment.actions;

  return (
    <article className="mx-auto max-w-[760px] pb-10">
      <BackLink label={d.back} />

      <header className="rise mt-6">
        <p className="t-mono text-[0.75rem] text-fog">
          {formatDateTime(moment.createdAt, locale)}
          {place?.name ? ` · ${place.name}` : ""}
        </p>
        <h1 lang={moment.language} className="t-display mt-3 text-[clamp(1.85rem,5.4vw,2.5rem)] leading-[1.06]">
          {moment.title || m.moments.title}
        </h1>
        {moment.summary ? (
          <p lang={moment.language} className="mt-4 max-w-[62ch] text-[1.05rem] leading-relaxed text-mist">
            {moment.summary}
          </p>
        ) : null}
      </header>

      <div className="rise rise-1 mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className={ROW_BUTTON}
          aria-pressed={!!reading}
          aria-busy={reading?.state === "loading" || undefined}
          onClick={() => void moments.read(moment, { actionItems: d.actionItems })}
        >
          {reading?.state === "loading" ? <Spinner size={14} /> : <Icon name={reading ? "stop" : "speaker"} size={16} />}
          {reading ? d.stopListening : d.listen}
        </button>
        <button type="button" className={ROW_BUTTON} onClick={() => void share(moment)}>
          <Icon name="share" size={16} />
          {d.share}
        </button>
        <Link href={`/ask?about=${encodeURIComponent(moment.id)}`} className={ROW_BUTTON}>
          <Icon name="ask" size={16} />
          {d.askAbout}
        </Link>
      </div>
      {status ? (
        <p role="status" className="mt-3 text-[0.88rem] text-mist">
          {status}
        </p>
      ) : null}
      {readingError ? (
        <div className="mt-4">
          <ErrorCallout code={readingError} />
        </div>
      ) : null}

      {moment.keyPoints.length ? (
        <section className="rise rise-2 mt-10" aria-labelledby="key-points">
          <h2 id="key-points" className="t-label">
            {d.keyPoints}
          </h2>
          <ul lang={moment.language} className="mt-3 space-y-2.5">
            {moment.keyPoints.map((p) => (
              <li key={p} className="flex gap-3 leading-relaxed">
                <span aria-hidden="true" className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-mist" />
                {p}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {moment.actionItems.length ? (
        <section className="rise rise-3 mt-10" aria-labelledby="to-do">
          <h2 id="to-do" className="t-label">
            {d.actionItems}
          </h2>
          <ul className="mt-3 space-y-3">
            {moment.actionItems.map((item, i) => (
              <li key={`${i}-${item.text}`}>
                <ActionItemRow moment={moment} index={i} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {suggested.length ? (
        <section className="mt-10" aria-labelledby="suggested">
          <h2 id="suggested" className="t-label">
            {d.suggestions}
          </h2>
          <ul className="mt-3 space-y-3">
            {suggested.map((a) => (
              <li key={a.id}>
                <ActionCard action={a} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {moment.people.length || moment.topics.length ? (
        <section className="mt-10 grid gap-6 sm:grid-cols-2">
          {moment.people.length ? (
            <div>
              <h2 className="t-label">{d.people}</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {moment.people.map((p) => (
                  <li key={p}>
                    <Link
                      href={`/moments?person=${encodeURIComponent(p)}`}
                      className="flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--hairline-strong)] px-3.5 text-[0.88rem] hover:border-paper/60"
                    >
                      <Icon name="person" size={14} />
                      {p}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {moment.topics.length ? (
            <div>
              <h2 className="t-label">{d.topics}</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {moment.topics.map((t) => (
                  <li key={t}>
                    <Link
                      href={`/moments?topic=${encodeURIComponent(t)}`}
                      className="flex min-h-10 items-center rounded-full bg-well-2 px-3.5 text-[0.88rem] text-mist hover:text-paper"
                    >
                      {t}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-10 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well p-5" aria-labelledby="transcript">
        <h2 id="transcript" className="t-label">
          {d.transcript}
        </h2>
        <p lang={moment.language} className="mt-3 whitespace-pre-line text-[0.98rem] leading-relaxed text-mist">
          {moment.transcript || "-"}
        </p>
        <div className="t-mono mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--hairline)] pt-3 text-[0.72rem] text-fog">
          <span>{d.trigger[moment.trigger]}</span>
          <span>{f(m.common.seconds, { n: Math.round(moment.seconds) })}</span>
          {mapUrl ? (
            <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mist underline-offset-4 hover:text-paper hover:underline">
              <Icon name="pin" size={12} />
              {d.map}
            </a>
          ) : null}
        </div>
        <p className="mt-2 text-[0.8rem] text-fog">{f(d.transcriptNote, { n: Math.round(moment.seconds) })}</p>
      </section>

      <div className="mt-8 border-t border-[var(--hairline)] pt-6">
        {!confirmDelete ? (
          <Button variant="ghost" icon="trash" className="-ml-5" onClick={() => setConfirmDelete(true)}>
            {d.delete}
          </Button>
        ) : (
          <div className="rounded-[12px] border border-[var(--hairline-strong)] bg-well-2 p-4" role="alertdialog" aria-label={d.deleteConfirm}>
            <p className="font-medium">{d.deleteConfirm}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" icon="trash" onClick={() => void remove()}>
                {d.deleteYes}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                {m.common.cancel}
              </Button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link href="/moments" className="-ml-1 inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-[0.95rem] text-mist hover:text-paper">
      <Icon name="back" size={18} />
      {label}
    </Link>
  );
}

const ROW_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--hairline-strong)] px-3.5 text-[0.88rem] transition-colors duration-200 hover:border-paper/60 disabled:pointer-events-none disabled:opacity-40";

/** One thing to do, with its due date and three ways to act on it. */
function ActionItemRow({ moment, index }: { moment: Moment; index: number }) {
  const { m, f, locale } = useI18n();
  const d = m.moments.detail;
  const item = moment.actionItems[index]!;
  const due = formatDue(item.due, locale);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"remind" | "calendar" | null>(null);

  async function calendar(kind: "remind" | "calendar") {
    setBusy(kind);
    try {
      const uid = `${moment.id}-${index}-${kind}`;
      const item2 =
        kind === "calendar"
          ? (eventItem({ title: item.text, start: item.due }, { uid, notes: moment.title }) ??
            reminderItem(item.text, null, { now: new Date(), uid, notes: moment.title }))
          : reminderItem(item.text, item.due, { now: new Date(), uid, notes: moment.title });
      const where = await addToCalendar(kind === "calendar" ? { ...item2, kind: "event" } : item2);
      setStatus(where === "native" ? d.calendarAdded : d.calendarFile);
    } catch {
      setStatus(`${m.errors.generic.title} ${m.errors.generic.action}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well p-4 sm:p-5">
      <div className="flex gap-3">
        <span aria-hidden="true" className="mt-[0.4em] h-3.5 w-3.5 shrink-0 rounded-[4px] border border-mist" />
        <div className="min-w-0 flex-1">
          <p lang={moment.language} className="leading-snug">
            {item.text}
          </p>
          {due ? <p className="t-mono mt-1 text-[0.75rem] text-fog">{f(d.dueAt, { when: due })}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-[1.625rem]">
        <button type="button" className={ROW_BUTTON} disabled={!!busy} aria-busy={busy === "remind" || undefined} onClick={() => void calendar("remind")}>
          {busy === "remind" ? <Spinner size={14} /> : <Icon name="bell" size={16} />}
          {d.remindMe}
        </button>
        <button type="button" className={ROW_BUTTON} disabled={!!busy} aria-busy={busy === "calendar" || undefined} onClick={() => void calendar("calendar")}>
          {busy === "calendar" ? <Spinner size={14} /> : <Icon name="calendar" size={16} />}
          {d.addToCalendar}
        </button>
        <Link href={`/ask?draft=${encodeURIComponent(moment.id)}&item=${index}`} className={ROW_BUTTON}>
          <Icon name="pencil" size={16} />
          {d.draft}
        </Link>
      </div>
      {status ? (
        <p role="status" className="mt-2.5 pl-[1.625rem] text-[0.85rem] text-mist">
          {status}
        </p>
      ) : null}
    </div>
  );
}
