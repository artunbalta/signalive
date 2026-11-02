"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useI18n } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { facetsOf, hasFacet, momentMatches, type Facet } from "@/lib/client/agent-context";
import { moments } from "@/lib/client/moments";
import { dayKey, formatDay } from "@/lib/client/moments-format";
import { useMoments } from "@/lib/client/moments-store";
import { rewind } from "@/lib/client/rewind";
import { useStore } from "@/lib/client/store";
import type { Moment } from "@/lib/shared/moments";
import { CaptureCard } from "./CaptureCard";
import { CaptureDock } from "./CaptureDock";
import { EmptyMoments } from "./EmptyMoments";
import { MomentCard } from "./MomentCard";

const OWN_ERRORS = new Set(["rewind_off", "rewind_empty"]);

/**
 * The home screen after setup: every moment kept on this device, newest
 * first and grouped by day, with the one being kept now on top. Search
 * looks through everything a moment holds; people and topics filter.
 */
export function MomentsHome() {
  const { m, f, locale } = useI18n();
  const snap = useMoments();
  const cap = useStore(moments.view);
  const rw = useStore(rewind.view);
  const [query, setQuery] = useState("");
  const [facet, setFacet] = useState<Pick<Facet, "kind" | "value"> | null>(null);

  // A person or topic picked on a moment's page arrives as ?person= or ?topic=.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const person = p.get("person");
    const topic = p.get("topic");
    if (person) setFacet({ kind: "person", value: person });
    else if (topic) setFacet({ kind: "topic", value: topic });
  }, []);

  const facets = useMemo(() => facetsOf(snap.moments), [snap.moments]);
  const shown = useMemo(
    () => snap.moments.filter((x) => (!facet || hasFacet(x, facet)) && momentMatches(x, query)),
    [snap.moments, facet, query],
  );
  const groups = useMemo(() => {
    const now = new Date();
    const out: { key: string; label: string; items: Moment[] }[] = [];
    for (const x of shown) {
      const key = dayKey(x.createdAt);
      const last = out.at(-1);
      if (last?.key === key) last.items.push(x);
      else out.push({ key, label: formatDay(x.createdAt, locale, now, m.moments), items: [x] });
    }
    return out;
  }, [shown, locale, m.moments]);

  const working = cap.captures.filter((c) => c.stage !== "saved");
  const arriving = new Set(cap.captures.filter((c) => c.stage === "saved").map((c) => c.id));
  const filtering = !!query.trim() || !!facet;
  const loading = snap.storage === "loading";
  const empty = !loading && snap.moments.length === 0 && working.length === 0;
  const micError = rw.phase === "off" && rw.error && !OWN_ERRORS.has(rw.error) ? rw.error : null;
  const chips = [...facets.people, ...facets.topics];

  const clearFilters = () => {
    setFacet(null);
    setQuery("");
    if (window.location.search) window.history.replaceState(null, "", "/moments");
  };

  return (
    <div className="mx-auto max-w-[760px] pb-40">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="t-display text-[1.9rem]">{m.moments.title}</h1>
        {snap.moments.length ? <p className="t-label pb-2">{f(m.moments.count, { n: snap.moments.length })}</p> : null}
      </header>

      {snap.storage === "memory" || snap.writeFailed || micError ? (
        <div className="mt-5 space-y-3">
          {snap.storage === "memory" ? (
            <Callout kind="warn" title={m.moments.memoryTitle}>
              {m.moments.memoryBody}
            </Callout>
          ) : null}
          {snap.writeFailed ? <Callout kind="warn" title={m.moments.writeFailed} /> : null}
          {micError ? <ErrorCallout code={micError} /> : null}
        </div>
      ) : null}

      {snap.moments.length > 0 ? (
        <div className="mt-6 space-y-3">
          <label className="relative block">
            <span className="sr-only">{m.moments.search}</span>
            <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fog" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.moments.search}
              enterKeyHint="search"
              className="min-h-12 w-full rounded-full border border-[var(--hairline-strong)] bg-well py-3 pl-11 pr-5 text-[1rem] placeholder:text-fog"
            />
          </label>
          {chips.length ? (
            <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
              <ul className="flex w-max gap-2 pb-1" aria-label={`${m.moments.people}, ${m.moments.topics}`}>
                {chips.map((c) => {
                  const on = facet?.kind === c.kind && facet.value === c.value;
                  return (
                    <li key={`${c.kind}:${c.value}`}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setFacet(on ? null : { kind: c.kind, value: c.value })}
                        className={`flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[0.86rem] transition-colors duration-200 ${
                          on ? "border-paper bg-paper text-ink" : "border-[var(--hairline-strong)] text-mist hover:text-paper"
                        }`}
                      >
                        {c.kind === "person" ? <Icon name="person" size={14} /> : null}
                        {c.value}
                        <span className={`t-mono text-[0.68rem] ${on ? "text-ink/60" : "text-fog"}`}>{c.count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {facet && !chips.some((c) => c.kind === facet.kind && c.value === facet.value) ? (
            <p className="flex items-center gap-2 text-[0.9rem] text-mist">
              <Icon name={facet.kind === "person" ? "person" : "search"} size={15} />
              {facet.value}
            </p>
          ) : null}
        </div>
      ) : null}

      {working.length ? (
        <div className="mt-6 space-y-3" aria-live="polite">
          {working.map((c) => (
            <CaptureCard key={c.id} capture={c} />
          ))}
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.key} className="mt-8" aria-labelledby={`day-${g.key}`}>
          <h2 id={`day-${g.key}`} className="t-label mb-3">
            {g.label}
          </h2>
          <ul className="space-y-3">
            {g.items.map((x) => (
              <li key={x.id}>
                <MomentCard moment={x} arriving={arriving.has(x.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {filtering ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {shown.length === 0 ? <p className="text-mist">{m.moments.noResults}</p> : null}
          <Button variant="ghost" icon="close" className="-ml-3" onClick={clearFilters}>
            {m.moments.showAll}
          </Button>
        </div>
      ) : null}

      {empty ? <EmptyMoments /> : null}
      <CaptureDock />
    </div>
  );
}
