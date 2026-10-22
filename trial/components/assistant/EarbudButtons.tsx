"use client";

import { Card } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Controls";
import { useI18n } from "@/components/providers/AppProviders";
import { disableMediaKeys, enableMediaKeys, mediaKeys } from "@/lib/gestures/media-keys";
import { gestureBus } from "@/lib/gestures/bus";
import { setPrefs } from "@/lib/client/prefs";
import { useStore } from "@/lib/client/store";
import { MEDIA_KEY_ACTIONS } from "@/lib/shared/types";
import { useEffect, useState } from "react";

/** Earbud button routing, and an honest record of what this device delivers. */
export function EarbudButtons() {
  const { m, f } = useI18n();
  const s = useStore(mediaKeys);
  const [last, setLast] = useState<string | null>(null);

  useEffect(
    () =>
      gestureBus.subscribe((e) => {
        setLast(`${m.gestures.gestureNames[e.type]} (${e.source === "media_key" ? e.detail?.mediaAction : e.source})`);
      }),
    [m],
  );

  const toggle = async (on: boolean) => {
    if (on) {
      const ok = await enableMediaKeys();
      setPrefs({ mediaKeys: ok });
    } else {
      disableMediaKeys();
      setPrefs({ mediaKeys: false });
    }
  };

  return (
    <Card>
      <h2 className="text-[1.15rem]">{m.gestures.title}</h2>
      <p className="mt-1.5 text-[0.92rem] leading-relaxed text-mist">{m.gestures.explain}</p>
      <div className="mt-3">
        <Toggle
          checked={s.enabled}
          onChange={toggle}
          disabled={!s.supported}
          label={m.gestures.enable}
          hint={s.supported ? m.gestures.enableHint : m.gestures.unsupported}
        />
      </div>
      <ul className="mt-2 divide-y divide-[var(--hairline)]">
        {MEDIA_KEY_ACTIONS.map((a) => {
          const st = s.status[a];
          const text = !s.enabled
            ? "-"
            : !st.bound
              ? m.gestures.unsupported
              : st.fired
                ? f(m.gestures.received, { n: st.fired })
                : m.gestures.notYet;
          return (
            <li key={a} className="flex items-center justify-between gap-3 py-2.5 text-[0.92rem]">
              <span>{m.gestures.actions[a]}</span>
              <span className={`t-mono text-[0.8rem] ${st.fired ? "text-paper" : "text-fog"}`}>{text}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[0.82rem] leading-relaxed text-fog">{m.gestures.sources}</p>
      <p className="mt-1 text-[0.82rem] leading-relaxed text-fog">{m.gestures.keyboard}</p>
      {last ? (
        <p className="t-mono mt-3 text-[0.78rem] text-mist">
          {m.gestures.last}: {last}
        </p>
      ) : null}
    </Card>
  );
}
