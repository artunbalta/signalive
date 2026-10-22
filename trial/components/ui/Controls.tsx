"use client";

import { useId, type ReactNode } from "react";

/** A switch with a visible label and an optional hint, 48 px tall at least. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-start justify-between gap-4 py-1">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block font-medium leading-snug">{label}</span>
        {hint ? <span className="mt-1 block text-[0.88rem] leading-relaxed text-mist">{hint}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-8 w-[52px] shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-40 ${
          checked ? "border-paper bg-paper" : "border-[var(--hairline-strong)] bg-transparent"
        }`}
      >
        <span
          className={`absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full transition-[left,background-color] duration-200 ${
            checked ? "left-[24px] bg-ink" : "left-[3px] bg-mist"
          }`}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-full border border-[var(--hairline)] bg-well p-1 sm:w-auto">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`min-h-10 flex-1 rounded-full px-4 text-[0.9rem] transition-colors duration-200 disabled:opacity-40 sm:flex-none ${
              active ? "bg-paper font-medium text-ink" : "text-mist hover:text-paper"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="t-label">{label}</p>
      {children}
      {hint ? <p className="text-[0.85rem] leading-relaxed text-fog">{hint}</p> : null}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-12 w-full appearance-none rounded-[12px] border border-[var(--hairline-strong)] bg-well py-3 pl-4 pr-10 text-[0.95rem] disabled:opacity-40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink">
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-mist"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

/** An unticked box by default, always: consent must be an action. */
export function Checkbox({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex min-h-12 cursor-pointer items-start gap-3 py-1 ${disabled ? "opacity-40" : ""}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[6px] border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal ${
          checked ? "border-paper bg-paper text-ink" : "border-[var(--hairline-strong)]"
        }`}
      >
        {checked ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : null}
      </span>
      <span className="leading-snug">{children}</span>
    </label>
  );
}
