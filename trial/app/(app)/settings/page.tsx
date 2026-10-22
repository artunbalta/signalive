"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SpeechLanguagePicker } from "@/components/assistant/AssistantControls";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { RawAudioToggle } from "@/components/notes/RawAudioToggle";
import { ErrorCallout } from "@/components/ErrorCallout";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, Card, SectionTitle } from "@/components/ui/Card";
import { Field, Select } from "@/components/ui/Controls";
import { ReadoutRows } from "@/components/ui/Readout";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { api, ApiError } from "@/lib/client/api";
import { assistant } from "@/lib/client/assistant";
import { currentEmail, forgetIdentity, linkEmail } from "@/lib/client/auth";
import { download } from "@/lib/client/download";
import { live } from "@/lib/client/live";
import { micManager } from "@/lib/client/mic-manager";
import { PROVIDER_NAMES } from "@/lib/client/platform";
import { setPrefs, usePrefs } from "@/lib/client/prefs";
import { recorder } from "@/lib/client/recorder";
import { rewind } from "@/lib/client/rewind";
import { forgetSession } from "@/lib/client/session";
import { useStore } from "@/lib/client/store";
import { COMMANDS, DEFAULT_BINDINGS, GESTURE_TYPES, type Command } from "@/lib/gestures/types";
import type { ConsentKind, ConsentRecord, DeleteReport } from "@/lib/shared/types";

export default function SettingsPage() {
  const { m, f, locale } = useI18n();
  const config = useConfig();
  const router = useRouter();
  const prefs = usePrefs();
  const status = useStore(live);
  const [consents, setConsents] = useState<Partial<Record<ConsentKind, ConsentRecord>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [linked, setLinked] = useState<string | null>(null);
  const [emailState, setEmailState] = useState<"idle" | "sent" | "unavailable">("idle");

  useEffect(() => {
    void api<Partial<Record<ConsentKind, ConsentRecord>>>("/api/consent").then(setConsents).catch(() => undefined);
    void currentEmail().then(setLinked);
  }, []);

  const bindings = { ...DEFAULT_BINDINGS, ...(prefs.gestureBindings ?? {}) };
  const name = (id: string) => PROVIDER_NAMES[id] ?? id;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "generic");
    } finally {
      setBusy(null);
    }
  }

  async function deleteEverything() {
    await run("delete", async () => {
      await recorder.stop();
      rewind.disable();
      assistant.deactivate();
      micManager.close();
      await api<DeleteReport>("/api/delete-all", { method: "POST", json: { confirm: "delete-everything" } });
      assistant.clear();
      forgetSession();
      await forgetIdentity();
      router.replace("/?deleted=1");
    });
  }

  return (
    <div className="mx-auto max-w-[760px] space-y-8">
      <h1 className="t-display text-[1.9rem]">{m.settings.title}</h1>
      {error ? <ErrorCallout code={error} /> : null}

      <Card>
        <div className="space-y-6">
          <Field label={m.settings.interfaceLanguage}>
            <LanguageSwitch />
          </Field>
          <SpeechLanguagePicker />
        </div>
      </Card>

      <Card>
        <SectionTitle title={m.settings.devices} />
        <ReadoutRows
          rows={[
            { label: m.status.input, value: status.inputLabel ?? prefs.inputLabel ?? "-" },
            { label: m.status.output, value: status.outputLabel ?? prefs.outputLabel ?? m.status.systemDefault },
          ]}
        />
        <div className="mt-4">
          <ButtonLink href="/setup" icon="mic">
            {m.settings.rerunSetup}
          </ButtonLink>
        </div>
      </Card>

      <Card>
        <SectionTitle title={m.gestures.bindingsTitle} />
        <div className="grid gap-4 sm:grid-cols-2">
          {GESTURE_TYPES.map((g) => (
            <Field key={g} label={m.gestures.gestureNames[g]}>
              <Select
                label={m.gestures.gestureNames[g]}
                value={bindings[g]}
                onChange={(v) => setPrefs({ gestureBindings: { ...bindings, [g]: v as Command } })}
                options={COMMANDS.map((c) => ({ value: c, label: m.gestures.commands[c] }))}
              />
            </Field>
          ))}
        </div>
        <p className="mt-4 text-[0.85rem] text-fog">{m.gestures.future}</p>
      </Card>

      <Card>
        <SectionTitle title={m.settings.data} />
        <div className="space-y-5">
          <RawAudioToggle />
          <div className="flex flex-wrap gap-3 border-t border-[var(--hairline)] pt-5">
            <Button icon="download" busy={busy === "json"} onClick={() => void run("json", () => download("/api/export?format=json", "signalive.json"))}>
              {m.settings.exportJson}
            </Button>
            <Button icon="download" busy={busy === "md"} onClick={() => void run("md", () => download("/api/export?format=md", "signalive.md"))}>
              {m.settings.exportMd}
            </Button>
          </div>
          <div className="border-t border-[var(--hairline)] pt-5">
            <p className="font-medium">{m.settings.deleteAll}</p>
            <p className="mt-1 text-[0.92rem] text-mist">{m.settings.deleteExplain}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {!confirmDelete ? (
                <Button icon="trash" onClick={() => setConfirmDelete(true)}>
                  {m.settings.deleteAll}
                </Button>
              ) : (
                <>
                  <Button variant="primary" icon="trash" busy={busy === "delete"} onClick={() => void deleteEverything()}>
                    {busy === "delete" ? m.settings.deleting : m.settings.deleteConfirm}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                    {m.common.cancel}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle title={m.settings.keepTitle} />
        {linked ? (
          <p className="text-mist">{f(m.settings.emailLinked, { email: linked })}</p>
        ) : config.supabase ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run("email", async () => setEmailState(await linkEmail(email.trim(), `${window.location.origin}/settings`)));
            }}
          >
            <p className="text-[0.92rem] text-mist">{m.settings.keepExplain}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={m.settings.emailPlaceholder}
                autoComplete="email"
                className="min-h-12 flex-1 rounded-[12px] border border-[var(--hairline-strong)] bg-well px-4"
              />
              <Button type="submit" busy={busy === "email"}>
                {m.settings.emailSend}
              </Button>
            </div>
            {emailState === "sent" ? <Callout kind="success" title={m.settings.emailSent} /> : null}
          </form>
        ) : (
          <p className="text-mist">{m.settings.emailUnavailable}</p>
        )}
      </Card>

      <Card>
        <SectionTitle title={m.settings.consents} />
        <ReadoutRows
          rows={(Object.entries(consents) as [ConsentKind, ConsentRecord][]).map(([kind, c]) => ({
            label: m.settings.consentKinds[kind],
            value: `${c.granted ? m.settings.granted : m.settings.withdrawn} ${new Date(c.createdAt).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}`,
          }))}
        />
      </Card>

      <Card>
        <SectionTitle title={m.settings.providers} />
        <ReadoutRows
          rows={[
            { label: "STT", value: `${name(config.stt.provider)} ${config.stt.model}${config.stt.streaming ? " (live)" : ""}` },
            { label: "LLM", value: `${name(config.llm.provider)} ${config.llm.model}` },
            { label: "TTS", value: `${name(config.tts.provider)} ${config.tts.model}` },
            { label: "Embeddings", value: `${name(config.embeddings.provider)} ${config.embeddings.model}` },
            { label: m.lab.recognizers, value: config.labSttProviders.map(name).join(", ") },
            { label: "Data", value: config.dataStore },
          ]}
        />
        {config.mockProviders.length ? <p className="mt-3 text-[0.85rem] text-fog">{m.common.mockExplain}</p> : null}
      </Card>

      <Card>
        <SectionTitle title={m.settings.about} />
        <p className="text-[0.92rem] leading-relaxed text-mist">{m.settings.aboutBody}</p>
        <div className="mt-4">
          <ButtonLink href="/debug" variant="ghost" icon="chart">
            {m.debug.title}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
