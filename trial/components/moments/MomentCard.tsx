"use client";

import Link from "next/link";
import { useI18n } from "@/components/providers/AppProviders";
import { Icon } from "@/components/ui/Icon";
import { formatDue, whenWhere } from "@/lib/client/moments-format";
import type { Moment } from "@/lib/shared/moments";
import styles from "./motion.module.css";

/** At most this many to-do chips on a card; the rest are counted. */
const CHIPS = 2;

/**
 * One moment in the feed: when and where in mono, the title, the summary,
 * and what to do as chips. The whole card opens the moment.
 */
export function MomentCard({ moment, arriving = false }: { moment: Moment; arriving?: boolean }) {
  const { m, f, locale } = useI18n();
  const items = moment.actionItems;
  const accepted = moment.actions.find((a) => a.status === "accepted");
  return (
    <article
      className={`relative rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well p-5 transition-colors duration-200 hover:border-[var(--hairline-strong)] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-signal ${
        arriving ? styles.arrive : ""
      }`}
    >
      <p className="t-mono truncate text-[0.72rem] text-fog">{whenWhere(moment, locale)}</p>
      <h3 lang={moment.language} className="mt-2 text-[1.12rem] leading-snug">
        <Link
          href={`/moments/${moment.id}`}
          className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] after:content-[''] focus-visible:outline-none"
        >
          {moment.title || m.moments.title}
        </Link>
      </h3>
      {moment.summary ? (
        <p lang={moment.language} className="mt-1.5 line-clamp-3 text-[0.95rem] leading-relaxed text-mist">
          {moment.summary}
        </p>
      ) : null}
      {items.length || accepted ? (
        <ul className="mt-3.5 flex flex-wrap gap-1.5" aria-label={m.moments.detail.actionItems}>
          {items.slice(0, CHIPS).map((a, i) => {
            const due = formatDue(a.due, locale);
            return (
              <li
                key={`${i}-${a.text}`}
                className="flex max-w-full items-center gap-2 rounded-full border border-[var(--hairline-strong)] py-1 pl-2.5 pr-3 text-[0.8rem] leading-tight"
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px] border border-mist" />
                <span lang={moment.language} className="truncate">
                  {a.text}
                </span>
                {due ? <span className="t-mono shrink-0 text-[0.7rem] text-fog">{due}</span> : null}
              </li>
            );
          })}
          {items.length > CHIPS ? (
            <li className="t-mono rounded-full px-2 py-1 text-[0.72rem] text-fog">{f(m.moments.moreItems, { n: items.length - CHIPS })}</li>
          ) : null}
          {accepted ? (
            <li className="flex items-center gap-1.5 rounded-full bg-well-2 px-2.5 py-1 text-[0.78rem] text-mist">
              <Icon name="check" size={13} />
              {m.ask.action.accepted[accepted.kind]}
            </li>
          ) : null}
        </ul>
      ) : null}
    </article>
  );
}
