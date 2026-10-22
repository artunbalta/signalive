"use client";

import { AssistantControls } from "@/components/assistant/AssistantControls";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { EarbudButtons } from "@/components/assistant/EarbudButtons";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/components/providers/AppProviders";
import { assistant } from "@/lib/client/assistant";

export default function AssistantPage() {
  const { m } = useI18n();
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="assistant-title">
        <div className="mb-4 flex items-center justify-between">
          <h1 id="assistant-title" className="t-display text-[1.9rem]">{m.assistant.title}</h1>
          <Button variant="ghost" onClick={() => assistant.clear()}>{m.assistant.clear}</Button>
        </div>
        <AssistantPanel />
      </section>
      <aside className="space-y-5">
        <AssistantControls />
        <EarbudButtons />
      </aside>
    </div>
  );
}
