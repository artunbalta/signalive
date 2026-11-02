"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useI18n } from "@/components/providers/AppProviders";
import { Button, Spinner } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { agent, type AskTurn } from "@/lib/client/agent";
import { shortWhen } from "@/lib/client/moments-format";
import { momentsStore, useMoments } from "@/lib/client/moments-store";
import { setPrefs, usePrefs } from "@/lib/client/prefs";
import { useStore } from "@/lib/client/store";
import { ActionCard } from "./ActionCard";
import { Composer } from "./Composer";

/**
 * Ask: a conversation about the moments on this device. Each answer shows
 * the moments it drew on, linked, and what it proposes, waiting for Accept.
 */
export function AskPanel() {
  const { m, f } = useI18n();
  const view = useStore(agent.view);
  const snap = useMoments();
  const prefs = usePrefs();
  const [about, setAbout] = useState<string | null>(null);
  const handled = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  // From a moment's page: ?about=<id> asks about that moment, ?draft=<id>&item=<n> drafts a follow up at once.
  useEffect(() => {
    if (snap.storage === "loading" || handled.current) return;
    handled.current = true;
    const p = new URLSearchParams(window.location.search);
    const draft = p.get("draft");
    const aboutId = p.get("about");
    if (!draft && !aboutId) return;
    window.history.replaceState(null, "", "/ask");
    if (draft) {
      const moment = momentsStore.find(draft);
      const item = moment?.actionItems[Number(p.get("item"))];
      if (moment && item) void agent.ask(f(m.moments.detail.draftAsk, { item: item.text }), { focusMomentId: moment.id });
    } else if (aboutId && momentsStore.find(aboutId)) {
      setAbout(aboutId);
    }
  }, [snap.storage, f, m.moments.detail.draftAsk]);

  const turns = view.turns;
  const lastStatus = turns.at(-1)?.status;
  useEffect(() => {
    if (!turns.length) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    end.current?.scrollIntoView({ block: "end", behavior: reduced ? "auto" : "smooth" });
  }, [turns.length, lastStatus]);

  const aboutMoment = about ? (snap.moments.find((x) => x.id === about) ?? null) : null;
  const voiceError = view.voiceError && view.voiceError !== "no_speech" ? view.voiceError : null;

  return (
    <div className="mx-auto max-w-[760px] pb-48">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="t-display text-[1.9rem]">{m.ask.title}</h1>
          {turns.length === 0 ? <p className="mt-3 max-w-[54ch] leading-relaxed text-mist">{m.ask.lead}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-pressed={!!prefs.askSpeakTyped}
            aria-label={m.ask.speakTyped}
            title={m.ask.speakTyped}
            onClick={() => setPrefs({ askSpeakTyped: !prefs.askSpeakTyped })}
            className={`grid h-11 w-11 place-items-center rounded-full border transition-colors duration-200 ${
              prefs.askSpeakTyped ? "border-paper bg-paper text-ink" : "border-[var(--hairline-strong)] text-mist hover:text-paper"
            }`}
          >
            <Icon name="speaker" size={18} />
          </button>
          {turns.length ? (
            <Button variant="ghost" onClick={() => agent.clear()}>
              {m.ask.clear}
            </Button>
          ) : null}
        </div>
      </header>

      {snap.storage !== "loading" && snap.moments.length === 0 ? (
        <div className="mt-6">
          <Callout kind="info" title={m.ask.noMoments} />
        </div>
      ) : null}

      {turns.length === 0 ? (
        <div className="mt-8">
          <ul className="flex flex-col items-start gap-2">
            {m.ask.suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => void agent.ask(s, { focusMomentId: about })}
                  className="min-h-11 rounded-full border border-[var(--hairline-strong)] px-4 py-2 text-left text-[0.95rem] text-mist transition-colors duration-200 hover:border-paper/60 hover:text-paper"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-[54ch] text-[0.88rem] leading-relaxed text-fog">{m.ask.voiceHint}</p>
        </div>
      ) : null}

      <ol className="mt-8 space-y-9" role="log" aria-label={m.ask.title}>
        {turns.map((t) => (
          <Turn key={t.id} turn={t} />
        ))}
      </ol>
      {voiceError ? (
        <div className="mt-6">
          <ErrorCallout code={voiceError} />
        </div>
      ) : null}
      <div ref={end} />
      <Composer about={aboutMoment} onClearAbout={() => setAbout(null)} />
    </div>
  );
}

function Turn({ turn }: { turn: AskTurn }) {
  const { m, f, locale } = useI18n();
  const snap = useMoments();
  const waiting = (turn.status === "pending" || turn.looking) && !turn.reply;
  const cited = turn.cites.map((id) => snap.moments.find((x) => x.id === id)).filter((x) => !!x);
  return (
    <li className="space-y-4">
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-[18px] rounded-br-[6px] bg-well-2 px-4 py-3">
          <p className="sr-only">{m.ask.you}</p>
          <p className="leading-snug">{turn.question}</p>
          {turn.via === "voice" ? (
            <p className="t-mono mt-1.5 flex items-center gap-1.5 text-[0.68rem] text-fog">
              <Icon name="mic" size={11} />
              {m.ask.byVoice}
            </p>
          ) : null}
        </div>
      </div>
      <div className="max-w-[640px]" aria-busy={waiting || undefined}>
        <p className="t-label">{m.ask.them}</p>
        {waiting ? (
          <p className="mt-2 flex items-center gap-2.5 text-mist" role="status">
            <Spinner size={14} />
            {m.ask.thinking}
          </p>
        ) : null}
        {turn.reply ? <p className="mt-2 whitespace-pre-line text-[1.02rem] leading-relaxed">{turn.reply}</p> : null}
        {turn.status === "stopped" && !turn.reply ? <p className="mt-2 text-mist">-</p> : null}
        {turn.status === "error" ? (
          <div className="mt-3">
            <ErrorCallout code={turn.error ?? "generic"} />
          </div>
        ) : null}
        {cited.length ? (
          <div className="mt-4">
            <p className="t-label">{m.ask.from}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {cited.map((x) => (
                <li key={x.id} className="max-w-full">
                  <Link
                    href={`/moments/${x.id}`}
                    className="flex min-h-10 max-w-full items-center gap-2 rounded-full border border-[var(--hairline-strong)] px-3.5 text-[0.86rem] transition-colors duration-200 hover:border-paper/60"
                  >
                    <span className="t-mono shrink-0 text-[0.7rem] text-fog">{shortWhen(x.createdAt, locale)}</span>
                    <span className="truncate">{x.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {turn.actions.length ? (
          <ul className="mt-4 space-y-3">
            {turn.actions.map((a) => (
              <li key={a.id}>
                <ActionCard action={a} />
              </li>
            ))}
          </ul>
        ) : null}
        {turn.status === "done" && turn.context ? (
          <p className="t-mono mt-3 text-[0.68rem] text-fog">{f(m.ask.contextNote, { n: turn.context })}</p>
        ) : null}
      </div>
    </li>
  );
}
