"use client";

import { useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { agent, copyText } from "@/lib/client/agent";
import { formatDue } from "@/lib/client/moments-format";
import type { AgentAction } from "@/lib/shared/moments";

const ICONS: Record<AgentAction["kind"], IconName> = { reminder: "bell", event: "calendar", draft: "pencil" };

/**
 * Something Ask proposes: a reminder, an event or a draft. Nothing happens
 * until Accept; then the reminder or event goes to the calendar and the
 * draft opens where messages are written.
 */
export function ActionCard({ action }: { action: AgentAction }) {
  const { m, locale } = useI18n();
  const a = m.ask.action;
  const [busy, setBusy] = useState<"accept" | "dismiss" | "copy" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const label = action.kind === "draft" ? (action.channel === "email" ? a.email : a.message) : a[action.kind];
  const title =
    action.kind === "reminder" ? action.text : action.kind === "event" ? action.title : action.subject || (action.to ? `${a.to}: ${action.to}` : label);
  const details: string[] = [];
  if (action.kind === "reminder") details.push(formatDue(action.due, locale) ?? a.noTime);
  if (action.kind === "event") {
    const when = formatDue(action.start, locale);
    if (when) details.push(when);
    if (action.location) details.push(action.location);
  }
  if (action.kind === "draft" && action.subject && action.to) details.push(`${a.to}: ${action.to}`);

  async function run(kind: "accept" | "dismiss" | "copy") {
    setBusy(kind);
    setFailed(false);
    try {
      if (kind === "dismiss") await agent.dismiss(action);
      else if (kind === "copy" && action.kind === "draft") {
        await copyText(action.body);
        setNote(a.copied);
      } else {
        const outcome = await agent.accept(action);
        setNote(outcome === "file" ? a.file : outcome === "copied" ? a.copied : null);
      }
    } catch (err) {
      // Closing the share sheet is a choice, not a failure: the draft stays proposed.
      if ((err as { name?: string } | null)?.name !== "AbortError") setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-[12px] border border-[var(--hairline-strong)] bg-well-2 p-4" aria-label={`${label}: ${title}`} role="group">
      <div className="flex items-center gap-2 text-mist">
        <Icon name={ICONS[action.kind]} size={16} />
        <span className="t-label">{label}</span>
        {action.status !== "proposed" ? (
          <span className="ml-auto flex items-center gap-1.5 text-[0.8rem] text-mist">
            {action.status === "accepted" ? <Icon name="check" size={14} className="text-paper" /> : null}
            {action.status === "accepted" ? a.accepted[action.kind] : a.dismissed}
          </span>
        ) : null}
      </div>
      <p className={`mt-2 font-medium leading-snug ${action.status === "dismissed" ? "text-mist line-through decoration-fog/60" : ""}`}>{title}</p>
      {details.length ? <p className="t-mono mt-1 text-[0.75rem] text-fog">{details.join(" · ")}</p> : null}
      {action.kind === "draft" ? (
        <p className="mt-3 whitespace-pre-line rounded-[10px] border border-[var(--hairline)] bg-well px-3.5 py-3 text-[0.92rem] leading-relaxed text-mist">
          {action.body}
        </p>
      ) : null}
      {action.status === "proposed" ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={action.kind === "draft" ? "share" : "check"} busy={busy === "accept"} disabled={!!busy} onClick={() => void run("accept")}>
            {a.accept}
          </Button>
          {action.kind === "draft" ? (
            <Button icon="copy" busy={busy === "copy"} disabled={!!busy} onClick={() => void run("copy")}>
              {a.copy}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={!!busy} onClick={() => void run("dismiss")}>
            {a.dismiss}
          </Button>
        </div>
      ) : null}
      {note ? (
        <p role="status" className="mt-2.5 text-[0.85rem] text-mist">
          {note}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-2.5 text-[0.85rem] text-paper">
          {m.errors.generic.title} {m.errors.generic.action}
        </p>
      ) : null}
    </div>
  );
}
