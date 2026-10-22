"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { SpeechLanguagePicker } from "@/components/assistant/AssistantControls";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { fmtMs } from "@/components/ui/Readout";
import { useI18n } from "@/components/providers/AppProviders";
import { assistant } from "@/lib/client/assistant";
import { setPrefs } from "@/lib/client/prefs";
import { useStore } from "@/lib/client/store";

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : `${s} s`;
}

export function FirstReplyStep({ onBack }: { onBack: () => void }) {
  const { m, f } = useI18n();
  const router = useRouter();
  const view = useStore(assistant.view);
  const answered = view.turns.find((t) => t.status === "done" || t.status === "speaking");

  useEffect(() => {
    assistant.setOnboarding(true);
    return () => assistant.setOnboarding(false);
  }, []);

  const finish = () => {
    setPrefs({ setupDone: true });
    router.push("/assistant");
  };

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-[1.35rem]">{m.setup.first.title}</h2>
        <p className="mt-2 text-mist">{m.setup.first.prompt}</p>
        <div className="mt-5">
          <SpeechLanguagePicker />
        </div>
      </Card>

      <AssistantPanel compact maxTurns={2} />

      {answered?.latencyMs !== undefined ? (
        <Card>
          <p className="t-mono text-[0.95rem]">{f(m.setup.first.elapsed, { s: fmtMs(answered.latencyMs) })}</p>
          {view.onboardingMs !== null ? (
            <p className="t-mono mt-1.5 text-[0.95rem] text-mist">
              {f(m.setup.first.sinceLanding, { t: fmtDuration(view.onboardingMs) })}
            </p>
          ) : null}
          <p className="mt-3 text-[0.88rem] text-fog">{m.setup.first.didntHear}</p>
        </Card>
      ) : null}

      <div className="flex justify-between">
        <Button variant="ghost" icon="back" onClick={onBack}>
          {m.common.back}
        </Button>
        <Button variant={answered ? "primary" : "secondary"} size="lg" iconRight="arrow" onClick={finish}>
          {answered ? m.setup.first.finish : m.common.skip}
        </Button>
      </div>
    </div>
  );
}
