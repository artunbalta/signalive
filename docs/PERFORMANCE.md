# Performance and accessibility notes

## Budget (spec 6.2)

| Metric | Target | Where it is enforced |
|---|---|---|
| LCP | < 2.0s | the hero headline, or on wide screens the earbud loop behind it; the room is client side only and never render blocking |
| CLS | < 0.05 | every image and video carries explicit width/height or an aspect-ratio box; the room's slot is sized before the room loads |
| Total JS | < 180KB gz | 179.8KB measured, see below |
| Hero media | loop < 4MB, wide screens only | the earbud loop (291KB VP9, 843KB H.264) plays behind the copy from 1024px up and is never fetched below that; the room's figures are computed, and its voices (about 820KB) load only when someone turns sound on |
| Lighthouse perf | > 90 mobile | the room draws fewer points on small screens and stops drawing when off screen |

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

## Where the 180KB goes

Measured on the home page: every script it loads, gzip level 9, after a scroll.

```
Next 15 + React 19 runtime, shared chunks, layout   101.9KB
GSAP core, CSSPlugin and ScrollTrigger               44.4KB
Lenis                                                 5.3KB
page sections                                        10.1KB
shared site code and copy                             9.3KB
the Focus room                                        8.8KB
                                                    --------
                                                    179.8KB
```

That leaves a fifth of a kilobyte. Anything added to the page from here needs something
taken out first, or the budget moved on purpose.

The room fits because of three decisions. It is plain WebGL rather than three.js,
which alone would have cost about 150KB. Its sound code (about 1.2KB) is fetched only
when someone turns sound on. And the step 02 and 03 diagrams' CSS, which used to ship
inside the page's JavaScript as a string, now lives in `globals.css` with the other
sections' styles, which took 1.5KB off the page.

## Splitting

- The Focus room (its scene, its loop and its labels) is behind
  `next/dynamic(..., { ssr: false })` inside the Hero, so it never blocks first paint,
  and its sound is a further `import()` made when sound is turned on.
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
