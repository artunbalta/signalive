"use client";

import { useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { Callout, Card, SectionTitle } from "@/components/ui/Card";
import { Field, Segmented, Toggle } from "@/components/ui/Controls";
import { CAPTURE_LENGTHS, DEFAULT_CAPTURE_SEC } from "@/lib/client/moments";
import { dayKey } from "@/lib/client/moments-format";
import { saveFile } from "@/lib/client/moments-ics";
import { getPosition } from "@/lib/client/moments-place";
import { momentsStore, momentsToJson, momentsToMarkdown, useMoments } from "@/lib/client/moments-store";
import { setPrefs, usePrefs } from "@/lib/client/prefs";

/**
 * Settings for moments: whether to add the place (off unless turned on, and
 * the browser asks first), the spoken confirmation, how many seconds a
 * moment keeps, and the moments themselves: export them, or delete them all.
 */
export function MomentsSettings() {
  const { m, f, locale } = useI18n();
  const s = m.settings;
  const prefs = usePrefs();
  const snap = useMoments();
  const [place, setPlace] = useState<"idle" | "asking" | "denied" | "unavailable">("idle");
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const seconds = CAPTURE_LENGTHS.includes(prefs.momentSeconds as (typeof CAPTURE_LENGTHS)[number])
    ? (prefs.momentSeconds as number)
    : DEFAULT_CAPTURE_SEC;
  const count = snap.moments.length;
  const stamp = dayKey(new Date());

  async function togglePlace(next: boolean) {
    if (!next) {
      setPrefs({ momentPlace: false });
      setPlace("idle");
      return;
    }
    // Asked now, within the tap, so the browser's question never interrupts a clench.
    setPlace("asking");
    const pos = await getPosition(12_000);
    if ("error" in pos) {
      setPrefs({ momentPlace: false });
      setPlace(pos.error === "denied" ? "denied" : "unavailable");
      return;
    }
    setPrefs({ momentPlace: true });
    setPlace("idle");
  }

  async function removeAll() {
    await momentsStore.clear();
    setConfirm(false);
    setDeleted(true);
  }

  return (
    <Card>
      <SectionTitle title={s.momentsTitle} />
      <div className="space-y-5">
        <Toggle checked={!!prefs.momentPlace} disabled={place === "asking"} onChange={(v) => void togglePlace(v)} label={s.place} hint={s.placeHint} />
        {place === "denied" || place === "unavailable" ? (
          <Callout kind="warn" title={place === "denied" ? s.placeDenied : s.placeUnsupported} />
        ) : null}
        <Toggle checked={prefs.momentSpeak !== false} onChange={(v) => setPrefs({ momentSpeak: v })} label={s.speak} hint={s.speakHint} />
        <Field label={s.captureLength} hint={s.captureLengthHint}>
          <Segmented
            label={s.captureLength}
            value={String(seconds)}
            onChange={(v) => setPrefs({ momentSeconds: Number(v) })}
            options={CAPTURE_LENGTHS.map((n) => ({ value: String(n), label: f(m.common.seconds, { n }) }))}
          />
        </Field>

        <div className="border-t border-[var(--hairline)] pt-5">
          <p className="text-[0.92rem] text-mist">{snap.storage === "memory" ? s.momentsMemory : f(s.momentsStored, { n: count })}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              icon="download"
              disabled={!count}
              onClick={() => saveFile(`signalive-moments-${stamp}.json`, momentsToJson(snap.moments), "application/json")}
            >
              {s.momentsExportJson}
            </Button>
            <Button
              icon="download"
              disabled={!count}
              onClick={() => saveFile(`signalive-moments-${stamp}.md`, momentsToMarkdown(snap.moments, { messages: m, locale }), "text/markdown;charset=utf-8")}
            >
              {s.momentsExportMd}
            </Button>
          </div>
        </div>

        <div className="border-t border-[var(--hairline)] pt-5">
          <p className="font-medium">{s.momentsDelete}</p>
          <p className="mt-1 text-[0.92rem] text-mist">{s.momentsDeleteExplain}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {!confirm ? (
              <Button icon="trash" disabled={!count} onClick={() => setConfirm(true)}>
                {s.momentsDelete}
              </Button>
            ) : (
              <>
                <Button variant="primary" icon="trash" onClick={() => void removeAll()}>
                  {s.momentsDeleteConfirm}
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  {m.common.cancel}
                </Button>
              </>
            )}
          </div>
          {deleted && !count ? (
            <div className="mt-4">
              <Callout kind="success" title={s.momentsDeleted} />
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
