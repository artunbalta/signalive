"use client";

import Link from "next/link";
import { useI18n } from "@/components/providers/AppProviders";
import { Icon } from "@/components/ui/Icon";

/**
 * The experiments research/NEXT.md sets the first dev kit, each ready to
 * run on whatever earbuds are connected, scored against its bar.
 */
export default function StudiesPage() {
  const { m } = useI18n();
  const studies = [
    { href: "/studies/clench", copy: m.studies.clench, icon: "moment" as const },
    { href: "/studies/attention", copy: m.studies.attention, icon: "focus" as const },
  ];
  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <header>
        <h1 className="t-display text-[1.9rem]">{m.studies.title}</h1>
        <p className="mt-3 max-w-[62ch] leading-relaxed text-mist">{m.studies.lead}</p>
      </header>
      <ul className="grid gap-4">
        {studies.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="group block rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well p-5 transition-colors duration-200 hover:border-[var(--hairline-strong)] sm:p-6"
            >
              <div className="flex items-start gap-4">
                <Icon name={s.icon} size={24} className="mt-1 text-mist" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[1.25rem] leading-tight">{s.copy.title}</h2>
                  <p className="mt-2 leading-relaxed text-mist">{s.copy.summary}</p>
                  <p className="mt-2 text-[0.9rem] text-fog">{s.copy.bars}</p>
                </div>
                <Icon name="chevron" size={20} className="mt-1 text-fog transition-transform duration-200 group-hover:translate-x-0.5" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <p className="max-w-[62ch] text-[0.9rem] leading-relaxed text-fog">{m.studies.note}</p>
    </div>
  );
}
