# Performance and accessibility notes

## Budget (spec 6.2)

| Metric | Target | Where it is enforced |
|---|---|---|
| LCP | < 2.0s | hero poster is 43KB and is the LCP candidate; the video is not render blocking |
| CLS | < 0.05 | every image and video carries explicit width/height or an aspect-ratio box |
| Total JS | < 180KB gz | see the dependency decision below |
| Hero video | < 4MB, poster < 120KB | 823KB H.264 / 284KB VP9, poster 43KB |
| Lighthouse perf | > 90 mobile | video disabled entirely under 600px |

## The Framer Motion decision

The spec's stack lists Framer Motion for component level transitions. It is not
installed, and that is deliberate.

The JS budget is 180KB gzipped and described as non negotiable. The baseline is roughly:

```
Next 15 + React 19 app router runtime   ~90KB gz
GSAP core + ScrollTrigger               ~50KB gz
Lenis                                    ~3KB gz
                                        --------
                                        ~143KB gz
```

Framer Motion adds roughly 35KB gzipped, which lands the page at about 178KB before a
single line of application code. Since the spec also says not to mix Framer Motion with
GSAP on the same element, and every scroll behaviour here is GSAP or IntersectionObserver
work anyway, Framer Motion would have bought component transitions that CSS transitions
already handle at zero cost.

Component level transitions are done with CSS transitions driven by the tokens in
`globals.css`. If Framer Motion is wanted later, the budget needs to move first.

## Splitting

- The audio engine is behind `next/dynamic(..., { ssr: false })` inside the Hero, so it
  never blocks first paint.
- GSAP and ScrollTrigger are loaded with `await import()` inside effects, so they are not
  in the initial chunk.
- Lenis is loaded the same way and is skipped entirely under reduced motion.
- Sections themselves are NOT dynamically imported. The copy is the substance of this
  page and it should render without JavaScript.

## Fonts

PP Neue Montreal is not licensable here, so the spec's own fallback applies: Inter Tight
for display, Inter for body, JetBrains Mono for labels. No serifs anywhere.

`next/font/google` self hosts all three as WOFF2 with `font-display: swap`. Only the
display face is preloaded, per the spec. Weight 500 only for display, so no synthetic
bolding and a smaller download.

## Contrast, and a correction to the spec

The spec (6.3) says fog on ink "passes AA for large text only" and asks for a step up to
`#B4B4B9` for body copy on dark. The measured numbers say the opposite is the real risk:

```
fog #8A8A8F on ink   #0B0B0C   5.73:1   passes AA for normal text
fog #8A8A8F on paper #FFFFFF   3.44:1   FAILS AA for normal text
```

So the hazard is the light sections, not the dark ones. Rather than adding more palette
entries, the neutrals are rebound per surface in `globals.css`:

```css
.surface-paper {
  --color-fog:  #6E6E73;   /* 5.07:1 on paper */
  --color-mist: #3A3A3F;   /* 11.31:1 on paper */
}
```

`text-fog` and `text-mist` therefore resolve to whatever is legible on the surface they
are used on, with no per component decision. The palette stays six roles. `#B4B4B9` is
still used as `mist` on ink, as the spec asked.

Run `node scripts/audit-design.mjs` for the full table and the amber inventory.

## Audits

```bash
npm run audit:copy          # em dash, en dash, forbidden claims, the 83% qualifier
node scripts/audit-design.mjs   # contrast table + every amber usage for justification
```
