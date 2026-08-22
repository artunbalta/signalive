import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { problem } from "@/lib/copy";

/**
 * The problem statement. Spec 3.3.
 *
 * Type only, no image, no card, no amber. It follows the loud hero, so the
 * job here is a drop in volume: one column of headline, one column of prose,
 * and a lot of empty grid between them. Anything decorative would put the
 * energy back.
 *
 * Server rendered. Reveal and MaskHeadline are the only client code involved.
 */
export default function Problem() {
  return (
    <section
      id="problem"
      aria-labelledby="problem-heading"
      className="section bg-ink"
    >
      <div className="shell grid12">
        {/* Headline block sits left and high. Capped at nine columns so the
            long second line wraps into a stack rather than running the full
            1280, which is what gives the section its quiet. */}
        <div className="col-span-12 lg:col-span-9">
          <Reveal as="p" className="t-mono text-fog">
            {problem.eyebrow}
          </Reveal>

          <MaskHeadline
            id="problem-heading"
            lines={problem.headlineLines}
            className="t-h1 mt-6"
          />
        </div>

        {/* Body drops to the second row and indents to column six, so the eye
            travels down and across instead of restarting at the left margin.
            60ch is the measure cap; the seven column track is wider than that
            on purpose, so the line length never depends on the viewport.
            staggerChildren gives each paragraph its own entrance in reading
            order rather than revealing the block as one slab. */}
        <Reveal
          staggerChildren={60}
          className="col-span-12 mt-12 flex max-w-[60ch] flex-col gap-7 md:mt-16 lg:col-span-7 lg:col-start-6 lg:row-start-2 lg:mt-24"
        >
          {/* One paragraph, two colours. The lead sentence carries the section
              in paper; the qualifier that follows belongs to the same idea, so
              it stays inside the same <p> and only steps back in weight.
              text-mist, not text-fog: this is 17px on ink and fog fails AA
              below 18px. Spec 6.3. */}
          <p className="text-mist">
            <span className="text-paper">{problem.leadSentence}</span>
            {problem.leadRest}
          </p>

          {problem.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-mist">
              {paragraph}
            </p>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
