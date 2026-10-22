"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Segmented, Toggle } from "@/components/ui/Controls";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { assistant } from "@/lib/client/assistant";
import { live } from "@/lib/client/live";
import { setPrefs, usePrefs } from "@/lib/client/prefs";
import { useStore } from "@/lib/client/store";
import type { SpeechLang } from "@/lib/shared/types";

export function SpeechLanguagePicker() {
  const { m } = useI18n();
  const config = useConfig();
  const prefs = usePrefs();
  const value: SpeechLang = prefs.speechLang ?? "auto";
  return (
    <Field label={m.assistant.language} hint={value === "auto" && config.stt.streaming ? m.assistant.detectSlow : undefined}>
      <Segmented<SpeechLang>
        label={m.assistant.language}
        value={value}
        onChange={(v) => setPrefs({ speechLang: v })}
        options={[
          { value: "en", label: "English" },
          { value: "tr", label: "Türkçe" },
          { value: "auto", label: m.assistant.detect },
        ]}
      />
    </Field>
  );
}

export function AssistantControls() {
  const { m, f } = useI18n();
  const view = useStore(assistant.view);
  const { recording } = useStore(live);
  const prefs = usePrefs();
  const [calibrated, setCalibrated] = useState<number | null>(null);

  return (
    <Card>
      <div className="space-y-5">
        <Field label={m.assistant.mode}>
          <Segmented<"ptt" | "vad">
            label={m.assistant.mode}
            value={view.handsFree ? "vad" : "ptt"}
            onChange={(v) => void assistant.setHandsFree(v === "vad")}
            disabled={recording !== "off"}
            options={[
              { value: "ptt", label: m.assistant.ptt },
              { value: "vad", label: m.assistant.handsFree },
            ]}
          />
        </Field>
        {recording !== "off" ? (
          <p className="-mt-2 text-[0.88rem] text-mist">{m.recorder.handsFreeConflict}</p>
        ) : view.handsFree ? (
          <p className="-mt-2 text-[0.88rem] text-mist">{m.assistant.handsFreeHint}</p>
        ) : null}

        <SpeechLanguagePicker />

        <div className="border-t border-[var(--hairline)] pt-4">
          <Toggle
            checked={view.whisper}
            onChange={(v) => void assistant.setWhisper(v)}
            label={m.assistant.whisper}
            hint={m.assistant.whisperHint}
          />
          {view.whisper ? (
            <div className="mt-3 space-y-2">
              <p className="text-[0.88rem] text-mist">{m.assistant.calibratePrompt}</p>
              <Button
                icon="mic"
                disabled={view.calibrating !== null}
                onClick={async () => setCalibrated(await assistant.calibrateWhisper())}
              >
                {view.calibrating !== null ? f(m.assistant.calibrating, { s: view.calibrating }) : m.assistant.calibrate}
              </Button>
              {calibrated !== null ? (
                <p className="t-mono text-[0.8rem] text-paper">{f(m.assistant.calibrated, { db: `+${calibrated} dB` })}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="border-t border-[var(--hairline)] pt-4">
          <Toggle
            checked={prefs.bargeIn !== false}
            onChange={(v) => setPrefs({ bargeIn: v })}
            label={m.assistant.bargeIn}
            hint={m.assistant.bargeInHint}
          />
        </div>
      </div>
    </Card>
  );
}
