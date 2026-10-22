"use client";

import Link from "next/link";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { fmtHz, fmtMs } from "@/components/ui/Readout";
import { live, type AssistantState } from "@/lib/client/live";
import { useStore } from "@/lib/client/store";

const ACTIVE: AssistantState[] = ["listening", "hearing"];

/**
 * The always visible instrument line. Amber marks the assistant while it is
 * listening (the attended state); coral marks recording. Everything else is
 * paper and fog.
 */
export function StatusStrip() {
  const { m } = useI18n();
  const config = useConfig();
  const s = useStore(live);
  const listening = ACTIVE.includes(s.assistant);
  // The assistant can be idle while another feature captures (the wind
  // test, the recorder, the lab): then the strip says the mic is on.
  const label =
    s.assistant !== "off" ? m.status.states[s.assistant] : s.micOpen ? m.status.states.micOn : m.status.states.off;
  const dot = listening ? "bg-signal" : s.micOpen ? "bg-paper" : "bg-fog/50";

  return (
    <div
      className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-ink/90 backdrop-blur-md"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div
        className="t-mono mx-auto flex h-[var(--strip-h)] max-w-[1180px] items-center gap-4 overflow-x-auto whitespace-nowrap px-4 text-[0.72rem] text-mist [scrollbar-width:none] sm:px-6"
        aria-live="polite"
      >
        <span className="flex shrink-0 items-center gap-2 text-paper">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="uppercase tracking-wider">{label}</span>
        </span>
        <Sep />
        <span className="max-w-[18ch] shrink-0 truncate sm:max-w-[26ch]" title={s.inputLabel ?? undefined}>
          <span className="text-fog">{m.status.input} </span>
          {s.inputLabel ?? "-"}
        </span>
        <Sep />
        <span className="max-w-[18ch] shrink-0 truncate sm:max-w-[22ch]">
          <span className="text-fog">{m.status.output} </span>
          {s.outputLabel ?? m.status.systemDefault}
        </span>
        <Sep />
        <span className="shrink-0">
          <span className="text-fog">{m.status.rate} </span>
          {s.contextRate ? fmtHz(s.contextRate) : "-"}
          {s.trackRate && s.trackRate !== s.contextRate ? ` / ${fmtHz(s.trackRate)}` : ""}
        </span>
        <Sep />
        <Link href="/debug" className="shrink-0 hover:text-paper">
          <span className="text-fog">{m.status.lastReply} </span>
          {fmtMs(s.lastLatencyMs)}
        </Link>
        <Sep />
        {s.recording === "off" && s.rewindOn ? (
          <span className="flex shrink-0 items-center gap-2 text-paper">
            <span className="rec-dot" aria-hidden="true" />
            {m.status.rewindOn}
          </span>
        ) : s.recording === "off" ? (
          <span className="shrink-0 text-fog">{m.status.notRecording}</span>
        ) : (
          <span className="flex shrink-0 items-center gap-2 text-paper">
            {s.recording === "on" ? <span className="rec-dot" aria-hidden="true" /> : null}
            {s.recording === "on" ? m.status.recording : m.status.recordingPaused}
          </span>
        )}
        {config.mockProviders.length ? (
          <>
            <Sep />
            <span className="shrink-0 rounded-full border border-[var(--hairline-strong)] px-2 py-0.5 text-paper" title={m.common.mockExplain}>
              {m.common.mockBadge}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Sep() {
  return <span aria-hidden="true" className="h-3 w-px shrink-0 bg-[var(--hairline-strong)]" />;
}
