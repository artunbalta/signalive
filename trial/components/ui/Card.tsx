import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Card({
  children,
  className = "",
  as: Tag = "section",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "li";
  "aria-label"?: string;
}) {
  return (
    <Tag
      aria-label={ariaLabel}
      className={`relative rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well p-5 sm:p-6 ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="t-label mb-1.5">{eyebrow}</p> : null}
        <h2 className="text-[1.25rem] leading-tight">{title}</h2>
      </div>
      {children}
    </div>
  );
}

/**
 * Warnings and errors: an icon, what happened, and what to do next. Severity
 * is in the icon and the words, not in a color.
 */
export function Callout({
  kind = "info",
  title,
  children,
  action,
}: {
  kind?: "info" | "warn" | "error" | "success";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const icon = kind === "warn" ? "warn" : kind === "error" ? "error" : kind === "success" ? "check" : "info";
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex gap-3 rounded-[12px] border p-4 ${
        kind === "error" || kind === "warn" ? "border-[var(--hairline-strong)] bg-well-2" : "border-[var(--hairline)] bg-well"
      }`}
    >
      <Icon name={icon} size={20} className="mt-0.5 text-paper" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-medium leading-snug text-paper">{title}</p>
        {children ? <div className="text-[0.92rem] leading-relaxed text-mist">{children}</div> : null}
        {action ? <div className="pt-1.5">{action}</div> : null}
      </div>
    </div>
  );
}
