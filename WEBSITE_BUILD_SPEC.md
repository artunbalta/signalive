# WEBSITE BUILD SPEC — [BRAND] Attention Earbuds

**Document type:** Complete build brief for an AI coding agent
**Deliverable:** Marketing site, single long-scroll landing page plus waitlist capture
**Reference site:** whoop.com (structure, density, restraint, video-first hero)
**Tone target:** slick, quiet, expensive, scientifically credible. Not sci-fi. Not startup-cute.

---

## HOW TO USE THIS DOCUMENT

Read all of it before writing code. Build in this order: tokens, then layout skeleton with placeholder blocks, then real copy, then assets, then motion. Do not start with motion.

Two hard rules on copy:

1. **Never use em dashes or en dashes anywhere in visible copy.** Use a period, a comma, or restructure the sentence. This applies to headlines, body, captions, alt text, and metadata.
2. **Never describe the product as reading thoughts, reading minds, telepathy, or anything adjacent.** It is factually wrong and it is the single fastest way to lose credibility with the audience this site is for.

---

# PART 1 — THE PRODUCT

You need to understand this properly before you can write a single line of copy.

## 1.1 What it is

Earbuds with biopotential sensors in the eartip. They detect which sound source the wearer is attending to, and they accept discreet muscular gestures as commands to an AI assistant.

Two channels operating on two timescales:

| Channel | Timescale | Volitional | What it answers |
|---|---|---|---|
| Attention | seconds | no, it is passive | which one. Which speaker, which stream, when the user disengaged |
| Gesture | milliseconds | yes, deliberate | what to do. Confirm, cancel, mark |

## 1.2 The problem it solves

When two people talk at once, your brain solves the problem. It locks onto the voice you care about and pushes the other one back. This is the cocktail party effect and it is one of the oldest known results in hearing research.

Your earbuds cannot do this. The most expensive earbuds on the market still guess. They boost the loudest source, or the nearest one, or whatever is in front of you. That is why they fail in a restaurant, in an open office, at a conference.

The missing input is not better microphones. Audio separation is largely solved. The missing input is knowing which separated stream the listener actually wants.

## 1.3 How the attention channel works

When you attend to a voice, the electrical activity in your auditory cortex tracks the rhythm of that voice more strongly than the ones you are ignoring. This is measurable. The research field is called auditory attention decoding and it has roughly fifteen years of published work behind it.

What has not existed is a way to measure it in something people already wear all day. The ear is the only place on the body that is worn continuously, socially invisible, and millimeters from the auditory cortex.

## 1.4 How the gesture channel works

When you clench your jaw, the muscles near your ear produce a signal that is orders of magnitude stronger than any brain signal. What is noise for the sensors is a clean, deliberate command channel.

Three gestures, no more:

| Gesture | Action |
|---|---|
| Single clench | Confirm or mark |
| Double clench | Undo or cancel |
| Long hold | Switch mode |

Depth comes from context, not from vocabulary. The same double clench means skip while you are listening to music and mark this while you are listening to a person. The attention channel supplies that context.

## 1.5 What it is not

State this plainly on the site. It builds trust rather than costing it.

It does not read thoughts. It cannot. It reads two things: which sound you are attending to, and a small movement you make on purpose. Nothing you think enters the device.

It is not a hearing aid and it makes no medical claims.

## 1.6 The long thesis

The way we command computers has changed three times. Keyboard, mouse, touchscreen. The fourth will be attention. This company starts at the ear because the ear is the only practical place attention can be measured.

## 1.7 Audience for this site

Two readers at once, and the design must serve both without splitting.

- **Early adopters.** People who spend their day in meetings, in noise, in second languages. They want to know what it does for them tomorrow.
- **Investors and technical readers.** They want to know it is real. They will look for the science, and they will look for what you refuse to claim.

The Whoop site does exactly this: consumer surface, clinical substructure, fine print at the bottom that signals seriousness rather than hiding.

---

# PART 2 — DESIGN SYSTEM

## 2.1 The core idea driving every visual decision

The site is about attention. So the site itself must behave like attention: one thing forward, everything else receded. This is not a metaphor to put in the copy, it is a rule for the layout.

Practical consequence: **only one element on screen is ever fully present at a time.** Everything else sits at reduced contrast. As the user scrolls, focus transfers. Amber marks what is attended. Grey marks what is not.

## 2.2 Palette

Six values. Do not add a seventh.

```css
--ink:      #0B0B0C;  /* near black, primary dark surface */
--paper:    #FFFFFF;  /* primary light surface */
--fog:      #8A8A8F;  /* unattended text, fine print, disabled */
--slate:    #2A2D33;  /* dark surface elevation, card backgrounds on ink */
--signal:   #FFC24B;  /* amber. ONLY ever means "this is what you are attending to" */
--hairline: rgba(255,255,255,0.12); /* dividers on dark; use 0.10 black on light */
```

**Rule for `--signal`:** it is semantic, not decorative. Amber appears only on the currently attended element: the active waveform, the active carousel card, the focused input, the live gesture indicator. It never appears as a gradient, never as a background wash, never on a button that is not the primary action. If you find yourself using amber to make something look nice, remove it.

Sections alternate ink and paper full bleed, edge to edge, like Whoop. No section is a floating card on a background.

## 2.3 Typography

Three roles, deliberately different jobs.

```css
--font-display: 'PP Neue Montreal', 'Inter Tight', system-ui, sans-serif;
--font-body:    'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', ui-monospace, monospace;
```

If PP Neue Montreal is not licensable, use Inter Tight and do not substitute a serif. There are no serifs on this site.

**Display face.** Very tight leading, 0.88 to 0.92. This is the single most recognizable thing about the Whoop headline treatment and it is worth replicating. Weight 500, never 700. Letter spacing tightens as size increases, down to -0.03em at the largest.

**Mono face.** Used for anything that is a measurement, a label, a step index, or a technical term. This is true to the subject: the product is a signal processing device. Mono appears at 11px to 13px, uppercase, letter spacing 0.08em, in fog. Never for body copy.

**Type scale** (clamp for fluid sizing):

```css
--t-hero:  clamp(3.25rem, 9vw, 8rem);      /* hero headline only */
--t-h1:    clamp(2.5rem, 6vw, 5rem);       /* section headlines */
--t-h2:    clamp(1.75rem, 3.5vw, 2.75rem);
--t-lead:  clamp(1.125rem, 1.6vw, 1.5rem); /* subheads under headlines */
--t-body:  1.0625rem;                       /* 17px */
--t-small: 0.875rem;
--t-mono:  0.75rem;
```

## 2.4 Layout

- Content max width 1280px, gutters 24px mobile, 48px tablet, 80px desktop
- Twelve column grid, 24px gap
- Vertical section rhythm: 120px mobile, 200px desktop between sections
- Border radius: 0 on sections, 12px on cards, 999px on buttons and pills. Whoop uses pill buttons; do the same.
- No drop shadows anywhere except the sticky CTA. Depth comes from surface color, not from shadow.

## 2.5 The signature element

**This is the one thing the site will be remembered by. Build it first after the skeleton, and spend your effort here.**

The hero contains a live demonstration of the product's core function, driven by cursor position.

Two voices are playing simultaneously in the hero, panned left and right. As the cursor moves left, the left voice comes forward and the right one ducks and blurs. As it moves right, the reverse. A thin amber waveform sits under whichever voice is currently forward. The unattended waveform is fog grey and lower amplitude.

The visitor experiences the product before reading a word about it. The cursor is standing in for their attention.

**Implementation notes:**
- Web Audio API, two audio sources through GainNode plus a BiquadFilter (lowpass, sweeping 20000Hz down to 900Hz as a stream recedes)
- Audio is muted on load. A small mono label in the corner reads `MOVE TO LISTEN` with a small unmute control. Never autoplay audio.
- Waveform rendered on canvas from an AnalyserNode, not a fake animation. It must be the real signal.
- On touch devices, replace cursor tracking with a horizontal drag handle, same behavior
- On `prefers-reduced-motion`, present a static two-waveform diagram with a toggle instead

---

# PART 3 — PAGE STRUCTURE

Section by section. Copy is written and final. Use it as given. Check every line for em dashes before shipping.

## 3.1 Announcement bar

Full width, 44px, `--signal` background, ink text, mono 12px uppercase, centered. Dismissible with an X on the right, dismissal stored in sessionStorage.

```
Now taking waitlist applications for the first 500 units.   [Join the list]
```

## 3.2 Navigation

Fixed, ink background, 72px tall, blur backdrop at 12px once scrolled past hero.

- Left: nothing
- Center: wordmark, white, 20px
- Right: hamburger, three 1px lines, 20px wide

Full screen overlay menu on open, ink background, links in display face at `--t-h2`, staggered entrance 40ms apart.

Menu links: Product, Science, About, Waitlist

## 3.3 HERO

Full viewport height, minimum 100svh. Ink background.

**Layer 1, background:** looping video, extreme macro of the earbud surface. Silent, autoplay, muted, playsInline, loop. Poster frame required for the pre-load state. See §5.1 for generation.

**Layer 2:** a 0 to 65% vertical gradient scrim from ink at the bottom so text stays legible.

**Layer 3, the signature interaction** from §2.5, positioned in the lower third.

**Layer 4, copy.** Bottom left aligned, not centered.

```
Headline:
Earbuds that know
who you are listening to

Subhead:
Your brain already picks one voice out of a crowded room.
Your earbuds still guess. Ours do not.

Primary CTA (pill, paper background, ink text):
Join the waitlist

Mono caption under the interaction, in fog:
MOVE YOUR CURSOR TO SHIFT YOUR ATTENTION
```

Scroll cue: a 1px vertical amber line, 48px, at the bottom center, animating its scaleY origin top to bottom on a 2s loop.

## 3.4 THE PROBLEM

Ink background, full bleed, no image. Type only. This section is deliberately quiet after the loud hero.

```
Mono eyebrow:
THE COCKTAIL PARTY PROBLEM

Headline:
Two people talk at once.
Your brain solves it. Your earbuds do not.

Body, max width 60ch, in fog with the first sentence in paper:
When two voices compete, you lock onto the one you care about and
push the other back. This has been understood for seventy years.

Modern earbuds cannot do it. They boost whatever is loudest, or
nearest, or in front of you. In a restaurant, in an open office, on
a conference floor, that guess is wrong most of the time.

Separating the voices was never the hard part. Knowing which one you
wanted is.
```

**Motion:** as this section enters, the two hero waveforms carry over as a small persistent element in the corner, then fade. Scroll-triggered opacity on each paragraph, staggered.

## 3.5 HOW IT WORKS

Paper background. Three steps. Use numbered mono indices here because this genuinely is a sequence and the order carries meaning.

Sticky left column with the headline, scrolling right column with the three steps. On mobile, stack.

```
Mono eyebrow:
HOW IT WORKS

Headline:
Three things happen
in under two seconds

01  YOU LISTEN
    When you attend to a voice, your auditory cortex tracks its
    rhythm more strongly than the voices you are ignoring. The
    sensors in the eartip pick up that difference.

02  IT FOLLOWS
    The earbud identifies which stream you are on and brings it
    forward. The rest recede. You did not press anything and you
    did not turn your head.

03  YOU MARK IT
    Hear something worth keeping. Clench your jaw once. Nobody
    notices. The assistant captures what was just said and does
    something with it.
```

Each step gets a small looping video or animated diagram on the right. Amber marks the active step as it enters the viewport, fog for the others.

## 3.6 THE GESTURE

Ink background. Split layout, video left, copy right.

```
Mono eyebrow:
THE COMMAND CHANNEL

Headline:
Talk to it without talking

Body:
Speaking to an assistant in public does not work. That is why the
best voice assistants in the world sit unused in your pocket while
you type instead.

A single jaw clench is invisible and unambiguous. Three gestures
cover everything, because context does the rest. The same gesture
means skip while you are listening to music and mark this while you
are listening to a person.

Three-item list, mono labels, body descriptions:
SINGLE     Confirm or mark
DOUBLE     Undo or cancel
HOLD       Switch mode
```

**Motion:** the video shows a person in a meeting, subtle jaw movement, and an amber pulse ring appearing at the ear on the exact frame of the clench. Time this precisely. It is the section's whole point.

## 3.7 USE CASE CARROUSEL

Paper background. Horizontal scroll carousel, exactly like the Whoop pattern: rounded 12px cards, image with headline overlaid top left, circular white arrow controls, a small plus button bottom right on each card that expands detail.

Four cards:

```
1. THE MEETING
   Follow one person across a loud table
   Six people, one table, one voice you actually need. It stays
   forward while the room stays background.

2. THE RESTAURANT
   Hear the person across from you
   The hardest listening environment there is, and the one every
   pair of earbuds fails in.

3. THE SECOND LANGUAGE
   Give your ear a fighting chance
   Understanding a language you are still learning is a listening
   problem before it is a vocabulary problem.

4. THE RACE
   Take a call at kilometre thirty
   Sweat, wind, breathing hard. It stays in and it stays working.
```

Carousel behavior: snap scrolling, drag to scroll, arrow keys, momentum. The centered card is at full opacity with an amber hairline top border. The others sit at 55% opacity. This is the palette rule doing structural work.

## 3.8 WHAT IT IS NOT

Ink background. Narrow, centered, max width 52ch. No image. This section is a statement of restraint and should look like one.

```
Mono eyebrow:
PLAINLY

Headline:
It does not read your mind

Body:
It cannot, and neither can anything else you can wear without
surgery. Two things go into this device. Which sound you are
attending to, and a small movement you make on purpose. Nothing you
think is measured, transmitted, or stored.

It is also not a hearing aid, and we make no medical claims about
it.

We would rather tell you this on the first page than have you find
out later.
```

This section will do more for credibility than any feature block on the page. Do not cut it, do not shrink it, do not bury it.

## 3.9 THE SCIENCE

Paper background. Two column: left is copy, right is a technical figure.

```
Mono eyebrow:
THE SCIENCE

Headline:
Fifteen years of published work,
finally small enough to wear

Body:
Auditory attention decoding is an established research field. The
open questions were never whether the signal exists. They were
signal quality in a device this small, decision speed, and how much
calibration each person needs.

That is what we work on.

Three stat blocks, mono labels, display numbers, no accent color
except on hover:
~83%        Attention decoding accuracy reported in
            laboratory conditions using full scalp sensors

<2 sec      The decision window a wearable product has
            to work within

4           Sensors per ear our design targets
```

Be careful here. The 83% figure is the published laboratory reference, not our product's performance. The copy above says that explicitly. Do not let a designer or a later editor shorten it into an implied product claim.

## 3.10 WAITLIST

Ink background, full viewport height, centered, generous.

```
Headline:
The first five hundred

Body:
We are building a small first run for people who spend their day in
noise. Tell us where you spend yours.

Form:
[ Email address ]
[ Where do you struggle to hear?  v ]  Meetings / Restaurants /
Open office / Learning a language / Training and racing / Other
[ Join the waitlist ]

Under the form, mono, fog:
NO SPAM. ONE EMAIL WHEN UNITS ARE READY.
```

Form behavior: the focused input gets an amber 1px bottom border, everything else fog. Inline validation, no modal. On submit, the form does not disappear. It replaces in place with a confirmation that keeps the same box dimensions so nothing jumps.

## 3.11 FOOTER

Ink background, top hairline divider.

Three columns: wordmark and one line of positioning, link columns, then a fine print block in fog at 12px.

```
Fine print:
[BRAND] is a general wellness product. It is not a medical device.
It is not intended to diagnose, treat, cure, or prevent any disease,
and it is not a substitute for a hearing aid or for professional
medical advice.

Attention decoding performance varies between individuals and
environments.

(c) 2026 [BRAND]. London.
```

Fine print of this kind reads as seriousness rather than as legal hedging, provided it is accurate. Keep it.

## 3.12 STICKY CTA

Appears after the hero leaves the viewport. Centered, bottom, 24px from edge. Pill, paper background, ink text, subtle shadow. Reads `Join the waitlist`. Hides when the waitlist section is in view.

---

# PART 4 — MOTION

## 4.1 The rule

Motion in this site means one thing: attention transferring from one element to another. If an animation is not doing that, cut it.

## 4.2 Smooth scroll

Use **Lenis**. This is the single biggest contributor to the feel being asked for.

```js
lerp: 0.09,
duration: 1.2,
smoothWheel: true,
syncTouch: false   // native momentum is better on iOS
```

Sync Lenis to the GSAP ticker so ScrollTrigger stays accurate.

## 4.3 Easing and duration

```css
--ease-out:   cubic-bezier(0.16, 1, 0.30, 1);   /* entrances */
--ease-inout: cubic-bezier(0.76, 0, 0.24, 1);   /* transforms */
--d-fast:   240ms;
--d-base:   600ms;
--d-slow:   900ms;
```

Nothing exceeds 900ms except the hero video and the scroll-scrubbed sequence.

## 4.4 Scroll reveals

Text: translateY 24px to 0, opacity 0 to 1, `--d-base`, `--ease-out`. Stagger children 60ms. Trigger at 80% viewport. Run once, never on scroll back.

Headlines: mask reveal by line. Clip each line in an overflow hidden wrapper, translateY 100% to 0, stagger 80ms. Split lines with a library, do not hardcode line breaks, or it will break on resize.

## 4.5 The scroll-scrubbed sequence

One place only, between §3.5 and §3.6. Pin the section, scrub a short video or an image sequence tied to scroll position: the earbud rotating from the outer shell to the eartip, revealing the two contact rings.

Use an image sequence rather than a video for reliable scrubbing. 60 frames, WebP, preloaded with a progress state. Video scrubbing is unreliable across browsers and will feel broken on Safari.

## 4.6 Micro-interactions

- Buttons: scale to 0.98 on press, background lightens 6% on hover, `--d-fast`
- Primary CTA: magnetic cursor attraction within 60px radius, maximum 8px translation, spring damping 20
- Links: amber underline growing from left, 200ms
- Cards: 4px lift, no shadow change, hairline goes from fog to amber

## 4.7 Page load

One orchestrated sequence, not scattered effects.

1. Ink screen, wordmark centered, 300ms
2. Wordmark travels to nav position, 700ms, `--ease-inout`
3. Hero video fades up from black, 900ms
4. Headline lines mask in, staggered 80ms
5. Signature interaction fades in last, 400ms delay after headline

Total under 2.5 seconds. Skip the entire sequence for repeat visitors within a session and for `prefers-reduced-motion`.

## 4.8 Reduced motion

Under `prefers-reduced-motion: reduce`: disable Lenis, disable all scroll reveals to instant visibility, replace the scrubbed sequence with a static image, keep the hero video but do not autoplay it, replace the signature interaction with the static diagram described in §2.5.

---

# PART 5 — ASSET GENERATION

Generate these with Higgsfield. **Check the CLI's own help output for exact flag syntax before running anything.** The prompts below are content, not command lines. Confirm the tool's argument format and output options first, then adapt.

Every asset shares one product description block. Paste it verbatim into each prompt so the product stays identical across shots.

```
PRODUCT BLOCK:
a pair of premium stemless wireless earbuds, compact bean-shaped body
in matte graphite with a thin brushed-titanium accent ring, soft
charcoal silicone ear tip with two subtle concentric pale-gold
conductive contact rings integrated flush into the tip surface. No
visible wires, no LEDs, no glowing elements. Understated
medical-grade industrial design, Braun and Teenage Engineering
restraint.
```

## 5.1 Hero video (highest priority)

```
[PRODUCT BLOCK]
Extreme macro cinematic shot of the earbud surface, slow lateral
camera drift across the matte graphite shell and the titanium ring,
very shallow depth of field so only a narrow band is in focus at any
moment. Deep near-black background, single soft key light raking
across the surface from the upper left, one controlled specular
highlight travelling along the titanium ring as the camera moves. No
hands, no people, no environment. Slow, calm, expensive. 8 second
seamless loop, no cuts, 4K, 24fps.
```

Then: export a poster frame from frame 1. Encode to both H.264 MP4 and WebM. Target under 4MB. Serve a 720p variant under 900px viewport width and disable the video entirely under 600px, falling back to the poster image.

## 5.2 Scroll-scrubbed sequence

```
[PRODUCT BLOCK]
Studio turntable rotation of a single earbud on a seamless deep
charcoal surface, rotating slowly to reveal the eartip and the two
concentric contact rings, ending with the rings facing camera. Soft
large-source lighting, single specular highlight on the titanium
ring, soft contact shadow. Locked-off camera, object rotates. No
props, no text. 60 frames, consistent lighting across all frames.
```

Export as a numbered frame sequence, convert to WebP, preload.

## 5.3 Section videos

**How it works, step 01:**
```
[PRODUCT BLOCK]
Close-up three-quarter profile of a person in their early thirties
wearing the earbud, listening intently to someone off camera. Calm
focused expression, natural eye movement, subtle head stillness.
Soft directional daylight from a window. Neutral warm background
heavily blurred. Subject sharp. Documentary realism, not corporate
stock. 6 second loop, minimal movement.
```

**Step 03 and the gesture section:**
```
[PRODUCT BLOCK]
Medium close-up of a person at a meeting table wearing the earbud,
listening to a colleague, then making a very subtle single jaw
clench, barely perceptible, while maintaining eye contact and a
neutral expression. Natural office daylight, muted palette. The
movement must be small enough that it would go unnoticed in a real
room. 5 seconds, single continuous take.
```

The amber pulse ring at the ear is added in code as an overlay synced to the clench frame. Do not ask the generator to produce it.

## 5.4 Carousel stills

```
[PRODUCT BLOCK]
1. Six people around a modern meeting table, one person wearing the
   earbud in sharp focus listening across the table, everyone else
   softly out of focus, warm office daylight, candid documentary
   style, 35mm, f/2.

2. Two people at a small table in a busy warm-lit restaurant, one
   wearing the earbud, leaning slightly in, genuine conversation,
   surrounding diners blurred, evening light, 50mm, f/1.8.

3. A person in their twenties in a bright café with headphones off
   and the earbud in, concentrating on a laptop, notebook open,
   morning light, 35mm, f/2.

4. An endurance athlete mid-run on a coastal road during a race,
   wearing the earbud, race number on tri suit, sweat visible,
   determined expression, background motion blur, harsh bright
   midday sun, 70-200mm telephoto, f/4.
```

Consistent grading across all four. Export at 1600x2000, WebP, plus 800x1000 for mobile.

## 5.5 Negative prompt for every asset

```
--no glowing lights, neon, blue LED glow, holograms, brain imagery,
circuit patterns, visible electrodes, wires, sci-fi HUD overlays,
cyberpunk, futuristic chrome, bulky oversized device, text, labels,
logos, watermark, lens flare, heavy vignette
```

The first six items are not stylistic preferences. Any one of them makes the product read as science fiction, which is the fastest way to lose a technical audience.

---

# PART 6 — TECHNICAL

## 6.1 Stack

- Next.js 15, App Router, TypeScript
- Tailwind CSS with the tokens above defined in `@theme`
- GSAP with ScrollTrigger for scroll work
- Lenis for smooth scroll
- Framer Motion for component-level transitions only, do not mix it with GSAP on the same element
- Web Audio API for the hero, no library
- Vercel deploy, waitlist to Supabase or Resend

## 6.2 Performance budget

Non-negotiable. A heavy site undercuts the message.

| Metric | Target |
|---|---|
| LCP | < 2.0s |
| CLS | < 0.05 |
| Total JS | < 180KB gzipped |
| Hero video | < 4MB, poster < 120KB |
| Lighthouse performance | > 90 mobile |

Fonts: self-hosted WOFF2, `font-display: swap`, preload the display face only. Images: `next/image`, AVIF then WebP. Everything below the fold lazy loaded. Route-level code splitting for the audio engine so it never blocks first paint.

## 6.3 Accessibility floor

Build to this without announcing it.

- Visible focus ring, 2px amber, 2px offset, on every interactive element
- Full keyboard operation including the carousel
- Semantic landmarks, one h1
- Alt text on every image, written as description not as keyword stuffing
- Contrast: fog on ink passes AA for large text only, so never use fog for body copy under 18px on ink. Step up to `#B4B4B9` where needed.
- The hero audio is opt-in and clearly labelled
- Respect `prefers-reduced-motion` as specified in §4.8

## 6.4 Metadata

```
Title:       [BRAND]. Earbuds that know who you are listening to.
Description: Earbuds that detect which voice you are attending to and
             bring it forward. Command an assistant with a gesture
             nobody notices.
OG image:    1200x630, hero macro still, wordmark bottom left
```

No em dashes in metadata either.

---

# PART 7 — BEFORE YOU SHIP

- [ ] Search the entire codebase for the em dash character and the en dash character. Zero results in visible copy.
- [ ] Search for "mind", "thought", "telepath", "brainwave" in copy. Zero results outside §3.8, where they appear only in denial.
- [ ] The 83% figure is labelled as a laboratory reference and cannot be read as a product claim.
- [ ] Amber appears only on attended or active elements. Count every instance and justify each one.
- [ ] Every section works at 375px width.
- [ ] Hero loads and is legible with video blocked and JavaScript disabled.
- [ ] Tab through the entire page. Focus is always visible and the order is logical.
- [ ] Toggle reduced motion in OS settings and reload. Nothing is broken and nothing moves.
- [ ] Take a full page screenshot and look at it as a stranger would. If any element is decorative rather than doing work, remove it.
