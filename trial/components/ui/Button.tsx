import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2.5 rounded-[var(--radius-pill)] font-medium transition-[background-color,border-color,color,opacity,transform] duration-200 select-none disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary: "bg-paper text-ink hover:bg-[#ecece4]",
  secondary: "border border-[var(--hairline-strong)] text-paper hover:border-paper/60 hover:bg-white/[0.03]",
  ghost: "text-mist hover:text-paper",
};

// Touch targets stay at or above 48 px.
const sizes: Record<Size, string> = {
  md: "min-h-12 px-5 text-[0.95rem]",
  lg: "min-h-14 px-7 text-[1.05rem]",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  busy,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={buttonClass(variant, size, className)}
      aria-busy={busy || undefined}
      {...rest}
      disabled={rest.disabled || busy}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={18} /> : null}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  children,
  className = "",
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={18} /> : null}
    </Link>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
