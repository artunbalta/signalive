"use client";

import { waitlist } from "@/lib/copy";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import WaitlistForm from "@/components/ui/WaitlistForm";

/**
 * Waitlist capture. The form itself, with its amber and confirmation rules,
 * lives in components/ui/WaitlistForm.tsx so /features can use it too.
 */
export default function Waitlist() {
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

          <Reveal delay={280} className="mt-14 md:mt-16">
            <WaitlistForm idPrefix="waitlist" />
          </Reveal>

          <Reveal delay={360}>
            <p className="t-mono text-fog mt-8">{waitlist.footnote}</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
