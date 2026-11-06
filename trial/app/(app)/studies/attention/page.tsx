"use client";

import { AttentionStudy } from "@/components/studies/AttentionStudy";
import { useI18n } from "@/components/providers/AppProviders";
import { ButtonLink } from "@/components/ui/Button";

/** Research/NEXT.md, experiment 2, on the connected earbuds or a replay of two real people. */
export default function AttentionStudyPage() {
  const { m } = useI18n();
  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="t-display text-[1.9rem]">{m.studies.attention.title}</h1>
        <ButtonLink href="/studies" variant="ghost" icon="back">
          {m.studies.title}
        </ButtonLink>
      </header>
      <AttentionStudy />
    </div>
  );
}
