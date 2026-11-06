import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { whereSignal } from "@/lib/copy";

const HEADING_ID = "where-heading";

/** The same soft edge the eartip rotation used, so the still sits on ink
 *  without a frame. */
const EDGE_FADE =
  "radial-gradient(ellipse 66% 70% at 50% 50%, #000 46%, rgba(0,0,0,0.62) 72%, transparent 100%)";

/**
 * Where the contacts go, and why. It takes the place of the eartip rotation:
 * public recordings made in the ear canal and around the ear at the same
 * moments put the signal around the ear, so the section shows contacts there
 * and says what measured it. The numbers carry their qualifiers in plain
 * sight, like the science section's.
 *
 * Server rendered: the argument and its numbers exist without JavaScript.
 */
export default function WhereSignal() {
  return (
    <section
      id="where"
      aria-labelledby={HEADING_ID}
      className="section bg-ink text-paper scroll-mt-[var(--nav-h)]"
    >
      <div className="shell">
        <div className="grid12 items-center gap-y-12">
          <div className="col-span-12 lg:col-span-5">
            <Reveal as="p" className="t-mono text-fog">
              {whereSignal.eyebrow}
            </Reveal>
            <MaskHeadline
              id={HEADING_ID}
              lines={whereSignal.headlineLines}
              className="t-h1 mt-6 text-paper"
              style={{ fontSize: "clamp(2.25rem, 3.2vw, 3rem)" }}
            />
            <Reveal className="mt-8 flex max-w-[46ch] flex-col gap-5 lg:mt-10" staggerChildren={60}>
              {whereSignal.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-mist">
                  {paragraph}
                </p>
              ))}
            </Reveal>
          </div>

          <Reveal className="col-span-12 lg:col-span-7 lg:col-start-6" delay={120}>
            <figure className="m-0">
              <picture>
                <source media="(max-width: 700px)" srcSet="/media/concept/arc-worn-1000.webp" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/media/concept/arc-worn-1600.webp"
                  width={1600}
                  height={893}
                  alt={whereSignal.figureAlt}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full"
                  style={{ WebkitMaskImage: EDGE_FADE, maskImage: EDGE_FADE }}
                />
              </picture>
              <figcaption className="t-mono text-fog mt-4 max-w-[52ch] leading-[1.7]">
                {whereSignal.figureCaption}
              </figcaption>
            </figure>
          </Reveal>

          {/* Each number keeps its source and its qualifier visible, never in
              a hover: these are research recordings, not product measurements. */}
          <Reveal
            as="ul"
            className="col-span-12 mt-8 grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-3 lg:mt-16"
            staggerChildren={60}
          >
            {whereSignal.stats.map((stat) => (
              <li key={stat.body} className="border-t border-hairline pt-6">
                <p className="t-h2">{stat.value}</p>
                <p className="text-small text-mist mt-5 max-w-[36ch]">{stat.body}</p>
                <p className="t-mono text-fog mt-4 max-w-[40ch] leading-[1.7]">{stat.qualifier}</p>
              </li>
            ))}
          </Reveal>

          <Reveal className="col-span-12">
            <a href="/research#in-ear" className="group inline-flex items-baseline gap-3 text-body">
              <span className="border-b border-hairline pb-1 transition-colors duration-[240ms] group-hover:border-current">
                {whereSignal.researchLink}
              </span>
              <span aria-hidden="true" className="transition-transform duration-[240ms] group-hover:translate-x-1">
                {"→"}
              </span>
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
