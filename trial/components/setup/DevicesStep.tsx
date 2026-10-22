"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout, Card } from "@/components/ui/Card";
import { Field, Select } from "@/components/ui/Controls";
import { ErrorCallout } from "@/components/ErrorCallout";
import { LiveLevel } from "@/components/audio/LiveLevel";
import { useI18n } from "@/components/providers/AppProviders";
import { getEngine, peekEngine } from "@/lib/audio/engine";
import { listDevices, looksLikeEarbuds, pickInput, toMicError, type AudioDevice } from "@/lib/audio/devices";
import type { MicInput } from "@/lib/audio/mic";
import { live } from "@/lib/client/live";
import { micManager } from "@/lib/client/mic-manager";
import { getPrefs, setPrefs } from "@/lib/client/prefs";

export function DevicesStep({ onNext }: { onNext: () => void }) {
  const { m, f } = useI18n();
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [mic, setMic] = useState<MicInput | null>(micManager.mic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chimed, setChimed] = useState(false);

  const refresh = useCallback(async () => {
    const d = await listDevices();
    setInputs(d.inputs);
    setOutputs(d.outputs);
    return d;
  }, []);

  useEffect(() => {
    const onChange = () => void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", onChange);
  }, [refresh]);

  async function allow() {
    setBusy(true);
    setError(null);
    try {
      const engine = getEngine();
      await engine.resume();
      // First open whatever the browser offers, which grants the permission
      // and reveals device labels; then switch to the earbuds if we see them.
      let opened = await micManager.ensure();
      const d = await refresh();
      const best = pickInput(d.inputs, getPrefs().inputDeviceId);
      if (best && best.deviceId !== "default" && best.deviceId !== opened.deviceId) {
        setPrefs({ inputDeviceId: best.deviceId, inputLabel: best.label });
        opened = await micManager.ensure();
      } else {
        setPrefs({ inputDeviceId: opened.deviceId, inputLabel: opened.label });
      }
      setMic(opened);
    } catch (err) {
      setError(toMicError(err).code);
    } finally {
      setBusy(false);
    }
  }

  async function chooseInput(id: string) {
    const dev = inputs.find((d) => d.deviceId === id);
    setPrefs({ inputDeviceId: id, inputLabel: dev?.label });
    setError(null);
    try {
      setMic(await micManager.ensure());
    } catch (err) {
      setError(toMicError(err).code);
    }
  }

  async function chooseOutput(id: string) {
    const dev = outputs.find((d) => d.deviceId === id);
    const ok = await getEngine().setOutput(id === "default" ? null : id);
    if (ok) {
      setPrefs({ outputDeviceId: id, outputLabel: dev?.label });
      live.set({ outputLabel: id === "default" ? null : (dev?.label ?? null) });
    }
  }

  const engine = peekEngine();
  const canSelectOutput = !!engine?.canSelectOutput && outputs.length > 0;
  const label = (d: AudioDevice, i: number, kind: "in" | "out") =>
    (d.label || f(kind === "in" ? m.setup.devices.unnamed : m.setup.devices.unnamedOutput, { n: i + 1 })) +
    (kind === "in" && looksLikeEarbuds(d.label) ? `  ·  ${m.setup.devices.looksLikeEarbuds}` : "");

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-[1.35rem]">{m.setup.devices.pairTitle}</h2>
        <p className="mt-2 text-mist">{m.setup.devices.pairBody}</p>
        {!mic ? (
          <div className="mt-5 space-y-3">
            <Button variant="primary" size="lg" icon="mic" busy={busy} onClick={allow}>
              {m.setup.devices.allow}
            </Button>
            <p className="text-[0.88rem] text-fog">{m.setup.devices.allowHint}</p>
          </div>
        ) : null}
        {error ? (
          <div className="mt-5">
            <ErrorCallout code={error} action={<Button onClick={allow}>{m.common.retry}</Button>} />
          </div>
        ) : null}
      </Card>

      {mic ? (
        <Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={m.setup.devices.input}>
              <Select
                label={m.setup.devices.input}
                value={getPrefs().inputDeviceId ?? mic.deviceId ?? ""}
                onChange={chooseInput}
                options={inputs.map((d, i) => ({ value: d.deviceId, label: label(d, i, "in") }))}
              />
            </Field>
            <Field label={m.setup.devices.output} hint={canSelectOutput ? undefined : m.setup.devices.outputUnsupported}>
              {canSelectOutput ? (
                <Select
                  label={m.setup.devices.output}
                  value={getPrefs().outputDeviceId ?? "default"}
                  onChange={chooseOutput}
                  options={outputs.map((d, i) => ({ value: d.deviceId, label: label(d, i, "out") }))}
                />
              ) : (
                <p className="min-h-12 rounded-[12px] border border-[var(--hairline)] px-4 py-3 text-mist">{m.status.systemDefault}</p>
              )}
            </Field>
          </div>
          <div className="mt-5">
            <LiveLevel mic={mic} active label={m.setup.mic.level} />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button icon="speaker" onClick={() => { getEngine().playChime(); setChimed(true); }}>
              {m.setup.devices.testSound}
            </Button>
            <Button variant="ghost" onClick={() => void refresh()}>
              {m.setup.devices.refresh}
            </Button>
          </div>
          {chimed ? <p className="mt-3 text-[0.88rem] text-mist">{m.setup.devices.testSoundHint}</p> : null}
        </Card>
      ) : null}

      {mic && live.get().micLost ? <Callout kind="warn" title={m.errors.mic_not_found.title}>{m.errors.mic_not_found.action}</Callout> : null}

      <div className="flex justify-end">
        <Button variant="primary" size="lg" iconRight="arrow" disabled={!mic} onClick={onNext}>
          {m.common.next}
        </Button>
      </div>
    </div>
  );
}
