"use client";

import { useEffect, useRef, useState } from "react";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { oneClench, thePoint } from "@/lib/copy";

const HEADING_ID = "the-point-heading";
const VOCAB_ID = "the-point-vocabulary";

function Opening() {
  return (
    <div className="grid12">
      <div className="col-span-12 lg:col-span-10">
        <Reveal>
          <p className="t-mono text-fog">{thePoint.eyebrow}</p>
        </Reveal>

        <MaskHeadline
          id={HEADING_ID}
          lines={thePoint.headlineLines}
          className="t-h1 mt-8 text-paper"
        />

        <Reveal className="mt-12 flex flex-col gap-6" staggerChildren={60}>
          {thePoint.paragraphs.map((paragraph) => (
            // Lead size: this is the section's argument, and at body size
            // under an 80px headline it read as fine print.
            <p key={paragraph} className="t-lead max-w-[54ch] text-mist">
              {paragraph}
            </p>
          ))}
        </Reveal>
      </div>
    </div>
  );
}

/** Why three is enough. The crux, so it gets a rule above it, a narrower
 *  measure and the largest gap on the page either side. */
function Context() {
  return (
    <div className="grid12 border-t border-hairline pt-24 lg:pt-36">
      <div className="col-span-12 lg:col-span-8 lg:col-start-3">
        <MaskHeadline
          as="h3"
          lines={thePoint.context.headlineLines}
          className="t-h2 text-paper"
        />
        <Reveal>
          <p className="t-lead mt-10 max-w-[52ch] text-mist">
            {thePoint.context.body}
          </p>
        </Reveal>
      </div>
    </div>
  );
}


function GestureStudio({ mode, playing }: { mode: number; playing: boolean }) {
  return (
    <div className="gesture-studio" data-mode={mode} data-playing={playing}>
      <div className="gesture-studio-top t-mono"><span>Signalive / Gesture input</span><span>0{mode + 1}</span></div>
      <div className="gesture-object">
        <img src="/media/seq/frame-032.webp" width="1000" height="562" alt="Signalive earbud with its metal contact rings set into the silicone eartip" loading="lazy" />
        <div className="gesture-register" aria-hidden="true"><span /><span /></div>
      </div>
      <div className="gesture-trace" aria-hidden="true">
        <span className="gesture-trace-label t-mono">{thePoint.vocabulary[mode].label}</span>
        <svg viewBox="0 0 400 48" preserveAspectRatio="none">
          <path className="gesture-baseline" d="M0 32 H400" />
          <path className="gesture-pulse" pathLength="100" d={mode === 0 ? "M0 32 H155 L164 32 L171 8 L178 40 L186 32 H400" : mode === 1 ? "M0 32 H135 L146 32 L153 8 L160 40 L168 32 H208 L216 8 L223 40 L231 32 H400" : "M0 32 H117 L129 13 H270 L282 32 H400"} />
        </svg>
      </div>
      <div className="gesture-result" key={mode}>
        <div className="gesture-result-icon" aria-hidden="true">{mode === 0 ? "↗" : mode === 1 ? "↶" : "↗"}</div>
        <div>
          <p className="t-mono text-fog">{["Saved to calendar", "Capture removed", "Answered in your ear"][mode]}</p>
          <p className="gesture-result-title">{mode === 0 ? oneClench.card.title : mode === 1 ? "Back to the conversation." : "A question. A quiet answer."}</p>
          <p className="gesture-result-detail">{mode === 0 ? `${oneClench.card.day} · ${oneClench.card.time}` : mode === 1 ? "One double clench. Nothing to open." : "No screen. No spoken command."}</p>
        </div>
        <span className="gesture-result-mark" aria-hidden="true">{mode === 1 ? "−" : "✓"}</span>
      </div>
    </div>
  );
}

export default function ThePoint() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const studioRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const node = studioRef.current;
    if (!node) return;
    const io = new IntersectionObserver(([entry]) => setPlaying(entry.isIntersecting), { threshold: 0.15 });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <section id="the-point" aria-labelledby={HEADING_ID} data-stage-active={index} className="bg-ink text-paper scroll-mt-[var(--nav-h)]">
      <div className="shell pt-[var(--rhythm)] pb-24 lg:pb-32"><Opening /></div>
      <div ref={studioRef} className="shell gesture-section">
        <div className="gesture-section-heading"><h3 id={VOCAB_ID} className="t-mono text-fog">{thePoint.vocabularyHeading}</h3><span className="t-mono text-fog">Three gestures. No interruption.</span></div>
        <div role="tablist" aria-labelledby={VOCAB_ID} className="gesture-tabs">
          {thePoint.vocabulary.map((item, i) => (
            <button key={item.label} ref={(el) => { tabRefs.current[i] = el; }} id={`gesture-tab-${i}`} type="button" role="tab" aria-selected={index === i} aria-controls="gesture-panel" tabIndex={index === i ? 0 : -1} onClick={() => setIndex(i)} onKeyDown={(e) => {
              let next = i;
              if (e.key === "ArrowRight") next = (i + 1) % 3;
              else if (e.key === "ArrowLeft") next = (i + 2) % 3;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = 2;
              else return;
              e.preventDefault(); setIndex(next); tabRefs.current[next]?.focus();
            }}><span className="t-mono gesture-tab-number">0{i + 1}</span><span>{item.label}</span><span className={`gesture-symbol gesture-symbol-${i}`} aria-hidden="true"><i />{i === 1 && <i />}</span></button>
          ))}
        </div>
        <div id="gesture-panel" role="tabpanel" aria-labelledby={`gesture-tab-${index}`} tabIndex={0} className="gesture-panel">
          <div className="gesture-copy" key={`copy-${index}`}>
            <span className="gesture-count" aria-hidden="true">0{index + 1}<span>/ 03</span></span>
            <h4>{thePoint.vocabulary[index].title}</h4>
            <p>{thePoint.vocabulary[index].body}</p>
            <div className="gesture-copy-foot"><span className="gesture-status-dot" /><span className="t-mono">{["One deliberate movement", "Two movements. Taken back.", "Hold. Your assistant is here."][index]}</span></div>
          </div>
          <GestureStudio key={`studio-${index}`} mode={index} playing={playing} />
        </div>
      </div>
      <div className="shell pt-24 pb-[var(--rhythm)] lg:pt-36"><Context /></div>
    </section>
  );
}
