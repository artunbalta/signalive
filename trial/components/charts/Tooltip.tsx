"use client";

import { useState, type ReactNode } from "react";

/**
 * Hover and focus details for a chart row. Enhances only: every value it shows
 * is also printed in the row or the table view. Values lead, labels follow.
 */
export function useRowTooltip() {
  const [active, setActive] = useState<string | null>(null);
  const bind = (id: string) => ({
    tabIndex: 0,
    onPointerEnter: () => setActive(id),
    onPointerLeave: () => setActive((a) => (a === id ? null : a)),
    onFocus: () => setActive(id),
    onBlur: () => setActive((a) => (a === id ? null : a)),
  });
  return { active, bind };
}

export function TooltipCard({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute right-0 top-full z-20 mt-1 min-w-[220px] rounded-[10px] border border-[var(--hairline-strong)] bg-well-2 px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
    >
      <dl className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-[0.75rem] text-fog">{r.label}</dt>
            <dd className="t-mono text-[0.8rem] font-medium text-paper">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
