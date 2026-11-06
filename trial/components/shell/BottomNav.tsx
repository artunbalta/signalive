"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "@/components/moments/motion.module.css";

type MainKey = "moments" | "ask" | "earbuds" | "settings";
type MoreKey = "assistant" | "focus" | "rewind" | "recorder" | "notes" | "lab" | "studies";

const MAIN: { href: string; key: MainKey; icon: IconName }[] = [
  { href: "/moments", key: "moments", icon: "moment" },
  { href: "/ask", key: "ask", icon: "ask" },
  { href: "/earbuds", key: "earbuds", icon: "earbud" },
  { href: "/settings", key: "settings", icon: "gear" },
];

/** The tools the trial began with, one tap away under More. */
const MORE: { href: string; key: MoreKey; icon: IconName }[] = [
  { href: "/assistant", key: "assistant", icon: "mic" },
  { href: "/focus", key: "focus", icon: "focus" },
  { href: "/rewind", key: "rewind", icon: "rewind" },
  { href: "/recorder", key: "recorder", icon: "wave" },
  { href: "/notes", key: "notes", icon: "notes" },
  { href: "/lab", key: "lab", icon: "chart" },
  { href: "/studies", key: "studies", icon: "flag" },
];

const at = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function BottomNav() {
  const { m } = useI18n();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const inMore = MORE.some((it) => at(path, it.href)) || at(path, "/debug");

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) moreButton.current?.focus();
  }, []);

  // Leaving for another screen closes the sheet.
  useEffect(() => {
    setOpen(false);
  }, [path]);

  return (
    <>
      <nav
        aria-label={m.nav.main}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline)] bg-ink/92 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid h-[var(--nav-h)] max-w-[640px] grid-cols-5">
          {MAIN.map((it) => {
            const active = at(path, it.href);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[0.7rem] transition-colors duration-200 ${
                    active ? "text-paper" : "text-fog hover:text-mist"
                  }`}
                >
                  <Icon name={it.icon} size={22} />
                  <span className="max-w-full truncate px-1">{m.nav[it.key]}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              ref={moreButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-current={inMore ? "page" : undefined}
              onClick={() => setOpen((o) => !o)}
              className={`flex h-full w-full flex-col items-center justify-center gap-1 text-[0.7rem] transition-colors duration-200 ${
                inMore || open ? "text-paper" : "text-fog hover:text-mist"
              }`}
            >
              <Icon name="more" size={22} />
              <span className="max-w-full truncate px-1">{m.nav.more}</span>
            </button>
          </li>
        </ul>
      </nav>
      {open ? <MoreSheet path={path} onClose={close} /> : null}
    </>
  );
}

function MoreSheet({ path, onClose }: { path: string; onClose: (restoreFocus?: boolean) => void }) {
  const { m } = useI18n();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Focus stays inside the sheet while it is open.
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("a, button")];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className={`absolute inset-0 bg-ink/70 backdrop-blur-[2px] ${styles.backdrop}`} onClick={() => onClose()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="more-title"
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-[640px] rounded-t-[22px] border border-b-0 border-[var(--hairline-strong)] bg-well px-4 pt-3 sm:px-6 ${styles.sheet}`}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--hairline-strong)]" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <h2 id="more-title" className="t-label">
            {m.nav.moreTitle}
          </h2>
          <button
            type="button"
            onClick={() => onClose()}
            aria-label={m.common.close}
            className="grid h-11 w-11 place-items-center rounded-full text-mist hover:text-paper"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MORE.map((it) => {
            const active = at(path, it.href);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => onClose(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 items-center gap-3.5 rounded-[14px] border px-4 py-3 transition-colors duration-200 ${
                    active ? "border-paper/50 bg-well-2" : "border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:bg-well-2"
                  }`}
                >
                  <Icon name={it.icon} size={20} className={active ? "text-paper" : "text-mist"} />
                  <span className="min-w-0">
                    <span className="block font-medium leading-tight">{m.nav[it.key]}</span>
                    <span className="mt-0.5 block truncate text-[0.82rem] text-fog">{m.nav.moreHints[it.key]}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
