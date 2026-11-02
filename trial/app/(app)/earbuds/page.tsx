"use client";

import { EarbudsCard } from "@/components/earbuds/EarbudsCard";
import { GestureBindings } from "@/components/earbuds/GestureBindings";
import { useI18n } from "@/components/providers/AppProviders";

/** The earbuds: connect them (or their simulation), then choose what each gesture does. */
export default function EarbudsPage() {
  const { m } = useI18n();
  return (
    <div className="mx-auto max-w-[760px] space-y-8">
      <header>
        <h1 className="t-display text-[1.9rem]">{m.earbuds.pageTitle}</h1>
        <p className="mt-3 max-w-[60ch] leading-relaxed text-mist">{m.earbuds.pageLead}</p>
      </header>
      <EarbudsCard />
      <GestureBindings />
    </div>
  );
}
