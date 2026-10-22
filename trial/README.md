# Signalive web trial

A web app that lets anyone put on their own earbuds, open a URL, and try the whole
Signalive loop in a few minutes, with no install and no account: talk or whisper to an
assistant through the earbuds, record a stretch of the day into searchable notes, and
measure how well whispered and noisy speech is recognized on their own device.

It is a research and validation product. Two goals drive every choice: a first spoken
reply within three minutes of landing, and honest per device measurements (latency, word
error rate, noise robustness) that tell us whether the product idea holds.

The app lives in `trial/` as its own Next.js application, next to the marketing site at
the repository root. It deploys separately (its own Vercel project, root directory
`trial`).

| Module | Where | What it does |
|---|---|---|
| Consent | `/consent` | Plain language: what is recorded, sent where, kept how long, deleted how. Nothing pre ticked. |
| Setup wizard | `/setup` | Device choice, 5 s mic check (rates, levels, bandwidth, Bluetooth hands-free warnings), built-in mic comparison, 10 s wind test, first spoken reply |
| Assistant | `/assistant` | Push to talk (button, space bar, earbud tap) and hands-free (Silero VAD), streaming STT, Claude, sentence by sentence TTS, barge-in, whisper mode, Turkish and English |
| Focus | `/focus` | Three people talk at once around you, placed in space (HRTF). The voice your head faces comes forward through the attention extension point; head direction from the camera (MediaPipe face pose, on the device), the phone's orientation, or keys. A jaw clench locks the voice; "What did they say?" recaps anyone's last 15 s |
| Rewind | `/rewind` | Keeps the last 30 s of the microphone in memory; a jaw clench (the button or J, standing in for the earbud's sensor) replays 10, 15 or 30 s in the earbuds, then the assistant says what was said. A three.js figure shows the clench and the rewind |
| Recorder | `/recorder` | Continuous capture cut by VAD, transcripts, notes every few utterances, "mark this moment", opt-in raw audio with automatic expiry |
| Notes | `/notes` | Word (prefix, Turkish aware), meaning (embeddings) and hybrid search |
| Lab | `/lab`, `/lab/results` | Fixed phrases, four processing chains from one take, two or three recognizers, WER and CER with bootstrap intervals, CSV |
| Timing | `/debug` | Last 20 exchanges, stage by stage, p50 and p95 |
| Settings | `/settings` | Languages, devices, gesture bindings, export (JSON, Markdown), delete everything, email upgrade |

## Run it locally

```bash
cd trial
npm install
npm run dev            # http://localhost:3000
```

With no environment variables the app runs on **mock providers** and an **in-memory
store**: the full flow works (the microphone, the VAD, the lab chains and the scoring are
real), but transcripts, replies, speech and notes are simulated, and the status line shows
a "Mock providers" badge. Nothing leaves your machine. Data lives as long as the dev
server process: after a restart the agreement, notes and recordings are gone, and open
pages send you back to the consent screen with a note saying so. Production refuses both
unless explicitly allowed (see below).

Copy `.env.example` to `.env.local` and fill in what you have; each provider switches from
mock to real as soon as its key is present.

## Configuration

Every key is read on the server only. The browser receives the provider names, model
names and the Supabase URL and publishable key (public by design), never a key.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | none | Supabase project URL. With the key below it switches the store to Supabase. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | none | Publishable (or legacy anon) key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works. |
| `SUPABASE_SECRET_KEY` | none | Secret (or legacy service role) key, server only. Needed for the audio expiry cron, the research export, and deleting the auth user. `SUPABASE_SERVICE_ROLE_KEY` also works. |
| `ANTHROPIC_API_KEY` | none | Claude for replies and notes. |
| `LLM_MODEL` | `claude-sonnet-5-5` | Model for voice replies. |
| `LLM_THINKING` | `between_tools` on claude-sonnet-5-5, else `adaptive` | Lowest thinking setting for latency. `disabled` only where a model accepts it. |
| `LLM_EFFORT` | `low` | `low`, `medium` or `high`. |
| `LLM_NOTES_MODEL` | `LLM_MODEL` | Model for notes extraction. |
| `LLM_FALLBACKS` | `default` | Server side refusal fallback; `off` to disable. |
| `STT_PROVIDER` | first with a key: deepgram, openai, groq | Recognizer for the assistant and the recorder. |
| `STT_STREAMING` | `on` | Live streaming from the browser (Deepgram only, fixed language only). |
| `LAB_STT_PROVIDERS` | every configured one | Two or three recognizers for the lab, comma separated. |
| `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL` | none, `nova-3` | The key needs the Member role or higher to issue browser tokens. |
| `OPENAI_API_KEY`, `OPENAI_STT_MODEL` | none, `gpt-transcribe` | Also used for TTS and embeddings when selected. |
| `GROQ_API_KEY`, `GROQ_STT_MODEL` | none, `whisper-large-v3-turbo` | Whisper, the open model baseline in the lab. |
| `TTS_PROVIDER` | ElevenLabs if configured, else OpenAI | |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL` | none, `eleven_flash_v2_5` | |
| `ELEVENLABS_VOICE_ID` (or `_EN`, `_TR`) | none | Required for ElevenLabs: its premade voices expire on 2026-12-31, so there is no built in default. |
| `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE_EN`, `OPENAI_TTS_VOICE_TR` | `gpt-4o-mini-tts`, `marin`, `marin` | |
| `EMBEDDINGS_PROVIDER` | Voyage if configured, else OpenAI | Semantic note search. |
| `VOYAGE_API_KEY`, `VOYAGE_MODEL` | none, `voyage-4-lite` | |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Requested at 1024 dimensions. |
| `RAW_AUDIO_RETENTION_DAYS` | `7` | Opt-in recorder audio is deleted after this. |
| `LAB_AUDIO_RETENTION_DAYS` | `90` | Opt-in lab recordings are deleted after this. |
| `CRON_SECRET` | none | Vercel sends it to `/api/cron/expire-audio`. |
| `ADMIN_API_TOKEN` | none | Bearer token for `/api/admin/lab-results` (every participant's lab results). |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical URL. |
| `ALLOW_MOCK_PROVIDERS`, `ALLOW_MEMORY_STORE` | off | Let a production build run on mocks or memory, for a throwaway demo only. |

`/api/config` shows which provider each adapter resolved to, and lists configuration
problems (names of missing settings, never values).

## Supabase

1. Create a project. In Authentication, enable **anonymous sign-ins**. For a public launch
   also enable CAPTCHA (Cloudflare Turnstile) under bot and abuse protection: anonymous
   sign in is the front door to paid provider calls.
2. Apply the schema, either with the CLI:
   ```bash
   cd trial
   npx supabase link --project-ref <ref>
   npx supabase db push          # supabase/migrations
   npx supabase config push      # supabase/config.toml auth settings
   ```
   or by pasting `supabase/migrations/20261021000000_init.sql` into the SQL editor.
3. Set the three Supabase variables.

The migration creates every table with row level security (own rows only, for the
`authenticated` role, which anonymous users also have), explicit grants (new projects no
longer grant table privileges by default), foreign keys that include `user_id` so no row can
point at another user's row, `search_notes` (prefix full text plus pgvector, fused by
rank) and `delete_my_data`, and the private `audio` bucket with per user folder policies.

## Deploy on Vercel

1. New project from this repository, **root directory `trial`**. Framework: Next.js.
2. Add the environment variables above (production and preview as you see fit).
3. `vercel.json` registers the daily audio expiry cron (Hobby plans run crons at most once
   a day; the job may fire any time within its hour, so expiry can lag by up to a day).
4. Point the production domain at it, then set that domain as `NEXT_PUBLIC_SITE_URL` and as
   the Site URL and a redirect URL (`https://<domain>/settings`) in Supabase Auth.
5. After the first deploy, run the smoke test below with real keys.

The default Vercel region (Washington, D.C.) sits close to the provider APIs. Users far
from it pay the round trip on every exchange; the Timing page shows it.

### First deploy smoke test

The provider adapters were written against each provider's current API reference, but
this repository was built without live keys, so check each one once:

1. Open `/api/config`: every adapter should name a real provider and `problems` should be empty.
2. Complete the setup wizard with real earbuds; the first reply should play.
3. Ask "what can you do" in Turkish and English; on the Timing page `sttMode` should read
   `stream` when Deepgram streaming is on and the language is fixed.
4. Record a minute in the recorder, make notes, search them by word and by meaning.
5. Run a quick lab run; every chain and recognizer should score (failed calls show as
   errors with a code in the CSV).
6. Settings, delete everything: you return to the start page.

## How it works

**Audio.** One `AudioContext` per page at the hardware rate. Microphones go through a
small capture worklet that only posts mono chunks; resampling (our own windowed sinc, so
results do not depend on the browser's resampler), voice detection (Silero VAD v6 on
onnxruntime-web, single threaded) and analysis run on the main thread. Replies play as PCM
through a per source gain stage, which is also where attention decoding will plug in.

**One exchange.** Push to talk, or the VAD in hands-free mode, decides capture end. With
Deepgram and a fixed language the browser streams audio during speech using a 30 second
token from `/api/stt/grant`, then finalizes; otherwise it uploads the utterance.
`/api/assistant` runs recognition (when needed), streams Claude, cuts the text into
sentences, starts TTS for each sentence as soon as it is complete (two at a time: the one
being heard and the next), and streams text and PCM back as newline delimited JSON.
Requests on this path are hedged: when one has produced nothing after 2 s (speech), 5 s
(Claude) or about 3 s (recognition), an identical request goes out alongside it and the
first to answer is kept. On 2026-10-21, 3 of 48 OpenAI speech requests waited over 3 s for
a first byte, one for 25 s, while the rest started in about half a second; a repeat of the
same request was answered at the usual speed. Timings, all measured from capture end on the
browser's clock: end of speech detection, transcript final, first token, first sentence,
first audio, playback start. They are stored per exchange and summarized on `/debug`.

**Whisper mode.** Lower VAD thresholds and a longer pause before an utterance ends, the
microphone profile with automatic gain control, an optional 3 second calibration that
sets input gain so a whisper lands near -26 dBFS, a one sentence reply, and quieter
playback (plus a "speak softly" instruction where the TTS model accepts one).

**Rewind.** While it is on, every microphone chunk goes into a 30 second ring buffer in the
tab's memory, overwritten as it goes and cleared when Rewind turns off. A jaw clench arrives
like any other gesture (`jaw_clench`, bound to the `rewind` command; today the button and the
J key produce it, later a SensorProvider). The chosen seconds are then played three ways:
the real audio reversed and sped up as the rewind sound, the clip itself at a level brought
up to about -24 dBFS, and finally the recap. The same seconds go to `/api/rewind` once, at
the moment of the clench, as a 16 kHz WAV: recognition, then Claude with a recap prompt (no
tools, the transcript treated as data, the reply in the app's language), then speech, all
while the clip replays. Nothing is stored; the log line carries timings only. The figure is
a signed distance field of a head and shoulders sampled into about 30 000 points (15 000 on
small screens) when the screen opens, so there is no model file; the jaw and masseter are
tagged so the clench moves and lights them. Without WebGL a still drawing stands in.

**Focus.** Three fixed monologues (a trip story, a startup pitch, a barista calling orders)
are synthesized once per server instance by `/api/focus/voice`, each with its own voice,
and loop in the browser. Each goes through an HRTF panner at -45, 0 or 45 degrees, 1.6 m
away, into its own `SourceStage` source; the room's listener turns with the head. Head
direction comes from MediaPipe's facial transformation matrix (yaw, zero when facing the
camera, amplified 1.6 times so a comfortable turn reaches the side voices), from the
phone's orientation, or from drag, arrow keys and buttons. The voice within 18 degrees of
where the head points (or past the outermost one) is attended: it stays at full level and
the others drop 16 dB; between two people all three sit at -4 dB. A jaw clench (J, claimed
from Rewind while Focus plays) locks the voice you face. "What did they say?" takes that
voice's last 15 seconds as they were heard, sends them through the same recap path as
Rewind, and lowers the room to -22 dB while the answer plays. The camera image never
leaves the browser; the face model (`public/models/face_landmarker.task`, MediaPipe,
Apache 2.0, SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`) and
its WASM (copied into `public/vendor/mediapipe`) are served from this app.

**Notes.** The recorder's utterances are summarized by Claude with structured output
(title, summary, action items, topics, people, language), validated against a strict
schema with one retry, and embedded at 1024 dimensions. Search folds case and Turkish
letters (so "toplanti" finds "toplantıda") and matches prefixes.

**Lab.** One raw take per phrase, captured alongside a browser processed take where the
browser allows two captures at once, becomes four 16 kHz files:

| Chain | Processing |
|---|---|
| Browser default | echo cancellation, noise suppression and gain control, as the browser applies them |
| Raw | everything off |
| Raw + RNNoise | RNNoise in its AudioWorklet, rendered offline at 48 kHz (with a warm up check, since the worklet loads its WASM asynchronously) |
| Raw + high-pass + gate | 100 Hz high-pass, then spectral gating against the quietest frames (skipped for clean takes) |

Each file goes to every recognizer of the run. Transcripts are scored against the phrase:

- Text is normalized in the phrase's language: NFKC, Turkish aware lowercasing (I to ı, İ
  to i), apostrophes removed so suffixes join ("İstanbul'a" is "istanbula"), punctuation
  removed, numbers written as words (times, percentages, ordinals, decimals, thousands
  separators, Turkish suffixes after digits), and consecutive number words joined into one
  token, so "15", "on beş" and "onbeş" are the same.
- Spelling still counts: "Istanbul" with a plain I is a different word in Turkish.
- WER is word level Levenshtein (substitutions, deletions, insertions) over reference words;
  CER is the same over characters.
- Group rates are corpus level (all errors over all reference words). 95% intervals come
  from a seeded bootstrap that resamples takes, so one take scored by three recognizers
  counts once.
- The headline is whispered speech in a noisy place (street, cafe, wind or outdoors,
  vehicle) at the best chain.
- Mock and failed calls never enter the numbers.

**Privacy.** Consent first, an identity only after it, the microphone only after a tap.
Recording always shows a banner with one tap pause on every screen. Raw audio is kept only
with a separate opt-in, checked on the server against the consent log, and expires. Server
logs go through one logger that accepts only numbers and short codes, so no transcript can
reach a log. Export everything as JSON or Markdown; delete everything removes stored
objects through the Storage API, then every row, then the auth user.

## Tests

```bash
npm test                 # unit: normalization, WER, statistics, DSP, VAD state machine,
                         # pipeline, notes retry, stores, CSV, i18n, extension points
npm run test:db          # the real migration on a local Postgres with pgvector: RLS on
                         # every table, cross user isolation, search, delete_my_data
npm run test:audio-fixtures   # macOS: speech fixtures from the system voices
npm run test:video-fixtures   # a scanned head turning right, and left, as fake camera
                              # videos (downloads the head from the three.js examples)
npm run test:e2e         # Chromium with a fake microphone playing those fixtures:
                         # onboarding to a spoken reply, hands-free VAD, recorder to
                         # delete everything, a lab run to CSV, Rewind, Focus with keys,
                         # and Focus with the camera (one video per side: a right turn
                         # must bring the right voice forward and never the left)
npm run test:supabase    # optional, against a throwaway Supabase project
npm run build && npm run check:bundle   # no secret in anything a browser can download
npm run typecheck
```

`test:db` connects to `PGHOST` (default the Homebrew socket in `/tmp`) and creates and
drops a temporary database. `check:bundle` fails on any secret value present for the build
or any string shaped like a provider key; build with fake key values to exercise it.
`test:e2e` always runs against the mock providers and the in-memory store, even when
`.env.local` holds real keys. If every spec fails at "Allow microphone", the browser's
fake microphone did not open: on 2026-10-21 that happened for a few minutes on a Mac whose
default microphone was a pair of Bluetooth headphones, then it opened in 0.1 s again.

## Known limitations

**Bluetooth microphones.** When a web page uses the microphone of Bluetooth earbuds, most
earbuds switch to the hands-free profile: 8 kHz (narrow band) or 16 kHz (wide band) audio,
and often lower quality playback at the same time. Browsers cannot choose the codec. How
much quality is lost varies by earbud, phone and operating system. The setup wizard detects
it from the reported rate, the device label, and the measured bandwidth (which catches it
even when the browser resamples to 48 kHz), and offers a comparison with the built-in mic.
Detection is heuristic and can miss.

**Earbud buttons.** Media key support varies by browser, operating system and earbud.
Chrome and Safari deliver play and pause to a page that is playing media; next and
previous track depend on the earbud. Some earbuds stop sending media buttons while their
microphone is in hands-free mode, and some gestures are handled by the operating system
(voice assistants, noise control) and never reach the page. The assistant screen shows
exactly which actions arrived. Keyboard keys stand in during development.

**Output device choice.** Only Chromium browsers (Chrome, Edge, version 110 and later) can
send Web Audio to a chosen output. Safari and Firefox play on the system's current output.

**iOS Safari.** Audio needs a tap to start, and iOS suspends audio and microphone capture
when the page is hidden or the screen locks: recording stops in the background, and a
banner offers a tap to resume. Safari cannot hold two captures of one microphone, so the
lab's "browser default" chain is skipped there. Processing constraints (echo cancellation,
gain control) are not always applied as requested. Treat iOS as best effort.

**Android Chrome.** Works, with the same background suspension when the screen turns off,
and Bluetooth routing decided by the operating system.

**Firefox.** Supported for the assistant and the recorder; no output selection, and it may
not apply different processing to two captures, in which case the lab skips that chain.

**Latency numbers.** All stages are measured from capture end, as specified. In hands-free
mode the VAD waits 600 ms of silence (800 ms in whisper mode) before capture ends; that wait
is reported separately as end of speech detection. Playback start is when the browser hands
audio to the output; a Bluetooth link adds its own delay (often 100 to 300 ms) that no
browser can measure.

**The 1.5 s target needs more than OpenAI and Claude.** Measured on 2026-10-21 with
OpenAI recognition and speech and claude-sonnet-5-5, server side from the moment the
upload arrived, for a 9 s question: recognition 0.7 to 1.4 s, Claude's first words 1.1 to
1.7 s after that, first audio about 0.5 s after the first sentence. That is 2.6 to 3.3 s
to first audio, about 4.5 s when a hedge fires, before upload and playback. Streaming
recognition (Deepgram, fixed language) removes most of the first stage and ElevenLabs
Flash shortens the last; with Claude's first words at about 1.2 s, expect around 2 s even
then (an estimate, not yet measured).

**Streaming and language detection.** Live streaming needs Deepgram and a fixed language:
Deepgram's multilingual streaming does not cover Turkish, and streaming has no language
detection. "Detect" uses batch recognition, which is slower.

**No relay server.** Browser streaming uses short lived Deepgram tokens, so no WebSocket
relay is needed for the shipped providers. A provider without browser credentials falls
back to uploads; `SttProvider.transcribeStream` is the server entry point a relay would use
(see `docs/EXTENSIONS.md`).

**Provider deprecations.** OpenAI's `/v1/audio/speech` models shut down on 2027-01-06 and
`gpt-4o-transcribe` and `whisper-1` on 2027-02-26; ElevenLabs premade voices expire on
2026-12-31. The defaults already avoid what they can; plan the TTS move before January.

**Focus is a demonstration of the attention path, not of separation.** The three voices
are separate recordings; separating mixed voices in a real room is not attempted here. The
attention signal is head direction, a stand-in for an in-ear decoder. Earbuds' own head
tracking is not available to web pages, so the camera, the phone or keys stand in. Turning
on the camera needs camera permission; on phones, the orientation sensor asks on iOS.
HRTF rendering is the browser's generic one, so how well the voices sit in space varies by
listener. With ElevenLabs as the TTS provider all three voices use the configured voice.

**Rewind keeps the microphone open.** For as long as it is on, Bluetooth earbuds stay in
their hands-free profile, so music and calls sound narrower than usual; turn it off when
you do not need it. The jaw clench is simulated by a button and the J key: no sensor is read
in this trial. Speech a few meters away is recognized less reliably than your own, and the
recap says so when parts were unclear.

**Barge-in.** While the assistant talks, interrupting requires a confident detection, so
its own voice leaking from earbuds does not cut it off. On a loudspeaker it still can;
switch off "Interrupt by speaking".

**Abuse and quotas.** Rate limits are per server instance and in memory: a guard, not a
quota. Enable CAPTCHA for anonymous sign in before a public launch.

**Data.** Without the secret key, delete everything still removes every row and stored
object, but leaves an empty anonymous auth user; the expiry cron needs the key too.
Clearing the browser's storage loses access to anonymous data, as the consent text says.
The in-memory store is per process and for development only.

**Lab validity.** End to end tests use synthesized speech, not real whispers, and mock
recognizers produce simulated numbers (always labelled). Real numbers come only from real
recognizers and real people. RNNoise can occasionally fail to start offline; that chain is
then recorded as an error for the take, never as a silent result.

## Layout

```
app/                     pages (route group (app) holds everything after consent) and API routes
components/              UI: shell, setup, assistant, notes, lab, charts, ui
lib/shared/              isomorphic: types, text normalization, WER, statistics, phrases, CSV
lib/server/              env, adapters (providers/), stores (store/), assistant pipeline, notes
lib/audio/               engine, mic capture, resampler, FFT, analysis, VAD, chains, player
lib/client/              assistant, recorder, lab controllers, auth, sessions, preferences
lib/gestures/            GestureEvent bus, media keys, keyboard
lib/extensions/          SensorProvider and AttentionSignalProvider stubs
lib/i18n/                English and Turkish strings (Turkish must match English key for key)
supabase/                migrations, CLI config, the SQL test shim
public/worklets/         the capture AudioWorklet
public/models/           Silero VAD v6 (MIT, github.com/snakers4/silero-vad)
scripts/                 vendor copy, bundle secret check, test audio fixtures
tests/                   unit, db, e2e, integration
docs/EXTENSIONS.md       sensors, gestures, attention, relay, new providers
```

The copy rules of the marketing site apply here too: no em or en dashes, no health or
hearing claims, and no claim about noise robustness beyond measured numbers.
`node scripts/audit-copy.mjs` at the repository root checks the whole repository.
