"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout, Card } from "@/components/ui/Card";
import { Field, Select } from "@/components/ui/Controls";
import { fmtDb, fmtHz, ReadoutRows } from "@/components/ui/Readout";
import { ErrorCallout } from "@/components/ErrorCallout";
import { LiveLevel } from "@/components/audio/LiveLevel";
import { useI18n } from "@/components/providers/AppProviders";
import { analyzeMicCheck, type MicCheckResult } from "@/lib/audio/analysis";
import { listDevices, looksHandsFree, looksLikeEarbuds, pickComparison, toMicError, type AudioDevice } from "@/lib/audio/devices";
import { getEngine } from "@/lib/audio/engine";
import { recordFor, type MicInput } from "@/lib/audio/mic";
import { micManager } from "@/lib/client/mic-manager";
import { getPrefs } from "@/lib/client/prefs";
import { saveDeviceProfile } from "@/lib/client/session";

const CHECK_MS = 5000;

export interface CheckOutcome {
  label: string;
  trackRate: number | null;
  contextRate: number;
  channels: number | null;
  result: MicCheckResult;
}

async function runCheck(mic: MicInput, onTick: (s: number) => void): Promise<CheckOutcome> {
  const samples = await recordFor(mic, CHECK_MS, (ms) => onTick(Math.ceil(ms / 1000)));
  return {
    label: mic.label,
    trackRate: mic.settings.sampleRate ?? null,
    contextRate: mic.ctx.sampleRate,
    channels: mic.settings.channelCount ?? null,
    result: analyzeMicCheck(samples, mic.ctx.sampleRate),
  };
}

export function flagsFor(o: CheckOutcome) {
  const narrowRate = o.trackRate !== null && o.trackRate <= 16000;
  const handsFree = looksHandsFree(o.label);
  const bandLimited = o.result.effectiveBandwidthHz !== null && o.result.effectiveBandwidthHz <= 8000;
  return {
    narrowRate,
    handsFree,
    bandLimited,
    bluetooth: narrowRate || handsFree || bandLimited || looksLikeEarbuds(o.label),
    tooQuiet: o.result.speechFrames < 10 || o.result.speechDbfs < -45,
    clipping: o.result.clippedSamples > 50,
  };
}

export function MicCheckStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { m, f } = useI18n();
  const [mic, setMic] = useState<MicInput | null>(micManager.mic);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [compareId, setCompareId] = useState<string>("");
  const [comparison, setComparison] = useState<CheckOutcome | null>(null);

  useEffect(() => {
    void listDevices().then((d) => {
      setDevices(d.inputs);
      const pick = pickComparison(d.inputs, d.inputs.find((x) => x.deviceId === getPrefs().inputDeviceId));
      if (pick) setCompareId(pick.deviceId);
    });
  }, []);

  async function start() {
    setError(null);
    setOutcome(null);
    try {
      const engine = getEngine();
      await engine.resume();
      const active = await micManager.ensure();
      setMic(active);
      setRemaining(CHECK_MS / 1000);
      const o = await runCheck(active, setRemaining);
      setOutcome(o);
      const fl = flagsFor(o);
      await saveDeviceProfile({
        inputLabel: o.label,
        trackSampleRate: o.trackRate,
        contextSampleRate: o.contextRate,
        channelCount: o.channels,
        bluetoothSuspected: fl.bluetooth,
        handsFreeSuspected: fl.handsFree || fl.narrowRate || fl.bandLimited,
        effectiveBandwidthHz: o.result.effectiveBandwidthHz,
        rmsDbfs: Number.isFinite(o.result.speechDbfs) ? o.result.speechDbfs : null,
        peakDbfs: Number.isFinite(o.result.peakDbfs) ? o.result.peakDbfs : null,
        noiseFloorDbfs: Number.isFinite(o.result.noiseFloorDbfs) ? o.result.noiseFloorDbfs : null,
        outputLabel: getPrefs().outputLabel ?? null,
        outputSelectable: engine.canSelectOutput,
        extra: { micCheckProcessing: "voice", clippedSamples: o.result.clippedSamples },
      }).catch(() => undefined);
    } catch (err) {
      setError(toMicError(err).code);
    } finally {
      setRemaining(null);
    }
  }

  async function compare() {
    if (!compareId) return;
    setError(null);
    setComparing(true);
    let other: MicInput | null = null;
    try {
      // One capture at a time: Bluetooth links renegotiate when a second
      // microphone opens, which would disturb both measurements.
      micManager.close();
      other = await getEngine().openMic({ deviceId: compareId, processing: "voice" });
      setRemaining(CHECK_MS / 1000);
      const o = await runCheck(other, setRemaining);
      setComparison(o);
      await saveDeviceProfile({
        extra: {
          comparison: {
            label: o.label,
            trackRate: o.trackRate,
            bandwidthHz: o.result.effectiveBandwidthHz,
            speechDbfs: o.result.speechDbfs,
            noiseFloorDbfs: o.result.noiseFloorDbfs,
          },
        },
      }).catch(() => undefined);
    } catch (err) {
      setError(toMicError(err).code);
    } finally {
      other?.close();
      setRemaining(null);
      setComparing(false);
      setMic(await micManager.ensure().catch(() => null));
    }
  }

  const fl = outcome ? flagsFor(outcome) : null;
  const running = remaining !== null;
  const rows = (o: CheckOutcome) => [
    { label: m.setup.mic.device, value: o.label || "-" },
    { label: m.setup.mic.trackRate, value: o.trackRate ? fmtHz(o.trackRate) : m.common.notReported, flag: flagsFor(o).narrowRate },
    { label: m.setup.mic.contextRate, value: fmtHz(o.contextRate) },
    { label: m.setup.mic.channels, value: o.channels ?? m.common.notReported },
    { label: m.setup.mic.level, value: `${fmtDb(o.result.speechDbfs)} dBFS` },
    { label: m.setup.mic.peak, value: `${fmtDb(o.result.peakDbfs)} dBFS` },
    { label: m.setup.mic.noise, value: `${fmtDb(o.result.noiseFloorDbfs)} dBFS` },
    {
      label: m.setup.mic.bandwidth,
      value: o.result.effectiveBandwidthHz ? fmtHz(o.result.effectiveBandwidthHz) : "-",
      flag: flagsFor(o).bandLimited,
    },
  ];

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-[1.35rem]">{m.setup.mic.title}</h2>
        <p className="mt-2 text-mist">{m.setup.mic.prompt}</p>
        <div className="mt-5">
          <LiveLevel mic={mic} active={running} label={m.setup.mic.level} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant={outcome ? "secondary" : "primary"} size="lg" icon="mic" disabled={running} onClick={start}>
            {running && !comparing ? f(m.setup.mic.running, { s: remaining ?? 0 }) : outcome ? m.setup.mic.again : m.setup.mic.start}
          </Button>
        </div>
        {error ? <div className="mt-5"><ErrorCallout code={error} /></div> : null}
      </Card>

      {outcome && fl ? (
        <Card aria-label={m.setup.mic.results}>
          <p className="t-label mb-2">{m.setup.mic.results}</p>
          <ReadoutRows rows={rows(outcome)} />
          <div className="mt-4 space-y-3">
            {fl.tooQuiet ? <Callout kind="warn" title={m.setup.mic.tooQuiet} /> : null}
            {fl.clipping ? <Callout kind="warn" title={m.setup.mic.clipping} /> : null}
            {fl.narrowRate || fl.handsFree || fl.bandLimited ? (
              <Callout
                kind="warn"
                title={
                  fl.narrowRate
                    ? f(m.setup.mic.warnNarrow, { rate: fmtHz(outcome.trackRate) })
                    : fl.handsFree
                      ? m.setup.mic.warnHandsFree
                      : f(m.setup.mic.warnBandwidth, { khz: (outcome.result.effectiveBandwidthHz ?? 0) / 1000 })
                }
              >
                {m.setup.mic.btExplain}
              </Callout>
            ) : null}
          </div>
        </Card>
      ) : null}

      {outcome ? (
        <Card>
          <h3 className="text-[1.1rem]">{m.setup.mic.compare}</h3>
          {devices.filter((d) => !d.virtual).length > 1 ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label={m.setup.mic.compareWith}>
                <Select
                  label={m.setup.mic.compareWith}
                  value={compareId}
                  onChange={setCompareId}
                  options={devices.filter((d) => !d.virtual && d.deviceId !== getPrefs().inputDeviceId).map((d) => ({ value: d.deviceId, label: d.label || d.deviceId.slice(0, 8) }))}
                />
              </Field>
              <Button icon="mic" disabled={running || !compareId} onClick={compare}>
                {comparing && running ? f(m.setup.mic.running, { s: remaining ?? 0 }) : m.setup.mic.compareRun}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-mist">{m.setup.mic.compareNone}</p>
          )}
          {comparison ? (
            <div className="mt-5 overflow-x-auto">
              <table className="t-mono w-full min-w-[420px] text-left text-[0.85rem]">
                <thead>
                  <tr className="text-fog">
                    <th className="py-2 pr-3 font-normal" />
                    <th className="py-2 pr-3 font-normal">{m.setup.mic.compareColumnA}</th>
                    <th className="py-2 font-normal">{m.setup.mic.compareColumnB}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--hairline)]">
                  {rows(outcome).map((r, i) => (
                    <tr key={r.label}>
                      <td className="py-2 pr-3 font-sans text-mist">{r.label}</td>
                      <td className="py-2 pr-3">{r.value}</td>
                      <td className="py-2">{rows(comparison)[i]!.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="flex justify-between">
        <Button variant="ghost" icon="back" onClick={onBack}>
          {m.common.back}
        </Button>
        <Button variant="primary" size="lg" iconRight="arrow" disabled={!outcome || running} onClick={onNext}>
          {m.common.next}
        </Button>
      </div>
    </div>
  );
}
