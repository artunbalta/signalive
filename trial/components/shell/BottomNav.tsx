"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/providers/AppProviders";
import { Icon, type IconName } from "@/components/ui/Icon";

const ITEMS: { href: string; key: "assistant" | "focus" | "rewind" | "recorder" | "notes" | "lab" | "settings"; icon: IconName }[] = [
  { href: "/assistant", key: "assistant", icon: "mic" },
  { href: "/focus", key: "focus", icon: "focus" },
  { href: "/rewind", key: "rewind", icon: "rewind" },
  { href: "/recorder", key: "recorder", icon: "wave" },
  { href: "/notes", key: "notes", icon: "notes" },
  { href: "/lab", key: "lab", icon: "chart" },
  { href: "/settings", key: "settings", icon: "gear" },
];

export function BottomNav() {
  const { m } = useI18n();
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline)] bg-ink/92 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid h-[var(--nav-h)] max-w-[800px] grid-cols-7">
        {ITEMS.map((it) => {
          const active = path === it.href || path.startsWith(`${it.href}/`);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 text-[0.7rem] transition-colors ${
                  active ? "text-paper" : "text-fog hover:text-mist"
                }`}
              >
                <Icon name={it.icon} size={22} />
                <span className="truncate">{m.nav[it.key]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
