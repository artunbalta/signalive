import type { ReactNode } from "react";
import CTAButton from "@/components/ui/CTAButton";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { features } from "@/lib/copy";
import { TRIAL_URL } from "@/lib/trial";
import { AssistantGlyph, FocusFigure, LabGlyph, NotesGlyph, RewindFigure } from "./figures";

/* ==========================================================================
   /features. What the web trial does today, one section per surface, ink and
   paper alternating as on the home page. Server rendered: the copy is the
   substance and exists without JavaScript; entrances and the trial links are
   the only interactive parts.
   ========================================================================== */

const INK = "bg-ink text-paper";
const PAPER = "surface-paper bg-paper text-ink";

/** Underlined text action, for secondary links on either surface. */
const TEXT_LINK =
  "text-body underline underline-offset-[5px] decoration-[1px] transition-opacity duration-[240ms] hover:opacity-60";

/**
 * The way into the trial for one feature. Paper on ink is the site's primary
 * pill; on a paper surface the same pill is ink, so it stays visible. With no
 * trial deployed yet, nothing renders: the hero already says how to get in.
 */
function TryIt({ label, path, paper }: { label: string; path: string; paper: boolean }) {
  if (!TRIAL_URL) return null;
  const href = `${TRIAL_URL}${path}`;
  if (!paper) return <CTAButton href={href}>{label}</CTAButton>;
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center rounded-[var(--radius-pill)] bg-ink px-7 py-3.5 text-[0.9375rem] font-medium text-paper transition-opacity duration-[240ms] hover:opacity-85 active:scale-[0.98]"
    >
      {label}
    </a>
  );
}

export function FeaturesHero() {
  const all = [...features.channels, ...features.more];
  return (
    <section
      id="features-hero"
      aria-labelledby="features-heading"
      className={`section ${INK} pt-[calc(var(--bar-h)+var(--nav-h)+var(--rhythm))]`}
    >
      <div className="shell">
        <Reveal>
          <p className="t-mono text-fog">{features.eyebrow}</p>
        </Reveal>
        <MaskHeadline as="h1" id="features-heading" lines={features.headlineLines} className="t-h1 mt-6" />
        <Reveal className="mt-8 max-w-[46ch]">
          <p className="t-lead text-mist">{features.lead}</p>
        </Reveal>
        <Reveal className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-5" delay={120}>
          {TRIAL_URL ? (
            <>
              <CTAButton href={TRIAL_URL} magnetic>
                {features.openTrial}
              </CTAButton>
              <a href="/#waitlist" className={TEXT_LINK}>
                {features.joinWaitlist}
              </a>
            </>
          ) : (
            <>
              <CTAButton href="/#waitlist" magnetic>
                {features.joinWaitlist}
              </CTAButton>
              <p className="text-body text-mist">{features.trialClosed}</p>
            </>
          )}
        </Reveal>

        <nav aria-label={features.indexLabel} className="mt-[var(--rhythm)] border-t border-hairline pt-8">
          <Reveal as="ol" className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5" staggerChildren={60}>
            {all.map((f) => (
              <li key={f.id}>
                <a href={`#${f.id}`} className="group flex flex-col gap-2">
                  <span className="t-mono text-fog">{f.index}</span>
                  <span className="text-body transition-opacity duration-[240ms] group-hover:opacity-60">{f.name}</span>
                </a>
              </li>
            ))}
          </Reveal>
        </nav>
      </div>
    </section>
  );
}

/** One of the two channels, gesture or attention, at full scale. */
export function ChannelFeature({ which, paper, figure }: { which: 0 | 1; paper: boolean; figure: ReactNode }) {
  const c = features.channels[which];
  return (
    <section id={c.id} aria-labelledby={`${c.id}-heading`} className={`section ${paper ? PAPER : INK} scroll-mt-[var(--nav-h)]`}>
      <div className="shell grid12 items-center">
        <div className="col-span-12 lg:col-span-6">
          <Reveal>
            <p className="t-mono text-fog">
              {c.index}
              <span className="ml-4">{c.kind}</span>
            </p>
          </Reveal>
          <MaskHeadline id={`${c.id}-heading`} lines={c.headlineLines} className="t-h1 mt-6" />
          <Reveal className="mt-10 flex max-w-[50ch] flex-col gap-5" staggerChildren={60}>
            {c.body.map((p) => (
              <p key={p} className="text-body text-mist">
                {p}
              </p>
            ))}
          </Reveal>
          <Reveal className="mt-10 max-w-[50ch] border-t border-hairline pt-6">
            <p className="t-mono text-fog">{features.inTheTrial}</p>
            <p className="mt-3 text-small leading-relaxed text-mist">{c.note}</p>
          </Reveal>
          <Reveal className="mt-10 empty:hidden">
            <TryIt label={`${features.tryPrefix} ${c.name}`} path={c.path} paper={paper} />
          </Reveal>
        </div>
        <Reveal className="col-span-12 mt-16 lg:col-span-5 lg:col-start-8 lg:mt-0" delay={120}>
          {figure}
        </Reveal>
      </div>
    </section>
  );
}

export function RewindFeature({ paper }: { paper: boolean }) {
  return <ChannelFeature which={0} paper={paper} figure={<RewindFigure />} />;
}

export function FocusFeature({ paper }: { paper: boolean }) {
  return <ChannelFeature which={1} paper={paper} figure={<FocusFigure />} />;
}

const GLYPHS = { assistant: AssistantGlyph, notes: NotesGlyph, lab: LabGlyph } as const;

export function MoreFeatures({ paper }: { paper: boolean }) {
  return (
    <section aria-labelledby="more-heading" className={`section ${paper ? PAPER : INK}`}>
      <div className="shell">
        <Reveal>
          <p className="t-mono text-fog">{features.moreEyebrow}</p>
        </Reveal>
        <MaskHeadline id="more-heading" lines={features.moreHeadlineLines} className="t-h1 mt-6" />
        <div className="grid12 mt-16 gap-y-16">
          {features.more.map((f, i) => {
            const Glyph = GLYPHS[f.id as keyof typeof GLYPHS];
            return (
              <Reveal
                as="article"
                key={f.id}
                id={f.id}
                delay={i * 80}
                className="col-span-12 flex scroll-mt-[calc(var(--nav-h)+24px)] flex-col border-t border-hairline pt-8 md:col-span-4"
              >
                <Glyph label={f.figureLabel} />
                <p className="t-mono mt-8 text-fog">
                  {f.index}
                  <span className="ml-4">{f.name}</span>
                </p>
                <h3 className="mt-4 font-[family-name:var(--font-display)] text-[clamp(1.5rem,2.2vw,2rem)] font-medium leading-[1.1] tracking-[-0.02em]">
                  {f.title}
                </h3>
                <p className="mt-5 text-body text-mist">{f.body}</p>
                <p className="mt-5 text-small leading-relaxed text-mist">
                  <span className="t-mono mr-2 text-fog">{features.inTheTrial}</span>
                  {f.note}
                </p>
                {/* Pinned to the bottom, so the three buttons line up whatever the titles wrap to. */}
                <div className="mt-auto pt-8 empty:hidden">
                  <TryIt label={`${features.tryPrefix} ${f.name}`} path={f.path} paper={paper} />
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Privacy({ paper }: { paper: boolean }) {
  return (
    <section aria-labelledby="privacy-heading" className={`section ${paper ? PAPER : INK}`}>
      <div className="shell grid12 items-start">
        <div className="col-span-12 lg:col-span-5">
          <Reveal>
            <p className="t-mono text-fog">{features.privacyEyebrow}</p>
          </Reveal>
          <MaskHeadline id="privacy-heading" lines={features.privacyHeadlineLines} className="t-h1 mt-6" />
        </div>
        <Reveal className="col-span-12 mt-12 flex flex-col lg:col-span-6 lg:col-start-7 lg:mt-0" staggerChildren={60}>
          {features.privacy.map((p) => (
            <div key={p.label} className="border-t border-hairline py-7">
              <p className="t-mono text-fog">{p.label}</p>
              <p className="mt-3 text-body text-mist">{p.body}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function Closing({ paper }: { paper: boolean }) {
  return (
    <section aria-labelledby="closing-heading" className={`section ${paper ? PAPER : INK}`}>
      <div className="shell">
        <MaskHeadline id="closing-heading" lines={features.closingLines} className="t-h1" />
        <Reveal className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-5" delay={120}>
          {TRIAL_URL ? (
            <>
              <TryIt label={features.openTrial} path="" paper={paper} />
              <a href="/#waitlist" className={TEXT_LINK}>
                {features.joinWaitlist}
              </a>
            </>
          ) : (
            <a href="/#waitlist" className={TEXT_LINK}>
              {features.joinWaitlist}
            </a>
          )}
        </Reveal>
      </div>
    </section>
  );
}
