"use client";

import { useI18n } from "@/components/providers/AppProviders";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Field, Select } from "@/components/ui/Controls";
import { setPrefs, usePrefs } from "@/lib/client/prefs";
import { COMMANDS, DEFAULT_BINDINGS, type Command, type GestureType } from "@/lib/gestures/types";

const GROUPS: { key: "jaw" | "buttons" | "whisper"; gestures: GestureType[] }[] = [
  { key: "jaw", gestures: ["jaw_clench", "jaw_double_clench", "jaw_hold"] },
  { key: "buttons", gestures: ["tap", "double_tap", "triple_tap"] },
  { key: "whisper", gestures: ["whisper_start", "whisper_end"] },
];

/**
 * What each gesture does, the jaw first: by default a double clench keeps a
 * moment, a clench rewinds, and a held clench asks by voice.
 */
export function GestureBindings() {
  const { m } = useI18n();
  const prefs = usePrefs();
  const bindings = { ...DEFAULT_BINDINGS, ...(prefs.gestureBindings ?? {}) };
  const options = COMMANDS.map((c) => ({ value: c, label: m.gestures.commands[c] }));

  return (
    <Card>
      <SectionTitle title={m.gestures.bindingsTitle} />
      <div className="space-y-7">
        {GROUPS.map((g) => (
          <fieldset key={g.key} className="min-w-0">
            <legend className="mb-3 text-[0.95rem] font-medium">{m.gestures.groups[g.key]}</legend>
            {g.key === "whisper" ? <p className="-mt-1.5 mb-3 text-[0.85rem] text-fog">{m.gestures.whisperReserved}</p> : null}
            <div className="grid gap-4 sm:grid-cols-3">
              {g.gestures.map((gesture) => (
                <Field key={gesture} label={m.gestures.gestureNames[gesture]}>
                  <Select
                    label={m.gestures.gestureNames[gesture]}
                    value={bindings[gesture]}
                    onChange={(v) => setPrefs({ gestureBindings: { ...bindings, [gesture]: v as Command } })}
                    options={options}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-6 space-y-1.5 border-t border-[var(--hairline)] pt-4 text-[0.85rem] leading-relaxed text-fog">
        <p>{m.gestures.future}</p>
        <p>{m.gestures.keyboard}</p>
      </div>
    </Card>
  );
}
