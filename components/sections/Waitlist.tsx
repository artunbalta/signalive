"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { waitlist } from "@/lib/copy";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import CTAButton from "@/components/ui/CTAButton";

/**
 * Waitlist capture.
 *
 * Two things here are deliberate and easy to undo by accident:
 *
 *  1. Amber appears on exactly one thing, the bottom border of the field that
 *     currently has focus. That is the same statement the rest of the site
 *     makes with the colour: this is the element being attended to. Every
 *     other field sits on fog. Nothing else in this file is amber.
 *  2. The confirmation replaces the form inside the same box. The form stays
 *     mounted and merely becomes invisible, so the grid cell keeps the height
 *     it always had and nothing below this section moves when you submit.
 */

/** Deliberately permissive. The server revalidates and the inbox is the real test. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type FieldName = "email" | "context";
type FieldErrors = Partial<Record<FieldName, string>>;
type Status = "idle" | "submitting" | "done";

const EMAIL_ID = "waitlist-email";
const CONTEXT_ID = "waitlist-context";
const EMAIL_ERROR_ID = "waitlist-email-error";
const CONTEXT_ERROR_ID = "waitlist-context-error";

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

export default function Waitlist() {
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

  const emailRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef<HTMLSelectElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  const done = status === "done";

  // The submit button is disabled the moment the request starts, which drops
  // keyboard focus. Hand it to the confirmation so the tab position survives.
  useEffect(() => {
    if (done) successRef.current?.focus({ preventScroll: true });
  }, [done]);

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
      setStatus("done");
    } catch {
      setServerError(true);
      setStatus("idle");
    }
  };

  return (
    <section
      id="waitlist"
      aria-labelledby="waitlist-heading"
      className="section bg-ink flex min-h-[100svh] items-center"
    >
      <div className="shell w-full">
        <div className="mx-auto w-full max-w-[46rem]">
          {/* MaskHeadline runs its own reveal, so it is not wrapped in one. */}
          <MaskHeadline id="waitlist-heading" lines={[waitlist.headline]} className="t-h1" />

          <Reveal delay={160}>
            <p className="t-lead text-mist mt-10 max-w-[44ch]">{waitlist.body}</p>
          </Reveal>

          {/*
            One grid cell, two occupants. The form holds the height whether it
            is visible or not, which is what keeps the box from resizing when
            the confirmation takes over.
          */}
          <Reveal delay={280} className="mt-14 grid md:mt-16">
            {/* noValidate: the native bubble is a modal, and validation here is inline.
                The required attributes stay on, they are what assistive tech reads. */}
            <form
              noValidate
              onSubmit={onSubmit}
              aria-busy={status === "submitting"}
              aria-hidden={done}
              className={
                "col-start-1 row-start-1 transition-opacity duration-[240ms] " +
                (done ? "invisible opacity-0" : "opacity-100")
              }
            >
              <div>
                <label htmlFor={EMAIL_ID} className={LABEL_CLASS}>
                  {waitlist.emailLabel}
                </label>
                {/* The placeholder is fog rather than mist because it is an
                    example, not copy. The label carries the meaning, so nothing
                    is lost if the hint reads faintly. */}
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
                {/* Rendered even when empty: a live region announces reliably
                    only if it was already in the tree, and the reserved line
                    stops an error from nudging the layout. */}
                <p id={EMAIL_ERROR_ID} role="alert" className={`mt-2 ${ERROR_CLASS}`}>
                  {errors.email ?? ""}
                </p>
              </div>

              <div className="mt-8">
                <label htmlFor={CONTEXT_ID} className={LABEL_CLASS}>
                  {waitlist.contextLabel}
                </label>
                {/* The option list is painted by the OS, so the colour scheme
                    has to be declared or the popup opens white on this section. */}
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

              <p role="alert" className={`mt-6 ${ERROR_CLASS}`}>
                {serverError ? waitlist.errors.server : ""}
              </p>

              <div className="mt-4">
                <CTAButton
                  type="submit"
                  magnetic
                  disabled={status === "submitting"}
                  className="w-full sm:w-auto"
                >
                  {status === "submitting" ? waitlist.submitting : waitlist.submit}
                </CTAButton>
              </div>
            </form>

            {/* Mounted from the start so it can fade, empty until it has
                something to say so the live region actually fires. */}
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
          </Reveal>

          <Reveal delay={360}>
            <p className="t-mono text-fog mt-8">{waitlist.footnote}</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
