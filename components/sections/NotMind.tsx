import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { notMind } from "@/lib/copy";

/**
 * The honesty section. Spec 3.8.
 *
 * This is the page's credibility hinge, so it is built out of type and space
 * and nothing else: no image, no card, no border, no amber. Amber marks the
 * attended element, and here there is nothing to attend to but the sentences.
 * Anything decorative would read as sales, which is exactly the impression
 * this block exists to undo.
 *
 * Narrow measure (52ch) and centred, against the full width sections either
 * side. The change in rhythm is the whole design.
 *
 * Server rendered. The two primitives inside are the only client code needed.
 */
export default function NotMind() {
  return (
    <section
      id="plainly"
      aria-labelledby="plainly-heading"
      className="section bg-ink"
    >
      <div className="shell">
        <div className="mx-auto max-w-[52ch] text-center">
          <Reveal as="p" className="t-mono text-fog">
            {notMind.eyebrow}
          </Reveal>

          <MaskHeadline
            id="plainly-heading"
            lines={[notMind.headline]}
            className="t-h1 mt-6"
          />

          {/* staggerChildren makes each paragraph its own reveal target, so the
              three admissions arrive in reading order rather than as one block. */}
          <Reveal
            staggerChildren={60}
            className="mt-12 flex flex-col gap-7 text-mist md:mt-16"
          >
            {notMind.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
