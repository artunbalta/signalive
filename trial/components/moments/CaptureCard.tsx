"use client";

import { ErrorCallout } from "@/components/ErrorCallout";
import { useI18n } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { moments, type Capture } from "@/lib/client/moments";
import { formatTime } from "@/lib/client/moments-format";
import styles from "./motion.module.css";

const STEPS = ["listening_back", "writing"] as const;

/**
 * A moment on its way, at the top of the feed: the seconds it is made from,
 * the stage it is at ("Listening back", then "Writing it down"), the words
 * as soon as they are recognized, and a second try when it fails.
 */
export function CaptureCard({ capture }: { capture: Capture }) {
  const { m, f, locale } = useI18n();
  const working = capture.stage === "listening_back" || capture.stage === "writing";
  const step = capture.stage === "writing" ? 1 : 0;
  return (
    <article
      role="status"
      aria-busy={working || undefined}
      className={`relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline-strong)] bg-well p-5 ${styles.lift}`}
    >
      {working ? <span className={styles.working} aria-hidden="true" /> : null}
      <p className="t-mono text-[0.72rem] text-fog">
        {formatTime(capture.at, locale)} · {f(m.moments.stageDetail, { n: Math.round(capture.seconds) })}
      </p>
      <p className="mt-2 text-[1.12rem] leading-snug">{m.moments.stages[capture.stage]}</p>
      {working ? (
        <ol className="mt-3 flex items-center gap-2" aria-hidden="true">
          {STEPS.map((s, i) => (
            <li key={s} className={`h-[3px] w-10 rounded-full transition-colors duration-500 ${i <= step ? "bg-paper/80" : "bg-[var(--hairline-strong)]"}`} />
          ))}
        </ol>
      ) : null}
      {capture.transcript ? (
        <p className="mt-3 line-clamp-2 text-[0.92rem] leading-relaxed text-mist">&ldquo;{capture.transcript}&rdquo;</p>
      ) : null}
      {capture.stage === "error" ? (
        <div className="mt-4 space-y-3">
          <ErrorCallout code={capture.error ?? "generic"} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="rewind" onClick={() => moments.retry(capture.id)}>
              {m.moments.retry}
            </Button>
            <Button variant="ghost" onClick={() => moments.dismiss(capture.id)}>
              {m.moments.dismiss}
            </Button>
          </div>
        </div>
      ) : null}
      {capture.stage === "no_speech" ? (
        <div className="mt-3">
          <Button variant="ghost" className="-ml-5" onClick={() => moments.dismiss(capture.id)}>
            {m.moments.dismiss}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
