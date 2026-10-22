# Signalive

Marketing site for earbuds that follow the voice you are listening to and capture what
matters with a single jaw clench.

The page carries two channels and deliberately gives the gesture channel at least equal
weight: `npm run audit:balance` measures that and fails if it slips.

Single long scroll landing page plus waitlist capture. Next.js 15 App Router,
TypeScript, Tailwind CSS v4, GSAP ScrollTrigger, Lenis, Web Audio.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
```

The web trial (earbud assistant, recorder and notes, whisper and noise lab, Rewind and
Focus) is a separate Next.js app in `trial/`, deployed as its own Vercel project. See
`trial/README.md`.

`/features` presents what the trial does, gesture channel first, and says for each
feature what in the trial stands in for the hardware. Its "Try" links point to
`NEXT_PUBLIC_TRIAL_URL` (set it on this project once the trial is deployed). Without it,
a production build points people to the waitlist instead; in development it uses the
trial's local server, `http://localhost:3001`.

## Where things live

```
app/
  layout.tsx          fonts, metadata, the intro gate script
  page.tsx            section order
  globals.css         THE design tokens. Read this before styling anything.
  api/waitlist/       signup endpoint with a pluggable provider
components/
  chrome/             announcement bar, nav, sticky CTA, page loader
  focus-room/         the room at the top of the page: its WebGL scene, its
                      sound and the engine that steers both
  sections/           one file per section of the page
                      OneClench is the pinned four beat scene after the hero
                      ThePoint is the largest section and the product's argument
  ui/                 Reveal, MaskHeadline, CTAButton
lib/
  copy.ts             EVERY visible string on the site
  brand.ts            the brand name, in one place
lib/
  clench.ts           the measured clench frame, used by the pinned scene
scripts/
  audit-copy.mjs      em dash, forbidden claims, the 83% qualifier
  audit-design.mjs    contrast table and the amber inventory
  balance.mjs         the two channel weight check
docs/
  ASSETS.md           how every image, video and voice was generated
  PERFORMANCE.md      budget, the Framer Motion decision, a contrast correction
.assetgen/            prompts and the generation scripts (not shipped)
```

## Two rules that are not negotiable

**1. No em dash, no en dash, anywhere in visible copy.** Use a period, a comma, or
restructure the sentence.

**2. The product never reads anything internal.** It reads which sound you are attending
to, and a small movement you make on purpose. Wording that claims otherwise is permitted
in exactly one place, `notMind` in `lib/copy.ts`, where it is being refused.

Both are enforced:

```bash
npm run audit:copy
```

## Brand assets

The drawn wordmark and mark live in `public/media`, extracted from the artwork in
`public/logo.PNG` and `public/script-logo.PNG` with the paper knocked out to alpha:

| File | Use |
|---|---|
| `wordmark-light.png` | nav, footer, page loader, OG image. Every one of those sits on ink |
| `wordmark-dark.png` | for any light surface that needs it later |
| `mark-light.png` / `mark-dark.png` | the S mark |
| `app/icon.png` | favicon, the mark on ink so it holds up in either browser theme |

Do not typeset the brand name where the logo belongs. `nav.wordmark` and
`footer.wordmark` still exist, but only as the alt text for those images.

## Casting

One person appears in the pinned scene, and the video of them is the page's
signature moment. They appear **once**. Every other section uses a different
subject on purpose: repeating a face across four blocks reads as stock, and it
spends the moment the pinned scene is built around.

## The room at the top of the page

The hero is the Focus room from the web trial, rebuilt for this page: three people
talk around you, and the one you turn to comes forward. You are seen from behind, each
speaker's mouth moves with their voice, the sound flows from each mouth to you as bright
as you hear it, and a beam shows where your attention points. On wide screens the copy
sits on the left over the earbud macro loop and the room takes the right, its controls
above it; below 1024px they stack, with no video: the headline, the room straight under
it, then its controls. The pinned scene that follows mirrors that layout, its film
on the left (mirrored, so the person looks across at the story) rising out of ink.

- **Steering.** A mouse turns your head to wherever it is in the room, mapped through
  the speakers' own positions on screen, so pointing at someone faces them; leaving the
  room holds the last direction. A finger drags across the room. The arrow keys turn ten
  degrees at a time, 1, 2 and 3 face a speaker, and a speaker's name turns you to them.
  Until anyone steers, the head visits the three in turn.
- **The clench.** J or the clench button stands in for it. It plays back the last ten
  seconds of whoever you face (or are nearest to), in their own voice and from where
  they stand, while the room steps back, and shows their words lighting up as they are
  said again. The replay starts at the beginning of the sentence it falls in, when
  that is at most three seconds earlier. Every voice loops on the room's own clock, so
  this works with the room's sound off too.
- **Sound** is never fetched before someone taps for it or clenches, then the three
  voices and their word timings load (about 820KB and 4KB) and the audio code with
  them. The voices are AI generated and the page
  says so next to the control. They are made by `.assetgen/focus_voices.mjs`, see
  `docs/ASSETS.md`.
- **No three.js.** It would cost most of the page's JS budget, so the scene is under
  five hundred lines of plain WebGL in `components/focus-room/scene.ts`. The figures are
  computed, not loaded: a cloud of points on a signed distance field, built a few
  milliseconds a frame so the page never stalls while it fills in.

## Amber means one thing

Surfaces are `--ink` (#0B0B0C) and `--paper` (#FFFFF9). Paper is a broken white, not
pure white: it matches the ground the logos were drawn on and takes the glare off the
light sections. There is no #FFFFFF anywhere.

`--signal` (#FFC24B) marks the element currently being attended to. The active waveform,
the centred carousel card, the focused input, the live indicator, the focus ring, the
announcement bar. It is never a gradient, never a background wash, never decoration.

`node scripts/audit-design.mjs` prints every amber usage in the codebase so each one can
be justified.

## Editing copy

Do not edit copy inside components. Every string comes from `lib/copy.ts`. Changing the
brand name is one line in `lib/brand.ts`.

## Waitlist provider

`app/api/waitlist/route.ts` picks a provider from the environment:

| Variables set | Behaviour |
|---|---|
| `RESEND_API_KEY` | posts the signup to Resend |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | inserts into a `waitlist` table over REST |
| neither | appends to `.data/waitlist.jsonl` and warns |

The fallback exists so the form works out of the box in development. Set one of the
providers before going live.
