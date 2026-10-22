"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { fmtPct, Readout } from "@/components/ui/Readout";
import { ErrorCallout } from "@/components/ErrorCallout";
import { Spectrum } from "@/components/audio/Spectrum";
import { useI18n } from "@/components/providers/AppProviders";
import { LowFrequencyMeter } from "@/lib/audio/analysis";
import { toMicError } from "@/lib/audio/devices";
import { getEngine } from "@/lib/audio/engine";
import type { MicInput } from "@/lib/audio/mic";
import { micManager } from "@/lib/client/mic-manager";
import { getPrefs } from "@/lib/client/prefs";
import { saveDeviceProfile } from "@/lib/client/session";

const WIND_MS = 10_000;

/**
 * Raw capture (no browser processing), because the point is to see what wind
 * does to the signal before anything cleans it up.
 */
export function WindStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { m, f } = useI18n();
  const meter = useRef<LowFrequencyMeter | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [latest, setLatest] = useState<number | null>(null);
  const [result, setResult] = useState<{ average: number | null; highest: number } | null>(null);
  const [rate, setRate] = useState(48000);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(() => meter.current?.lastSpectrumDb ?? null, []);

  async function start() {
    setError(null);
    setResult(null);
    let mic: MicInput | null = null;
    try {
      const engine = getEngine();
      await engine.resume();
      micManager.close();
      mic = await engine.openMic({ deviceId: getPrefs().inputDeviceId, processing: "raw" });
      const lf = new LowFrequencyMeter(mic.ctx.sampleRate);
      meter.current = lf;
      setRate(mic.ctx.sampleRate);
      const started = performance.now();
      setRemaining(WIND_MS / 1000);
      await new Promise<void>((resolve) => {
        const off = mic!.onSamples((s) => {
          lf.push(s);
          const left = WIND_MS - (performance.now() - started);
          setRemaining(Math.max(0, Math.ceil(left / 1000)));
          setLatest(lf.latest);
          if (left <= 0) {
            off();
            resolve();
          }
        });
      });
      const r = { average: lf.average, highest: lf.highest };
      setResult(r);
      await saveDeviceProfile({
        windLowFreqRatio: r.average,
        extra: { windHighest: r.highest, windProcessing: "raw" },
      }).catch(() => undefined);
    } catch (err) {
      setError(toMicError(err).code);
    } finally {
      mic?.close();
      setRemaining(null);
      await micManager.ensure().catch(() => undefined);
    }
  }

  const running = remaining !== null;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[1.35rem]">{m.setup.wind.title}</h2>
          <span className="t-label">{m.setup.wind.optional}</span>
        </div>
        <p className="mt-2 text-mist">{m.setup.wind.prompt}</p>
        <div className="mt-5">
          <Spectrum read={read} sampleRate={rate} live={running} label={m.setup.wind.spectrum} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <Readout label={m.setup.wind.share} value={fmtPct(running ? latest : (result?.average ?? null))} />
          </div>
          <Readout label={m.setup.wind.average} value={fmtPct(result?.average ?? null)} />
          <Readout label={m.setup.wind.highest} value={fmtPct(result?.highest ?? null)} />
        </div>
        <p className="mt-4 text-[0.88rem] text-fog">{m.setup.wind.explain}</p>
        <div className="mt-5">
          <Button variant={result ? "secondary" : "primary"} size="lg" icon="wind" disabled={running} onClick={start}>
            {running ? f(m.setup.wind.running, { s: remaining ?? 0 }) : m.setup.wind.start}
          </Button>
        </div>
        {error ? <div className="mt-5"><ErrorCallout code={error} /></div> : null}
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" icon="back" onClick={onBack} disabled={running}>
          {m.common.back}
        </Button>
        <Button variant={result ? "primary" : "secondary"} size="lg" iconRight="arrow" disabled={running} onClick={onNext}>
          {result ? m.common.next : m.common.skip}
        </Button>
      </div>
    </div>
  );
}
