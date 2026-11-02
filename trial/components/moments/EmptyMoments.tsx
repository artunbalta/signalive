"use client";

import { useI18n } from "@/components/providers/AppProviders";
import styles from "./motion.module.css";

/**
 * Before the first moment: what a clench does, in three steps, and what
 * stands in for it without Signalive earbuds.
 */
export function EmptyMoments() {
  const { m } = useI18n();
  return (
    <section className="mt-8 flex flex-col items-center text-center sm:mt-12" aria-labelledby="moments-empty-title">
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true" className="rise overflow-visible">
        <circle cx="66" cy="66" r="62" fill="none" stroke="rgba(255,255,249,0.16)" className={styles.ripple2} />
        <circle cx="66" cy="66" r="50" fill="none" stroke="rgba(255,255,249,0.28)" className={styles.ripple} />
        <circle cx="66" cy="66" r="36" fill="var(--color-well-2)" stroke="var(--hairline-strong)" strokeWidth="1.5" />
        <path
          d="M58.5 52.5h15v27l-7.5-5.5-7.5 5.5v-27Z"
          fill="none"
          stroke="var(--color-paper)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          className={styles.jaw}
        />
      </svg>
      <h2 id="moments-empty-title" className="t-display rise rise-1 mt-8 max-w-[17ch] text-[clamp(1.75rem,6vw,2.35rem)] leading-[1.06]">
        {m.moments.empty.title}
      </h2>
      <p className="rise rise-2 mt-4 max-w-[46ch] text-[1rem] leading-relaxed text-mist">{m.moments.empty.body}</p>
      <ol className="rise rise-3 mt-8 grid w-full max-w-[600px] gap-3.5 border-t border-[var(--hairline)] pt-5 text-left sm:grid-cols-3 sm:gap-5">
        {m.moments.empty.steps.map((step, i) => (
          <li key={step} className="flex items-baseline gap-3">
            <span className="t-mono text-[0.75rem] text-fog">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-[0.95rem] leading-snug">{step}</span>
          </li>
        ))}
      </ol>
      <p className="rise rise-4 mt-7 max-w-[46ch] text-[0.88rem] leading-relaxed text-fog">{m.moments.empty.keys}</p>
    </section>
  );
}
