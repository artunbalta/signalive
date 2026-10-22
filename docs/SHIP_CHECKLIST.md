# Ship checklist

Spec part 7, with how each item was actually checked and what it returned.

Reproduce with:

```bash
npm run build && npx next start -p 3111 &
npm run audit                                   # copy + design
npm run audit:balance                           # the two channel balance
node scripts/verify.mjs http://localhost:3111 --engine=chromium
node scripts/verify.mjs http://localhost:3111 --engine=webkit
```

| Spec item | How it is checked | Result |
|---|---|---|
| Zero em dash and en dash in visible copy | `scripts/audit-copy.mjs` scans every `.ts/.tsx/.css/.mjs/.json` file, comments included | pass |
| No claim of reading anything internal, outside the denial | same script, matching the four forbidden stems and allow listing only the two lines of `lib/copy.ts` where the claim is refused | pass |
| The 83% figure cannot read as a product claim | same script asserts both the laboratory framing and the `qualifier` string survive | pass |
| Amber only on attended or active elements | `scripts/audit-design.mjs` prints every usage; 20 found, each justified below | pass |
| Every section works at 375px | `scripts/verify.mjs` at 375, 768 and 1440, checking `scrollWidth` against `clientWidth` | pass, no horizontal overflow at any width |
| Hero legible with video blocked and JavaScript disabled | the h1, subhead and CTA are server rendered; the poster is a real `<img>` behind the video, and no `<video>` is emitted at all under 600px | pass |
| Tab through the page, focus always visible, order logical | `verify.mjs` walks 40 tabs and reads `outlineStyle` and `outlineWidth` on each stop | pass, 22 stops in Chromium, all with a visible ring |
| Reduced motion: nothing broken, nothing moves | `verify.mjs` runs a context with `reducedMotion: "reduce"` and asserts no reveal is left hidden and no video autoplays | pass |
| Full page screenshot, judged as a stranger | `scripts/shots.mjs` writes per section captures to `.verify/` | reviewed, see the fixes below |

## The 34 amber usages, each justified

Amber means "this is what is being attended to". Nothing here is decorative.

| Where | What it marks |
|---|---|
| `globals.css` focus ring | the focused element is the attended one |
| `globals.css` `::selection` | selected text is attended |
| `AnnouncementBar` bar background | the bar is the thing demanding attention (spec 3.1 specifies it) |
| `AnnouncementBar` focus chip | an amber ring on an amber bar is invisible, so the focused control inverts to amber on ink instead |
| Focus room speaker name | the speaker who is forward (in the canvas, their rim and their sound in the air too) |
| Focus room level meter | how loud you hear the speaker who is forward |
| Focus room Replaying state | the speaker whose last ten seconds are being played back |
| Focus room clench dot (on the button and on the card) | a replay is playing; the beam holding on that speaker turns amber with it |
| `Carousel` card top hairline | the centred, attended card |
| `Footer` link underline | the hovered or focused link |
| `Gesture` pulse ring | the exact frame the device registered the command |
| `Hero` scroll cue | the live scroll affordance (spec 3.3 specifies amber) |
| `HowItWorks` diagram foreground stream (x4 rules) | the stream brought forward |
| `HowItWorks` step marker | the step currently in view |
| `Science` figure waveform | the attended talker |
| `Waitlist` field underline | the focused field |
| `OneClench` pulse ring | the frame the device registered the command |
| `OneClench` card top hairline | the confirmation that just arrived |
| `ThePoint` figure strokes (x8) | the active element in each gesture readout, including the hold bar handing amber to the reply as it returns |
| `ThePoint` destination card border | the hovered or focused card |
| `HowItWorks` filing figure | the item currently being captured and the slot receiving it |

## The balance check (rebalance patch, item 8)

`npm run audit:balance` measures this rather than asserting it. Scroll cost is
used rather than laid out height, because a pinned section consumes far more of
the visitor's scrolling than its own box suggests.

| Check | Result |
|---|---|
| Gesture channel at least equal to attention | pass, ratio 1.63 to 1 (6059px vs 3715px at 1440x900) |
| Clench seen within the first two viewports | pass, beat 3 active by scrollY 1643 of an 1800px budget |
| The word "clench" above the fold | pass: the room's "Clench to replay" at y=140 and the eyebrow at y=399 at 1440x900; the eyebrow at y=140 on stacked layouts |
| Headlines alone give two capabilities | pass, listening and acting both present |

Sections classified as "split" (how it works, use cases) are counted half to
each channel, since each now carries two listening beats and two acting ones.

## Defects found during review and fixed

1. **The hero CTA was invisible on load.** `Reveal` used a `-20%` bottom rootMargin so that elements entering on scroll wait until they are properly on screen. Applied to content that starts in the lower part of the first viewport, it waited for a scroll that may never happen, and the primary call to action sat at `opacity: 0`. Both `Reveal` and `MaskHeadline` now reveal anything already on screen at mount.
2. **Headline descenders were sheared off.** The display leading is 0.88 to 0.92, tighter than the em box, so `g`, `y` and `p` fell outside the line box that the mask clips. The clip region now extends below the baseline with a matching negative margin, so the rhythm is unchanged and the type is uncut.
3. **Every Tailwind margin utility on a `<p>` was being ignored.** The base reset `p { margin: 0 }` was unlayered, and unlayered CSS beats `@layer utilities`. It silently overrode every `mt-*` on a paragraph, which is why the waitlist subhead and the footer legal line collapsed against the text above them. The element resets now live in `@layer base`.
4. **`fog` fails AA on light sections.** The spec expected the problem on the dark surfaces; measured, it is the opposite. See `docs/PERFORMANCE.md`.
5. **The interaction caption rendered twice** in the hero, once from `Hero` and once from `AttentionDemo`. Kept the one inside the demo, which sits next to the control and is worded for the active interaction mode.
6. **The carousel opened with a dead third of empty space**, because centre snapping padded the first card into the middle of the viewport. Cards now begin on the page gutter, aligned with the headline, and the focal slot moved with them so card one is still the attended card at rest.
7. **The sticky rail headline broke to one word per line.** The shared display scale is built for a nine column measure; inside a five column rail it stacked. The rail widened to five columns and that headline alone steps down.

### Found during the rebalance

8. **The pinned scene put the clench out of reach.** The scene shipped with 3.75 viewport heights of pin travel, which placed the clench beat at scroll position 2.7 viewports, past the "first two viewports" requirement. The travel is now a budget derived from that requirement rather than a preference: 1.6 viewport heights, measured at 1660px of an 1800px allowance.
9. **The balance script passed for the wrong reason, twice.** Its first version reported "inside 1800px" for a value of 1875, because it never compared the two, and its "above the fold" check ran `window.scrollTo(0, 0)`, which Lenis ignores, so it measured the pinned section instead of the hero. Both are fixed: the assertion is real, and that check reloads the page to get back to the top.
10. **A bottom anchored cue is not above the fold.** The word "clench" was first surfaced on the hero's scroll cue. That passed at 1440x900 and failed at 1280x720, 375x667 and 390x844, because the hero grows taller than one viewport on short screens and takes the cue with it. It now sits above the headline, where it measures y=140 at every size tested.
11. **A dead poster path.** Step 03 referenced `/media/gesture.jpg`, which never existed; the real file is `gesture-poster.jpg`. Step 03 no longer uses a poster at all, but the reference was wrong the whole time and never surfaced as a console error.
12. **The beat copy shouted.** Set at the full `t-h1` scale in a 16ch measure, each narration line broke into six stacked lines and buried the footage. Scaled to a narration size so the shot carries the moment.

### Found during the design pass

13. **A stray `next dev` silently broke the production build, twice.** A dev server left running rewrites `.next` underneath `next start`, so the served HTML references chunks that no longer exist, every script 404s, and the page renders server side but never hydrates. It presents as "the feature is broken": the first time it looked like the waitlist form was doing a native submit, the second like the pinned scene had stopped pinning. Neither was true. If something interactive appears dead, check `ps aux | grep "next dev"` before debugging the component.
14. **One face, four places.** The subject of the pinned scene also appeared in step 01 and in the first carousel card, because both were derived from the same generated still. Two replacement photographs were generated so that face now appears exactly once, in the scene built around it.
15. **The carousel ended in a screen of nothing.** Padding the track far enough for the last card to physically reach the focal slot left roughly 980px of empty page after card four. The track now ends on the gutter and the end stop is handled in script instead: at maximum scroll the last card is the attended one.
16. **Two blocks were generic.** The destinations were four identical rounded boxes, and the calendar confirmation was a slab that faded in. Both are redrawn: the destinations as a ruled routing index whose leader draws amber from label to destination, the confirmation as a fragment of a calendar column that writes itself in, bar first.

17. **The hero demo was bound to the whole section.** The cursor sweep mapped to the hero's width, so the far left of the page sat at one voice fully forward with no control anywhere near the pointer. It now maps to the demo's own track, and leaving the demo holds rather than snapping.
18. **The scrubbed rotation had no copy at all.** A full viewport of rotating object and nothing else. It now carries the eartip heading, which is the only place on the page that explains why the sensor is in a silicone tip and not against the scalp. The frame plate is masked at its edges so it dissolves into the section instead of sitting on it as a lighter rectangle, and the canvas box matches the frames' 1000x562 aspect so that fade lands on the plate's own edge.

19. **THE POINT was three line readouts that explained nothing.** It is now a pinned, scrubbed panel: the three gestures take turns as you scroll, and one shared drawing plays what each one does. An ear with the earbud in it, a route, and a phone. Single sends something and it lands. Double fires twice and takes it back. Hold sustains, sends, and the answer comes back to the ear. "Where it goes" is deleted; its four labels survive only inside the filing figure in how it works.
20. **A drawn human profile read as a cartoon.** Two attempts at a full side profile came out as a blob with a beak, because at this size the nose, lip and chin need to be right or the whole thing collapses. An ear reduces honestly to two nested curves and is legible at any scale, so the drawing is an ear with the mandible running out of frame, and the person is implied rather than illustrated.
21. **The waveforms went flat on iOS the moment sound was enabled.** The analyser tapped off a MediaElementSource can report pure silence there even while the tracks are audible. The draw loop now watches the analyser's energy and falls back to the idle curve after half a second of nothing, so the demo degrades to its honest resting drawing instead of two dead lines. Audio also moved from preload none to metadata, which closes the gap where iOS has not decoded anything yet.
22. **Sound kept playing after its control scrolled away.** An IntersectionObserver on the demo now pauses both tracks, suspends the context and clears the enabled state when it leaves the viewport. Deliberately not resumed on the way back.
23. **Three pinned sections plus reduced motion threw in WebKit.** useReducedMotion cannot know the answer until after mount, so a pin effect can start with motion allowed and then have the reduced motion tree swap the trigger out while the dynamic GSAP import is still in flight. Pinning a detached node throws inside GSAP as it inserts its spacer. All three pinned effects now check the trigger is still connected after the import resolves.

24. **A pinned section sat on top of the copy above it.** THE POINT pinned roughly 1500px early, so its fixed panel overlaid the headline and paragraphs that had not scrolled away yet. Two causes, both about measuring the page before it had settled:

    - The scrubbed rotation created its ScrollTrigger only after all sixty frames had preloaded. That pin inserts a spacer almost two viewports tall, so the spacer appeared long after everything below it had been measured, and every later pin kept a start position that was now 1575px too high. Page geometry must not depend on asset loading: the trigger is now created on mount and the frames arrive whenever they arrive. `draw()` already skips a frame that has not loaded.
    - Nothing owned remeasurement. Webfonts, the hero video and the lazy carousel images all change the height of the page after first paint, and each pinned section was refreshing only around its own creation. `components/SmoothScroll.tsx` now owns a single debounced `ScrollTrigger.refresh()` driven by `window.load`, `document.fonts.ready` and a `ResizeObserver` on the body, so every trigger is remeasured together whenever the document changes height.

    Verified by measuring rather than by eye: the panel's document offset and the scroll position the pin fires at now agree to within the 30px that `anticipatePin` is deliberately buying.

## Known limitations

- **Framer Motion is not installed.** It would have taken the bundle over the 180KB budget. Reasoning in `docs/PERFORMANCE.md`.
- **The clench timestamp is a measurement, not a certainty.** `CLENCH_TIME = 2.83` is the peak of motion compensated movement in the masseter region across all 192 frames. The movement in the generated footage is subtle and partly continuous, so a human eye may prefer a slightly different frame. It is one constant in `components/sections/Gesture.tsx`.
- **Step 01 uses a still, not a video.** The generated step 01 clip showed the wrong product. Reshooting it would have cost more credits than remained. Detail in `docs/ASSETS.md`.
- **Safari tabs to form controls only** by default, so a Tab walk in WebKit reaches 4 stops rather than 22. That is the browser's "Full Keyboard Access" preference, not a page defect: every control here is a native `<a>` or `<button>`.
- **The waitlist has no provider configured.** It appends to `.data/waitlist.jsonl` and warns. Set `RESEND_API_KEY` plus `RESEND_AUDIENCE_ID`, or `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`, before launch.
