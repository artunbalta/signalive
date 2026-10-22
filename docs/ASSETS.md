# Asset generation

Every visual on this site was generated with the Higgsfield CLI and processed locally
with a static ffmpeg and Pillow, except the Focus room at the top of the page, whose
figures are computed in the browser and whose voices come from OpenAI's speech model
(see the last section). This file records exactly how, so any asset can be regenerated
or replaced.

## The consistency trick

The spec asks for one product identity across every shot. Pasting the product
description into each prompt is not enough: text alone produced a different device
each time. What works is generating one canonical still first, uploading it once, and
passing that upload id as an image reference (stills) or a start frame (video).

```
canonical still  -> nano_banana_pro, 16:9, 2k        2.0 credits
uploaded once    -> e334937d-860c-417d-a4a5-3f16bd6403e9
```

Everything downstream references it. `.assetgen/product_block.txt` holds the shared
product description and `.assetgen/negatives.txt` the exclusion list, which is appended
to every prompt because `nano_banana_pro` and `veo3_1_lite` have no negative prompt
parameter.

## What was generated

| Asset | Model | Reference | Credits |
|---|---|---|---|
| canonical product still | `nano_banana_pro` | none | 2.0 |
| hero macro loop | `veo3_1_lite` | canonical as `--start_image` | 8.0 |
| turntable base still | `nano_banana_pro` | canonical as `--image_references` | 2.0 |
| turntable rotation | `veo3_1_lite` | turntable still as `--start_image` | 8.0 |
| carousel stills 1 to 4 | `nano_banana_pro` | canonical as `--image_references` | 8.0 |
| carousel still 3, reshot | `nano_banana_pro` | canonical as `--image_references` | 2.0 |
| gesture video, reshot | `veo3_1_lite` | card 1 crop as `--start_image` | 8.0 |
| two hero voices | `text2speech_v2` | elevenlabs preset voices | 0.3 |

Two takes were discarded and are worth knowing about:

1. **The first gesture and step 01 videos** were generated text to video, with no image
   reference. Both came back showing a bulky over-ear hook headset rather than the
   stemless earbud, which contradicts the hero macro and trips the spec's own
   "bulky oversized device" exclusion. The fix was to drive the video from a start frame
   that already contained the correct product. Step 01 now uses a still crop from
   carousel card 1 instead of a video, to stay inside the credit budget.
2. **The first carousel card 3** contained a visible laptop maker's logo, which the
   negative prompt excluded and which is a trademark risk on a commercial page. Reshot
   with explicit "no logo on any object" wording.

## Gotchas found in the CLI

- Parameters use underscores, not hyphens: `--aspect_ratio`, not `--aspect-ratio`.
- `text2speech_v2` needs `--voice_type preset` for the voices listed by
  `higgsfield voices list`. `element` is for the voice-change workflow and returns
  "Voice not found" here.
- The basic plan allows **2 concurrent video jobs**. Launching three at once silently
  fails the third with `rate_limit_reached`, and the CLI still exits 0, so check the
  stderr file rather than the exit code.
- Passing a local path to `--start_image` can fail with an S3 `SignatureDoesNotMatch`.
  Upload first with `higgsfield upload create <path>` and pass the returned uuid.

## Local processing

`ffmpeg-static` provides the binary, so nothing needs to be installed system wide.

- **Hero loop.** The generated clip does not loop seamlessly, so it is built into a
  palindrome (forward then reversed) with
  `[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1`. The motion is a slow drift,
  which makes the turnaround invisible. Result: a genuinely seamless 16s loop at 823KB
  H.264 and 284KB VP9, against a 4MB budget.
- **Scrub sequence.** 60 frames resampled from the 192 frame turntable, reversed so the
  sequence ends with the contact rings facing camera, written as WebP quality 72.
  275KB for all 60 frames, because the background is near black and compresses hard.
- **Voices.** Both talkers are loudness normalised to the same target
  (`loudnorm=I=-18:TP=-2:LRA=11`) and trimmed to a common 14s. This matters: the hero
  demo has to prove that the product selects a stream, not that one stream is louder.
- **Posters.** Encoded in a quality loop that stops as soon as the file is under the
  120KB budget.

## The clench timestamp

`components/sections/Gesture.tsx` exports `CLENCH_TIME = 2.83`, the moment the amber
pulse fires. It was measured, not guessed:

1. All 192 frames extracted at 540x960.
2. The earbud used as a template to track head translation frame to frame, since the
   subject drifts up to 41px vertically through the clip and naive frame differencing
   just measures that drift.
3. Mean absolute difference computed over the masseter region, sampled at the tracked
   offset.

Frame 69 (t = 2.83s) is the strongest event at 2.84x the mean, both before and after
motion compensation. The movement in the footage is subtle and partly continuous rather
than a crisp discrete action, so if a human watching it prefers a slightly different
moment, change the one constant and nothing else.

## The rebalance patch, and the shot that was not taken

The rebalance asked for a new 12 second continuous take for the pinned scene,
flagged as the highest priority asset after the hero video. It was not
generated, and that was a deliberate call rather than an oversight.

At that point 6.55 credits remained. Every video model was priced:

```
veo3_1_lite  8      kling3_0_turbo 7.5   wan2_7      7.5
grok_video   7.5    kling2_6      10     minimax_hailuo 6   (6s max, 768px)
```

The only affordable model was `minimax_hailuo` at 6 credits, which caps at 6
seconds and would have consumed every remaining credit with nothing left for a
retry. The existing `gesture.mp4` is 8 seconds, already matches the brief in
every other respect (single continuous locked off take, meeting table, correct
product, subtle clench, natural office daylight, documentary realism), and has a
clench frame that has actually been measured. Spending the last of the budget to
obtain a shorter, unverified clip would have made the page worse.

So the pinned scene reuses `gesture.mp4`, and the two credits went to the one
piece of genuinely missing content instead: the new THE HANDOVER carousel still,
since that card's copy changed from a language learner at a laptop to a face to
face exchange with no phone and no pen in shot.

To shoot the take properly on a top up:

```bash
cd .assetgen
higgsfield upload create ./out/gesture_start.png     # returns a uuid
higgsfield generate create veo3_1_lite \
  --prompt "$(cat p_gesture2.txt)" \
  --start_image <uuid> --aspect_ratio 9:16 --wait --wait-timeout 25m
```

Then re-measure the clench with the tracking method described above and update
the single constant in `lib/clench.ts`. Nothing else needs to change: both the
pinned scene and its pulse key off that one number.

## Regenerating

Prompts live in `.assetgen/p_*.txt`. To reshoot one asset:

```bash
cd .assetgen
higgsfield generate create veo3_1_lite \
  --prompt "$(cat p_hero_video.txt)" \
  --start_image e334937d-860c-417d-a4a5-3f16bd6403e9 \
  --aspect_ratio 16:9 --wait --wait-timeout 25m
./build_media.sh    # re-encodes the hero variants into public/media
```

## The Focus room

The room at the top of the page has no image or video assets. Its figures are a cloud
of points on a signed distance field, computed in the browser
(`components/focus-room/head.ts`), the same bust as the web trial's.

Its sound is three files in `public/media/focus/`, made by `.assetgen/focus_voices.mjs`
with `gpt-4o-mini-tts`, and the time each of their words starts:

| File | Voice | What |
|---|---|---|
| `emma.mp3` | coral | a trip to Cappadocia, 37s |
| `daniel.mp3` | onyx | a startup idea, 34s |
| `barista.mp3` | verse | orders called across a counter, 31s |
| `words.json` | | every word of the three, with when it starts |

The monologues and speaking styles are the web trial's English ones, kept for these
scripts in `.assetgen/focus_monologues.mjs`. Every file is loudness normalised to the
same target (`loudnorm=I=-20:TP=-2:LRA=11`) so the voice that comes forward is louder
only because it was brought forward, and encoded as 64kbps mono MP3: about 820KB for the
three, which load only when someone turns sound on or clenches.

The word times are what lets a clench show exactly what was said in the ten seconds it
plays back. `.assetgen/focus_words.mjs` has whisper-1 time the words it hears, then lays
those times onto the script's own words (its spelling and punctuation), matched in
order; the few words the recogniser wrote differently are timed between their
neighbours. Run it again whenever the voices change:

```bash
OPENAI_API_KEY=... node .assetgen/focus_voices.mjs
OPENAI_API_KEY=... node .assetgen/focus_words.mjs
```

The voices are AI generated, and the page says so next to the sound control.

The hero macro loop is still on the page, behind the copy on wide screens: the top left
corner, masked so it fades out toward the room and down toward the headline. Its poster
and the two hero voices above are no longer used; the files stay in `public/media`.
