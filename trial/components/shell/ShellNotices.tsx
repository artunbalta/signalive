"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Spinner } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { agent } from "@/lib/client/agent";
import { moments } from "@/lib/client/moments";
import { rewind } from "@/lib/client/rewind";
import { useStore } from "@/lib/client/store";
import styles from "@/components/moments/motion.module.css";

const NOTICE_MS = 5000;

/** True for `ms` after `at` changes; false when `at` is null. */
function useBriefly(at: number | null | undefined, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (at === null || at === undefined) {
      setOn(false);
      return;
    }
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [at, ms]);
  return on;
}

/**
 * What a clench or a held clench did, on whatever screen is open: a moment
 * being kept and then kept (with a way to open it), a question being written
 * down and answered, or why nothing happened. On Moments and Ask, whose own
 * screens show their progress, only what they do not show appears here.
 */
export function ShellNotices() {
  const { m, f } = useI18n();
  const path = usePathname();
  const cap = useStore(moments.view);
  const ask = useStore(agent.view);
  const onMoments = path === "/moments";
  const onAsk = path === "/ask";
  const noticeOn = useBriefly(cap.notice?.at, NOTICE_MS);
  const [voiceErrorAt, setVoiceErrorAt] = useState<number | null>(null);
  useEffect(() => setVoiceErrorAt(ask.voiceError ? performance.now() : null), [ask.voiceError]);
  const voiceErrorOn = useBriefly(voiceErrorAt, NOTICE_MS);

  const items: { key: string; node: ReactNode }[] = [];

  if (noticeOn && cap.notice) {
    const code = cap.notice.code;
    items.push({
      key: `notice-${cap.notice.at}`,
      node: (
        <Toast icon={<Icon name="info" size={18} />}>
          <span>{m.moments.errors[code]}</span>
          {code === "listening_off" && !onMoments ? (
            <ToastButton
              onClick={() => {
                moments.dismissNotice();
                void rewind.enable();
              }}
            >
              {m.moments.listening.start}
            </ToastButton>
          ) : null}
        </Toast>
      ),
    });
  }

  const latest = cap.captures[0];
  if (latest && !onMoments) {
    const working = latest.stage === "listening_back" || latest.stage === "writing";
    items.push({
      key: `capture-${latest.id}`,
      node: (
        <Toast
          icon={working ? <Spinner size={16} /> : <Icon name={latest.stage === "saved" ? "check" : "info"} size={18} />}
          busy={working}
        >
          <span className="min-w-0 truncate">
            {latest.stage === "saved" && latest.title ? f(m.moments.keptToast, { title: latest.title }) : m.moments.stages[latest.stage]}
          </span>
          {latest.stage === "saved" ? <ToastLink href={`/moments/${latest.id}`}>{m.moments.open}</ToastLink> : null}
          {latest.stage === "error" ? (
            <>
              <ToastButton onClick={() => moments.retry(latest.id)}>{m.moments.retry}</ToastButton>
              <ToastButton quiet onClick={() => moments.dismiss(latest.id)}>
                {m.moments.dismiss}
              </ToastButton>
            </>
          ) : null}
        </Toast>
      ),
    });
  }

  if (!onAsk) {
    const last = ask.turns.at(-1);
    const answering = last?.status === "pending" || last?.status === "streaming" || ask.speaking;
    if (ask.voice === "transcribing") {
      items.push({ key: "voice", node: <Toast icon={<Spinner size={16} />} busy><span>{m.ask.voiceWriting}</span></Toast> });
    } else if (answering && last) {
      items.push({
        key: `answer-${last.id}`,
        node: (
          <Toast icon={<Icon name={ask.speaking ? "speaker" : "ask"} size={18} />} busy={!ask.speaking}>
            <span className="min-w-0 truncate">{ask.speaking ? m.ask.speaking : m.ask.voiceAnswer}</span>
            <ToastLink href="/ask">{m.ask.openAsk}</ToastLink>
            <ToastButton quiet onClick={() => agent.stop()}>
              {m.ask.stop}
            </ToastButton>
          </Toast>
        ),
      });
    } else if (voiceErrorOn && ask.voiceError) {
      items.push({
        key: "voice-error",
        node: (
          <Toast icon={<Icon name="info" size={18} />}>
            <span>{ask.voiceError === "no_speech" ? m.ask.noSpeech : m.errors.generic.title}</span>
          </Toast>
        ),
      });
    }
  }

  if (!items.length) return null;
  const docked = onMoments || onAsk;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[35] flex flex-col items-center gap-2 px-4"
      style={{ bottom: `calc(var(--nav-h) + env(safe-area-inset-bottom) + ${docked ? 132 : 14}px)` }}
      aria-live="polite"
    >
      {items.map((it) => (
        <div key={it.key} className={`pointer-events-auto w-full max-w-[460px] ${styles.lift}`}>
          {it.node}
        </div>
      ))}
    </div>
  );
}

function Toast({ icon, busy, children }: { icon: ReactNode; busy?: boolean; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-busy={busy || undefined}
      className="flex min-h-12 items-center gap-3 rounded-[14px] border border-[var(--hairline-strong)] bg-well-2 px-4 py-2.5 text-[0.9rem] leading-snug shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
    >
      <span className="shrink-0 text-mist">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
    </div>
  );
}

function ToastButton({ onClick, quiet, children }: { onClick: () => void; quiet?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ml-auto inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-[0.82rem] ${
        quiet ? "text-mist hover:text-paper" : "border border-[var(--hairline-strong)] font-medium hover:border-paper/60"
      }`}
    >
      {children}
    </button>
  );
}

function ToastLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-[var(--hairline-strong)] px-3 text-[0.82rem] font-medium hover:border-paper/60"
    >
      {children}
      <Icon name="chevron" size={14} />
    </Link>
  );
}
