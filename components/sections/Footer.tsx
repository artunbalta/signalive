import Reveal from "@/components/ui/Reveal";
import { footer } from "@/lib/copy";
import { anchored } from "@/lib/trial";

/**
 * Page footer. Spec 3.11.
 *
 * Full bleed on ink, separated from the waitlist section by a single top
 * hairline and nothing else. No card, no radius, no shadow: depth on this site
 * comes from surface colour, and the footer sits on the same ink as the rest.
 *
 * Server rendered. Reveal is the only client code here.
 */

/**
 * Footer link. The amber rule underneath is the one piece of signal colour in
 * this file, and it is legitimate: it grows from the left to mark the link the
 * pointer or the keyboard is currently on, which is exactly what amber means.
 * It is a scaleX transform rather than an animated width so it never reflows,
 * and it is driven by CSS alone, so the reduced motion block in globals.css
 * collapses it to an instant state change with no JavaScript involved.
 */
const LINK_CLASS = [
  "relative inline-block text-small text-mist",
  "transition-colors duration-[var(--d-fast)] ease-[var(--ease-out-att)]",
  "hover:text-paper focus-visible:text-paper",
  "after:absolute after:inset-x-0 after:-bottom-1 after:h-px after:content-['']",
  "after:origin-left after:scale-x-0 after:bg-signal",
  "after:transition-transform after:duration-[var(--d-fast)] after:ease-[var(--ease-out-att)]",
  "hover:after:scale-x-100 focus-visible:after:scale-x-100",
].join(" ");

export default function Footer({ base = "" }: { base?: string } = {}) {
  return (
    <footer
      id="footer"
      /* The wordmark is the accessible name of the contentinfo landmark. */
      aria-labelledby="footer-wordmark"
      className="border-t border-hairline bg-ink"
    >
      <div className="shell py-20 lg:py-28">
        {/* Three columns at md: wordmark 6, then 3 and 3. Below md every column
            is full width, so the whole block stacks in reading order. */}
        <Reveal className="grid12" staggerChildren={60}>
          <div className="col-span-12 md:col-span-6">
            <p id="footer-wordmark">
              <img
                src="/media/wordmark-light.png"
                alt={footer.wordmark}
                width={900}
                height={77}
                className="h-[22px] w-auto select-none"
                draggable={false}
              />
            </p>
            {/* Set at lead size on purpose. Fog only clears AA at large sizes,
                so the positioning line is large or it is not fog. */}
            <p className="t-lead mt-5 max-w-[26ch] text-fog">
              {footer.positioning}
            </p>
          </div>

          {footer.columns.map((column) => {
            const headingId = `footer-${column.heading
              .toLowerCase()
              .replace(/\s+/g, "-")}`;

            return (
              <nav
                key={column.heading}
                aria-labelledby={headingId}
                className="col-span-12 sm:col-span-6 md:col-span-3"
              >
                <h2 id={headingId} className="t-mono text-fog">
                  {column.heading}
                </h2>
                <ul className="mt-6 flex flex-col gap-3.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <a href={anchored(link.href, base)} className={LINK_CLASS}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            );
          })}
        </Reveal>

        {/* Fine print, full width and fully visible. This block is the company
            saying what the product is not, so it is never collapsed behind a
            toggle. text-mono is the 12px type step, not the mono face; mist
            rather than fog because 12px fog on ink misses AA. */}
        <Reveal className="mt-20 border-t border-hairline pt-10 lg:mt-28">
          <div className="flex max-w-[86ch] flex-col gap-3 text-mono leading-[1.7] text-mist">
            {footer.finePrint.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <p className="mt-8 text-mono leading-[1.7] text-mist">
            {footer.legal}
          </p>
        </Reveal>
      </div>
    </footer>
  );
}
