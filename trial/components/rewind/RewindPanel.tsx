"use client";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Card";
import { Segmented, Toggle } from "@/components/ui/Controls";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useI18n } from "@/components/providers/AppProviders";
import { rewind } from "@/lib/client/rewind";
import { useStore } from "@/lib/client/store";
import { REWIND_LENGTHS } from "@/lib/shared/constants";
import { RewindStage } from "./RewindStage";

const LENGTHS = [...REWIND_LENGTHS].sort((a, b) => a - b);

/**
 * Rewind: keep the last 30 seconds, clench to hear the chosen seconds again,
 * then hear what was said. The figure shows the clench a Signalive earbud
 * will feel; here the button and the J key stand in for it.
 */
export function RewindPanel() {
  const { m, f } = useI18n();
  const v = useStore(rewind.view);
  const on = v.phase !== "off";
  const ready = on && v.phase !== "starting";
  const busy = v.phase === "clench" || v.phase === "rewinding" || v.phase === "replaying" || v.phase === "narrating";
  const ownError = v.error === "rewind_off" || v.error === "rewind_empty" ? m.rewind.errors[v.error] : null;
  const hasResult = v.transcript !== null || v.recap !== "" || v.thinking;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
      <RewindStage />

      <div className="flex flex-col gap-7 lg:pt-2">
        <header className="rise">
          <h1 className="t-display text-[clamp(2rem,4.2vw,2.7rem)] leading-[1.04]">{m.rewind.title}</h1>
          <p className="mt-3 max-w-[48ch] text-[1.02rem] leading-relaxed text-mist">{m.rewind.lead}</p>
        </header>

        <div className="rise rise-1 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well px-5 py-4">
          <Toggle
            checked={on}
            disabled={v.phase === "starting"}
            onChange={(next) => (next ? void rewind.enable() : rewind.disable())}
            label={m.rewind.keep}
            hint={m.rewind.keepHint}
          />
        </div>

        <div className="rise rise-2 space-y-2.5">
          <p className="t-label">{m.rewind.length}</p>
          <Segmented
            label={m.rewind.length}
            value={String(v.seconds)}
            disabled={busy}
            onChange={(s) => rewind.setSeconds(Number(s))}
            options={LENGTHS.map((n) => ({ value: String(n), label: f(m.rewind.secondsOption, { n }) }))}
          />
        </div>

        <div className="rise rise-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              icon="rewind"
              disabled={!ready || busy}
              onClick={() => void rewind.trigger()}
              className="min-w-[15rem] flex-1 sm:flex-none"
            >
              {m.rewind.clench}
              <kbd className="t-mono ml-1 hidden rounded-[6px] border border-ink/25 px-1.5 py-0.5 text-[0.72rem] text-ink/70 sm:inline">J</kbd>
            </Button>
            {busy ? (
              <Button size="lg" icon="stop" onClick={() => rewind.stop()}>
                {m.rewind.stop}
              </Button>
            ) : null}
          </div>
          <p className="max-w-[52ch] text-[0.88rem] leading-relaxed text-fog">{m.rewind.clenchHint}</p>
        </div>

        {ownError ? <Callout kind="warn" title={ownError} /> : v.error ? <ErrorCallout code={v.error} /> : null}

        {hasResult ? (
          <section className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well px-5 py-4" aria-live="polite">
            <p className="t-label">{m.rewind.heard}</p>
            <p className="mt-1.5 text-[0.95rem] leading-relaxed text-mist">
              {v.transcript === null ? "..." : v.transcript || m.rewind.noSpeech}
            </p>
            <p className="t-label mt-4">{m.rewind.recap}</p>
            <p className="mt-1.5 text-[1.08rem] leading-relaxed">{v.recap || (v.thinking ? "..." : "")}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
