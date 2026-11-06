"use client";

import { ClenchStudy } from "@/components/studies/ClenchStudy";
import { useI18n } from "@/components/providers/AppProviders";
import { ButtonLink } from "@/components/ui/Button";

/** Research/NEXT.md, experiment 1, run on the connected earbuds. */
export default function ClenchStudyPage() {
  const { m } = useI18n();
  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="t-display text-[1.9rem]">{m.studies.clench.title}</h1>
        <ButtonLink href="/studies" variant="ghost" icon="back">
          {m.studies.title}
        </ButtonLink>
      </header>
      <ClenchStudy />
    </div>
  );
}
