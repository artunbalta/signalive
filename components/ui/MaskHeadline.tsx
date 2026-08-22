"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, ElementType } from "react";

type Props = {
  /** Editorial lines exactly as written in the copy deck. */
  lines: string[];
  as?: ElementType;
  className?: string;
  /** Milliseconds between line entrances. Spec 4.4 asks for 80ms. */
  stagger?: number;
  id?: string;
  /** Inline style. The display classes are unlayered, so a size override has
   *  to come from here rather than from a utility class. */
  style?: CSSProperties;
};

/**
 * Headline mask reveal, by visual line.
 *
 * The server renders plain text, so the headline is readable with JavaScript
 * disabled and is a single clean string for assistive technology. On mount we
 * measure where the browser actually broke the lines (by grouping words on
 * their offsetTop) and wrap each real line in its own overflow clip. That is
 * what makes this survive a resize: the editorial breaks in the copy deck are
 * starting points, not hardcoded output. Spec 4.4.
 */
export default function MaskHeadline({
  lines,
  as: Tag = "h2",
  className = "",
  stagger = 80,
  id,
  style,
}: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const sources = Array.from(
      root.querySelectorAll<HTMLElement>("[data-src-line]")
    );
    const texts = sources.map((el) => el.dataset.srcLine ?? "");

    let raf = 0;
    let observer: IntersectionObserver | null = null;

    const split = () => {
      let lineIndex = 0;

      sources.forEach((el, i) => {
        // Rebuild from the original text every time so repeated resizes do not
        // compound previous splits.
        el.textContent = "";
        const words = texts[i].split(" ");
        const wordSpans = words.map((w, wi) => {
          const s = document.createElement("span");
          s.textContent = wi === words.length - 1 ? w : w + " ";
          s.style.display = "inline-block";
          s.style.whiteSpace = "pre";
          el.appendChild(s);
          return s;
        });

        // Group words into visual lines by their vertical offset.
        const groups: string[][] = [];
        let lastTop: number | null = null;
        wordSpans.forEach((s, wi) => {
          const top = s.offsetTop;
          if (lastTop === null || Math.abs(top - lastTop) > 2) {
            groups.push([]);
            lastTop = top;
          }
          groups[groups.length - 1].push(words[wi]);
        });

        el.textContent = "";
        groups.forEach((g) => {
          const mask = document.createElement("span");
          mask.className = "line-mask";
          const inner = document.createElement("span");
          inner.textContent = g.join(" ");
          mask.style.setProperty("--line-delay", `${lineIndex * stagger}ms`);
          mask.appendChild(inner);
          el.appendChild(mask);
          lineIndex++;
        });
      });

      // Reveal once the headline is on screen.
      if (observer) observer.disconnect();

      // Same reasoning as Reveal: a headline that starts inside the first
      // viewport must not wait for a scroll before it is allowed to exist.
      const box = root.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) {
        root
          .querySelectorAll<HTMLElement>(".line-mask")
          .forEach((m) => m.classList.add("is-in"));
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            root
              .querySelectorAll<HTMLElement>(".line-mask")
              .forEach((m) => m.classList.add("is-in"));
            observer?.disconnect();
          });
        },
        { threshold: 0, rootMargin: "0px 0px -20% 0px" }
      );
      observer.observe(root);
    };

    split();

    let t = 0;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        raf = requestAnimationFrame(split);
      }, 150);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [lines, stagger]);

  return (
    <Tag ref={ref as never} className={className} id={id} style={style}>
      {lines.map((line, i) => (
        <span key={i} data-src-line={line} style={{ display: "block" }}>
          {line}
        </span>
      ))}
    </Tag>
  );
}
