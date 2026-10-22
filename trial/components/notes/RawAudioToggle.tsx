"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Toggle } from "@/components/ui/Controls";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { api } from "@/lib/client/api";
import { live } from "@/lib/client/live";
import { setPrefs, usePrefs } from "@/lib/client/prefs";

/**
 * Raw audio retention is off by default and needs its own explicit consent,
 * recorded on the server; the server checks that record before keeping any
 * recording. Turning it off records the withdrawal.
 */
export function RawAudioToggle() {
  const { m, f } = useI18n();
  const config = useConfig();
  const prefs = usePrefs();
  const [confirming, setConfirming] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const days = config.rawAudioRetentionDays;

  const save = async (granted: boolean) => {
    setBusy(true);
    try {
      await api("/api/consent", {
        method: "POST",
        json: { kind: "raw_audio_retention", version: config.consentVersion, granted },
      });
      setPrefs({ keepRawAudio: granted });
      if (live.get().recording !== "off") live.set({ recordingKeepsAudio: granted });
      setConfirming(false);
      setAgreed(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Toggle
        checked={!!prefs.keepRawAudio}
        onChange={(on) => (on ? setConfirming(true) : void save(false))}
        label={m.recorder.keepAudio}
        hint={f(m.recorder.keepAudioHint, { days })}
        disabled={busy}
      />
      {confirming && !prefs.keepRawAudio ? (
        <div className="mt-3 rounded-[12px] border border-[var(--hairline-strong)] p-4">
          <Checkbox checked={agreed} onChange={setAgreed}>
            {f(m.recorder.keepAudioConfirm, { days })}
          </Checkbox>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" disabled={!agreed} busy={busy} onClick={() => void save(true)}>
              {m.common.continue}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {m.common.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
