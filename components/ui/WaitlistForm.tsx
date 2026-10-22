"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { waitlist } from "@/lib/copy";
import CTAButton from "@/components/ui/CTAButton";

/**
 * The waitlist form, shared by the home page's waitlist section and the
 * /features page (which shows it twice: in its first screen, and as the
 * full section at the end).
 *
 * Three things here are deliberate and easy to undo by accident:
 *
 *  1. Amber appears on exactly one thing, the bottom border of the field that
 *     currently has focus. That is the same statement the rest of the site
 *     makes with the colour: this is the element being attended to. Every
 *     other field sits on fog. Nothing else in this file is amber.
 *  2. The confirmation replaces the form inside the same box. The form stays
 *     mounted and merely becomes invisible, so the grid cell keeps the height
 *     it always had and nothing below it moves when you submit.
 *  3. Every form on a page shares one "joined" state: signing up in one shows
 *     the confirmation in all of them, so nobody is asked twice.
 */

/** Deliberately permissive. The server revalidates and the inbox is the real test. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type FieldName = "email" | "context";
type FieldErrors = Partial<Record<FieldName, string>>;
type Status = "idle" | "submitting";

let joined = false;
const joinedListeners = new Set<() => void>();
function markJoined() {
  joined = true;
  for (const l of joinedListeners) l();
}
function useJoined(): boolean {
  return useSyncExternalStore(
    (l) => {
      joinedListeners.add(l);
      return () => joinedListeners.delete(l);
    },
    () => joined,
    () => false,
  );
}

const LABEL_CLASS = "t-mono text-fog block mb-3";

/** Width only. The colour is chosen per field below, never here. */
const FIELD_CLASS =
  "w-full rounded-none border-b bg-transparent px-0 py-3.5 text-body text-paper " +
  "transition-colors duration-[240ms]";

/**
 * Error copy sits on paper rather than mist. The palette has no red, so the
 * only honest way to make a correction read as urgent is full contrast.
 */
const ERROR_CLASS = "min-h-[1.5rem] text-small text-paper";

type Props = {
  /**
   * One row on wide screens (email, where, button) for a page's first screen;
   * stacked otherwise, and always stacked in the default layout.
   */
  compact?: boolean;
  /** Prefix for the field ids; the home section keeps its historical ones. */
  idPrefix?: string;
};

export default function WaitlistForm({ compact = false, idPrefix }: Props) {
  const fallbackId = useId();
  const prefix = idPrefix ?? `waitlist${fallbackId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const EMAIL_ID = `${prefix}-email`;
  const CONTEXT_ID = `${prefix}-context`;
  const EMAIL_ERROR_ID = `${prefix}-email-error`;
  const CONTEXT_ERROR_ID = `${prefix}-context-error`;

  const [email, setEmail] = useState("");
  const [context, setContext] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  /**
   * Focus is tracked in state rather than with a focus: variant so that exactly
   * one border colour class is ever applied to a field. It removes any chance
   * of a specificity accident quietly leaving two fields amber at once.
   */
  const [focused, setFocused] = useState<FieldName | null>(null);
  const [submittedHere, setSubmittedHere] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef<HTMLSelectElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  const done = useJoined();

  // The submit button is disabled the moment the request starts, which drops
  // keyboard focus. Hand it to the confirmation so the tab position survives,
  // but only in the form that was used: the others just change quietly.
  useEffect(() => {
    if (done && submittedHere) successRef.current?.focus({ preventScroll: true });
  }, [done, submittedHere]);

  const borderClass = (field: FieldName) => {
    if (focused === field) return "border-signal"; // the attended field
    if (errors[field]) return "border-paper";
    return "border-fog";
  };

  const onEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    setServerError(false);
    // Clear on the keystroke that fixes it. Never introduce an error mid typing.
    if (errors.email && EMAIL_RE.test(value.trim())) {
      setErrors((prev) => ({ ...prev, email: undefined }));
    }
  };

  const onContextChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setContext(value);
    setServerError(false);
    if (errors.context && value) {
      setErrors((prev) => ({ ...prev, context: undefined }));
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === "submitting") return;

    const next: FieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = waitlist.errors.email;
    if (!waitlist.contextOptions.includes(context)) next.context = waitlist.errors.context;
    setErrors(next);
    setServerError(false);

    if (next.email || next.context) {
      // Send the caret to the first problem so the alert is reachable, not just audible.
      (next.email ? emailRef : contextRef).current?.focus();
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), context }),
      });
      if (!res.ok) throw new Error(`Waitlist responded ${res.status}`);
      setSubmittedHere(true);
      markJoined();
    } catch {
      setServerError(true);
    } finally {
      setStatus("idle");
    }
  };

  const emailField = (
    <div className={compact ? "lg:col-span-5" : undefined}>
      <label htmlFor={EMAIL_ID} className={LABEL_CLASS}>
        {waitlist.emailLabel}
      </label>
      {/* The placeholder is fog rather than mist because it is an example,
          not copy. The label carries the meaning, so nothing is lost if the
          hint reads faintly. */}
      <input
        ref={emailRef}
        id={EMAIL_ID}
        name="email"
        type="email"
        required
        autoComplete="email"
        spellCheck={false}
        placeholder={waitlist.emailPlaceholder}
        value={email}
        onChange={onEmailChange}
        onFocus={() => setFocused("email")}
        onBlur={() => setFocused(null)}
        aria-invalid={errors.email ? true : undefined}
        aria-describedby={EMAIL_ERROR_ID}
        className={`${FIELD_CLASS} ${borderClass("email")} placeholder:text-fog`}
      />
      {/* Rendered even when empty: a live region announces reliably only if
          it was already in the tree, and the reserved line stops an error
          from nudging the layout. */}
      <p id={EMAIL_ERROR_ID} role="alert" className={`mt-2 ${ERROR_CLASS}`}>
        {errors.email ?? ""}
      </p>
    </div>
  );

  const contextField = (
    <div className={compact ? "mt-6 lg:col-span-4 lg:mt-0" : "mt-8"}>
      <label htmlFor={CONTEXT_ID} className={LABEL_CLASS}>
        {waitlist.contextLabel}
      </label>
      {/* The option list is painted by the OS, so the colour scheme has to be
          declared or the popup opens white on this surface. */}
      <div className="relative">
        <select
          ref={contextRef}
          id={CONTEXT_ID}
          name="context"
          required
          value={context}
          onChange={onContextChange}
          onFocus={() => setFocused("context")}
          onBlur={() => setFocused(null)}
          aria-invalid={errors.context ? true : undefined}
          aria-describedby={CONTEXT_ERROR_ID}
          style={{ colorScheme: "dark" }}
          className={`${FIELD_CLASS} ${borderClass("context")} appearance-none pr-8`}
        >
          <option value="">{waitlist.contextLabel}</option>
          {waitlist.contextOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 8"
          className="text-fog pointer-events-none absolute top-1/2 right-0 h-2 w-3 -translate-y-1/2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        >
          <path d="M1 1.5 6 6.5 11 1.5" />
        </svg>
      </div>
      <p id={CONTEXT_ERROR_ID} role="alert" className={`mt-2 ${ERROR_CLASS}`}>
        {errors.context ?? ""}
      </p>
    </div>
  );

  const submit = (
    <CTAButton type="submit" magnetic disabled={status === "submitting"} className="w-full sm:w-auto">
      {status === "submitting" ? waitlist.submitting : waitlist.submit}
    </CTAButton>
  );

  return (
    /* One grid cell, two occupants. The form holds the height whether it is
       visible or not, which is what keeps the box from resizing when the
       confirmation takes over. */
    <div className="grid">
      {/* noValidate: the native bubble is a modal, and validation here is
          inline. The required attributes stay on, they are what assistive
          tech reads. */}
      <form
        noValidate
        onSubmit={onSubmit}
        aria-busy={status === "submitting"}
        aria-hidden={done}
        className={
          "col-start-1 row-start-1 transition-opacity duration-[240ms] " + (done ? "invisible opacity-0" : "opacity-100")
        }
      >
        {compact ? (
          <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-8">
            {emailField}
            {contextField}
            {/* Level with the fields: the label line above them, then the button. */}
            <div className="mt-4 lg:col-span-3 lg:mt-[1.75rem]">{submit}</div>
            <p role="alert" className={`mt-2 lg:col-span-12 ${ERROR_CLASS}`}>
              {serverError ? waitlist.errors.server : ""}
            </p>
          </div>
        ) : (
          <>
            {emailField}
            {contextField}
            <p role="alert" className={`mt-6 ${ERROR_CLASS}`}>
              {serverError ? waitlist.errors.server : ""}
            </p>
            <div className="mt-4">{submit}</div>
          </>
        )}
      </form>

      {/* Mounted from the start so it can fade, empty until it has something
          to say so the live region actually fires. */}
      <div
        role="status"
        className={
          "col-start-1 row-start-1 flex flex-col justify-center transition-opacity duration-[240ms] " +
          (done ? "opacity-100" : "pointer-events-none opacity-0")
        }
      >
        {done ? (
          <>
            <h3 ref={successRef} tabIndex={-1} className="t-h2">
              {waitlist.successHeading}
            </h3>
            <p className="text-body text-mist mt-5 max-w-[40ch]">{waitlist.successBody}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
