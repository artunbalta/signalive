import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { hero, science } from "@/lib/copy";

/* ==========================================================================
   FIGURE GEOMETRY, in viewBox units.
   The viewBox is deliberately small. SVG font sizes resolve into user units,
   so a .t-mono label (12px) is 12 units here and lands near 12 CSS px at the
   widths this column actually gets, from a 375px viewport up to the desktop
   grid. That is what keeps the labels legible instead of shrinking away.
   ========================================================================== */
const FIG_W = 340;
const FIG_H = 236;

/** The decision window. Its width is the only unit of time in the figure. */
const WIN_X1 = 104;
const WIN_X2 = 236;
const WIN_TOP = 28;
const WIN_BOTTOM = 184;
const BRACKET_Y = 198;

const ATTENDED_LABEL_Y = 18;
const ATTENDED_BASELINE = 62;
const ATTENDED_AMP = 26;

const IGNORED_LABEL_Y = 118;
const IGNORED_BASELINE = 158;
const IGNORED_AMP = 9;

const TAU = Math.PI * 2;

/**
 * Deterministic 32 bit LCG. The traces must be byte identical every render,
 * so nothing here may touch Math.random.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * One talker trace: three incommensurate carriers under a syllabic envelope,
 * so the line reads as speech rather than as a tone. It is an abstraction, not
 * a plot of a recording, which is why the caption says what it says.
 */
function talkerPath(seed: number, baseline: number, amp: number): string {
  const r = lcg(seed);
  const freq = [0.30 + r() * 0.08, 0.62 + r() * 0.12, 1.15 + r() * 0.2];
  const phase = [r() * TAU, r() * TAU, r() * TAU];
  const envRate = 0.045 + r() * 0.02;
  const envPhase = r() * TAU;

  let d = "";
  for (let x = 0; x <= FIG_W; x += 2) {
    // Speech comes in bursts, so the envelope never sits flat at full scale.
    const env = 0.3 + 0.7 * Math.abs(Math.sin(x * envRate + envPhase)) ** 1.5;
    const carrier =
      0.55 * Math.sin(x * freq[0] + phase[0]) +
      0.3 * Math.sin(x * freq[1] + phase[1]) +
      0.15 * Math.sin(x * freq[2] + phase[2]);
    d += `${x === 0 ? "M" : "L"}${x} ${(baseline - amp * env * carrier).toFixed(2)}`;
  }
  return d;
}

const ATTENDED_PATH = talkerPath(9137, ATTENDED_BASELINE, ATTENDED_AMP);
const IGNORED_PATH = talkerPath(4421, IGNORED_BASELINE, IGNORED_AMP);

/**
 * The science section. Paper surface, so .surface-paper flips the hairline to
 * black 10% and raises fog and mist to values that clear AA on white.
 *
 * Server rendered: the argument and the three qualified numbers are the point
 * of this section and they exist without JavaScript. Only the entrances are
 * client side, and they come from the shared primitives.
 */
export default function Science() {
  return (
    <section
      id="science"
      aria-labelledby="science-heading"
      className="surface-paper section bg-paper text-ink scroll-mt-[var(--nav-h)]"
    >
      <div className="shell">
        <div className="grid12 items-start">
          {/* LEFT: the argument. */}
          <div className="col-span-12 lg:col-span-6">
            <Reveal>
              <p className="t-mono text-fog">{science.eyebrow}</p>
            </Reveal>

            <MaskHeadline
              id="science-heading"
              lines={science.headlineLines}
              className="t-h1 mt-6"
            />

            <Reveal
              className="mt-10 flex max-w-[52ch] flex-col gap-6"
              staggerChildren={60}
            >
              {science.paragraphs.map((paragraph) => (
                /* Body copy sits under 18px, so it uses mist, never fog. */
                <p key={paragraph} className="text-body text-mist">
                  {paragraph}
                </p>
              ))}
            </Reveal>
          </div>

          {/* RIGHT: the technical figure. Inline SVG, no external asset. */}
          <Reveal
            className="col-span-12 mt-16 lg:col-span-5 lg:col-start-8 lg:mt-0"
            delay={120}
          >
            <figure className="m-0">
              <svg
                role="img"
                aria-label={science.figureCaption}
                viewBox={`0 0 ${FIG_W} ${FIG_H}`}
                className="block h-auto w-full"
              >
                {/* Edges of the decision window. Construction lines: sparse
                    dashes so they read as measurement, not as structure. */}
                <line
                  x1={WIN_X1}
                  y1={WIN_TOP}
                  x2={WIN_X1}
                  y2={WIN_BOTTOM}
                  className="stroke-fog"
                  strokeWidth={1}
                  strokeDasharray="2 6"
                />
                <line
                  x1={WIN_X2}
                  y1={WIN_TOP}
                  x2={WIN_X2}
                  y2={WIN_BOTTOM}
                  className="stroke-fog"
                  strokeWidth={1}
                  strokeDasharray="2 6"
                />

                {/* The attended talker. Amber marks it as attended, and the
                    heavier weight plus the larger amplitude carry the same
                    meaning for anyone who cannot separate the two by colour. */}
                <text x={0} y={ATTENDED_LABEL_Y} className="t-mono fill-ink">
                  {hero.leftVoice}
                </text>
                <path
                  d={ATTENDED_PATH}
                  fill="none"
                  className="stroke-signal"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* The competing talker, receded. */}
                <text x={0} y={IGNORED_LABEL_Y} className="t-mono fill-fog">
                  {hero.rightVoice}
                </text>
                <path
                  d={IGNORED_PATH}
                  fill="none"
                  className="stroke-fog"
                  strokeWidth={1.25}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* The window bracket, spanning both traces. Its label is the
                    stat value itself so the figure cannot drift from the
                    number printed below it. */}
                <path
                  d={`M${WIN_X1} ${BRACKET_Y - 6}V${BRACKET_Y}H${WIN_X2}V${BRACKET_Y - 6}`}
                  fill="none"
                  className="stroke-ink"
                  strokeWidth={1}
                />
                <text
                  x={(WIN_X1 + WIN_X2) / 2}
                  y={BRACKET_Y + 20}
                  textAnchor="middle"
                  className="t-mono fill-ink"
                >
                  {science.stats[1].value}
                </text>
              </svg>

              <figcaption className="t-mono text-fog mt-6 max-w-[46ch] leading-[1.7]">
                {science.figureCaption}
              </figcaption>
            </figure>
          </Reveal>

          {/* THE NUMBERS. Full width under both columns so each qualifier gets
              a measure it can actually be read at. Hairline above each block:
              on hover that one hairline goes amber, marking the stat as the
              attended element. It is the only amber in this block. */}
          <Reveal
            as="ul"
            className="col-span-12 mt-24 grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-3 lg:mt-32"
            staggerChildren={60}
          >
            {science.stats.map((stat) => (
              <li
                key={stat.value}
                className="border-t border-hairline pt-6 transition-colors duration-[240ms] ease-[var(--ease-out-att)] hover:border-t-signal"
              >
                <p className="t-h2">{stat.value}</p>
                <p className="text-small text-mist mt-5 max-w-[36ch]">
                  {stat.body}
                </p>
                {/* Permanently visible, never a hover or a tooltip. The 83%
                    figure is a published laboratory reference and must never be
                    readable as a Signalive product claim. Spec 3.9. */}
                <p className="t-mono text-fog mt-4 max-w-[40ch] leading-[1.7]">
                  {stat.qualifier}
                </p>
              </li>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
