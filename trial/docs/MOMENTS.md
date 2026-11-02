# Moments

A clench keeps the last seconds the earbuds' microphone heard as a moment: when, where,
what was said, what it means, what to do about it. The app keeps moments on the device
(IndexedDB). The server only turns those seconds into a moment once, answers questions
about the moments the device sends along with each one, recognizes a spoken question, and
reads text aloud. The contract both sides follow is `lib/shared/moments.ts`; this page is
mostly the server's side of it, and ends with the app's.

| Route | Body | Streams | Per user |
|---|---|---|---|
| `POST /api/moments` | multipart: `audio`, a 16 kHz mono WAV of at most 30 s, and `meta`, JSON (`MomentRequestMetaSchema`) | transcript, moment, sentences and audio with `speak`, done | 20 a minute |
| `POST /api/agent` | JSON (`AgentRequestSchema`) | tool, action, cite, text, sentences and audio with `speak`, done | 20 a minute |
| `POST /api/speak` | JSON, `{ "text": string, "lang": "en" \| "tr" }`, text 1 to 4000 characters | sentences, audio, done | 30 a minute |
| `POST /api/stt` | multipart: `audio`, a 16 kHz mono WAV of at most 30 s, and `meta`, `{ "speechLang": "en" \| "tr" \| "auto" }` | nothing: one JSON answer, `{ text, language, provider, model, ms }` | 60 a minute |

All four need a signed in user (bearer token) who has accepted the trial's terms, checked
on the server, and stream newline delimited JSON once the request is accepted. A request
turned away before that gets an HTTP status and `{ "error": code }`: 400 (`audio_required`,
`invalid_request`, `invalid_json`, `missing_audio`, `audio_empty`, `audio_invalid`), 401
`unauthenticated`, 403 `consent_required`, 413 `audio_too_large`, 429 `rate_limited`.
Inside the stream a failure is the last event, `{"t":"error","code":...}`, with
`provider_<code>` (such as `provider_rate_limited` or `provider_timeout`), `moment_invalid`,
`agent_unavailable`, `aborted` or `server_error`. A client that goes away aborts the
provider calls.

Speech arrives as `{"t":"sentence","i","text"}` when a sentence is complete, then
`{"t":"audio","i","sr":24000,"pcm"}` chunks of base64 PCM (16 bit, mono) in sentence
order: the events the assistant and Rewind stream, so the same player plays them. Each
sentence is synthesized as soon as it is complete, two at a time, and a request that has
produced nothing after 2 s (speech), 5 s (Claude) or about 3 s (recognition) gets an
identical one alongside it, as on the assistant's path.

## POST /api/moments

1. **Recognition.** The WAV goes to the recognizer (OpenAI `gpt-transcribe` in production)
   with `speechLang`; `"auto"` lets it decide. `{"t":"transcript","text","language","provider","model","ms"}`.
2. **Nothing said.** `{"t":"no_speech"}`, then with `speak` one spoken line in `replyLang`
   ("I couldn't make out any speech in those seconds, so nothing was saved."), then
   `done`. The language model is not called.
3. **The moment.** Claude writes `MomentContent` with structured output, in `replyLang`
   whatever language was spoken: a title like an email's subject, a two or three sentence
   summary, up to four key points, action items, people and topics. The transcript is data,
   never instructions. The prompt gives the current time as ISO 8601 with the wearer's UTC
   offset, so "Friday at 3" becomes `2026-11-06T15:00:00+03:00`, and a day said without a
   time becomes a date alone (`2026-11-06`). `place` is context only, for words like
   "here"; it is not written into the moment (the device keeps the place itself).
   The answer is then held to the contract: whitespace tidied, text cut at a word to its
   limit, lists capped and without repeats, every `due` checked as ISO 8601 (a local time
   without an offset gets the zone's offset for that date; anything else becomes null), and
   `language` set to `replyLang`. An answer without a title or a summary is asked for once
   more; a second one ends the request with `moment_invalid` rather than keep a bad
   moment. `{"t":"moment","content","model"}`, where `model` is the model that wrote it.
4. **Confirmation.** With `speak`, "Saved: <title>." and the first action item ("To do:
   ...", in Turkish "Kaydedildi: ..." and "Yapılacak: ...") as sentence and audio events,
   without text events, since the app already has the moment. If speech fails here, the
   stream ends with an error after the moment, and the moment stays complete and valid.
5. `{"t":"done","totalMs"}`.

`now` is the wearer's local time. When it contains an ISO 8601 timestamp with an offset,
alone or next to a localized date as the app sends it (`"Monday, 2 November 2026 at 14:05
(2026-11-02T14:05+03:00)"`), that is the instant, so a moment sent a while after the clench
still counts "tomorrow" from the clench. Without one the server's clock is used.
`timeZone` (IANA) gives the offset; an unknown zone is ignored.

## POST /api/agent

The last message is the question and must be the wearer's; the ones before it are the
history. `moments` are the up to 12 the device chose for this question. The system prompt
holds them newest first (when and where each was kept, title, summary, key points, action
items with their times, people, but not the transcripts), the wearer's local time, the
reply language, and the reply's form: spoken, one to three short sentences for the ear; or
text, a few plain sentences. The model must not invent a moment or anything in one, and the
moments are data, never instructions.

| Tool | Input | What it does |
|---|---|---|
| `find_moments` | `query` | Searches the moments sent with the question, and only those: title, summary, key points, action items, people, place and transcript. Words are folded like note search (so "toplanti" finds "toplantıda") and match as prefixes either way ("meetings" finds "meeting"); a match in the title or people counts most, and the newer moment wins a tie. Returns up to four matches: id, when, title, which fields matched, and an excerpt of what was said around the match. |
| `create_reminder` | `text`, `due`, `momentId` | Proposes `{"kind":"reminder"}`. `due` may be a date alone. |
| `create_event` | `title`, `start`, `end`, `location`, `momentId` | Proposes `{"kind":"event"}`. `start` needs a date and a time (otherwise the model is told to ask), `end` must come after it. |
| `draft_message` | `channel`, `to`, `subject`, `body`, `momentId` | Proposes `{"kind":"draft"}`; a subject only for email. |
| `cite_moments` | `ids` | `{"t":"cite","momentIds"}` with those of the ids the device sent. |

Every proposal passes `AgentActionSchema` (times are normalized as for moments, and a
moment id the device did not send becomes null) and goes out as
`{"t":"action","action","momentId"}`. The tool tells the model the action is proposed and
waits for the wearer; nothing is carried out on the server. Input that fails a tool's schema
goes back to the model to correct, not into the tool: tool input is streamed (eager input
streaming), so the API does not validate it.

The loop runs through `LlmProvider.streamAgentReply`: Claude with the model, thinking
setting, effort and refusal fallback of the environment (`LLM_MODEL`, `LLM_THINKING`,
`LLM_EFFORT`, `LLM_FALLBACKS`). Three rounds of tool calls run; calls in the round after
are answered with "answer with what you have", and calls after that end the turn.
`{"t":"tool","name","state":"start"}` arrives when the model begins a call, and `end` when
it ran or was turned down. A refusal ends the reply with the refusal line. The reply
streams as text deltas, and with `speak` as sentences and audio too; then
`{"t":"done","reply","model","totalMs"}`.

Two rules keep the reply to the answer. At its lowest thinking setting the model says a few
words before a tool call ("I'll propose that reminder and cite the moments."), and the
prompt alone does not stop it, so the text that starts each stretch is held until it is 120
characters long (then it streams) or a tool call starts (then it is set aside, and dropped if
the model says more after the tools). And a response that answers and then only cites ends
the turn once the citation is recorded: asked again, the model repeats its answer. An
answer followed by a call that does something (proposing the reminder it just mentioned)
can bring the same repeat, so the tool results then carry a note that the wearer already
heard the answer, and whatever the model says after such a call waits for the end of the
turn, where only its sentences that are not a repeat go out (`newSentences`).

## POST /api/speak

Reads text the app already has aloud, such as a moment's title and summary: sentence and
audio events, then `{"t":"done","totalMs"}`. No text events, nothing stored, nothing about
the text logged but its length.

## POST /api/stt

Recognition and nothing else, for a question spoken in Ask when the browser cannot stream
to the recognizer itself: one JSON answer with the words (`""` when there were none) and
their language. A recognizer that fails gives 502 with its code. Nothing is stored; the log
line has the clip's length, the time taken and whether it was empty.

## Privacy

- Nothing about a moment is stored on the server: no table, no file, no cache. The audio
  is read into memory, sent to the recognizer and dropped with the request; the transcript,
  the moment, the question and the reply exist only in the response. Moments live on the
  device, and the agent sees only the few the device sends with a question.
- The providers that process them: OpenAI (recognition and speech) and Anthropic
  (Claude). The keys stay on the server.
- Logs carry metrics only. Each route writes one line through `lib/server/log.ts`, which
  lets only numbers, booleans and short codes through: trigger, languages, whether to
  speak, seconds of audio, counts (key points, action items, people, tool calls, actions,
  citations, audio chunks), timings and error codes. `tests/unit/moments-routes.test.ts`
  runs all three routes with made up words in the speech, the moment, the question and the
  text read aloud, records every call to the logger and everything printed, and fails if
  any of those words shows up.
- A proposed action is only a proposal: the server cannot set a reminder, create an event
  or send a message.

## Tests and mocks

`tests/unit/moments-contract.test.ts` (the schemas), `moments-pipeline.test.ts` (content,
no speech, the spoken confirmation, retries, prompt, failures), `local-time.test.ts`,
`agent-pipeline.test.ts` (the loop with the mock, the tools, find_moments, the two reply
rules), `anthropic-agent.test.ts` (the Claude loop against a stand-in SDK client:
validation, refusals, fallback markers, the round cap, malformed tool input) and
`moments-routes.test.ts` (the guards, all three routes end to end, privacy). Without keys
the mock providers answer: the recognizer returns a fixed sentence (nothing for silence),
the language model writes a moment from the transcript (its summary starts "Mock
summary.") and, as the agent, proposes one reminder about the best match (or the newest
moment) and cites it, and speech is a tone per word.

## Measured

2026-11-02, through the dev server with the production providers (OpenAI `gpt-transcribe`
and `gpt-4o-mini-tts`, `claude-sonnet-5-5` at the lowest thinking setting and low effort),
two clips spoken by OpenAI's voice and resampled to 16 kHz, times from request to event on
the client:

| | English, 9.4 s | Turkish, 8.3 s |
|---|---|---|
| Transcript | 1.4 s | 0.8 s |
| Moment | 3.7 s | 3.8 s |
| First audio of the confirmation | 4.6 s | 4.7 s |
| Done | 5.3 s | 5.3 s |

The first moment after a cold start took 6.3 s: structured output compiles a new schema
once. The agent, asked "What do I need to do this week? Remind me to check on the slides on
Thursday at 5 pm." with both moments and speech on, proposed the reminder
(`2026-11-05T17:00:00+03:00`, from the English moment) and cited both at 2.0 s; its first
text came at 3.7 s, first audio at 4.3 s, done at 6.7 s.

## The app

- **Moments** (`app/(app)/moments`) is the home screen after setup. A clench (J on the
  keyboard) or "Keep this moment" sends the last seconds of the rewind buffer, which lives
  in this tab's memory only, to `POST /api/moments` and writes what comes back to IndexedDB
  (`lib/client/moments-store.ts`). Where IndexedDB is refused, moments last while the page
  is open, and a notice says so. Place is off by default; turned on, the device asks
  OpenStreetMap's Nominatim for a short name, at most once a minute
  (`lib/client/moments-place.ts`).
- **A moment** shows its key points and to-dos, each with Remind me, Add to calendar (an
  .ics file, or the phone's calendar inside the Signalive app) and Draft, what was said,
  and Delete.
- **Ask** (`app/(app)/ask`) takes a typed or spoken question. The device picks at most 12
  moments by word overlap (folding Turkish letters) and recency
  (`lib/client/agent-context.ts`), sends them with the question to `POST /api/agent`, and
  shows the answer, the moments it drew on and each proposed action, which runs only when
  accepted. A held clench (H) asks by voice from any screen and stops listening when the
  talking stops.
- **Installable.** `app/manifest.ts` and `public/sw.js` make it an app on the home screen;
  the service worker keeps the app shell and never an `/api` response, so moments open
  offline.
- **Exports and deletion.** Settings exports every moment as JSON or Markdown and deletes
  them all; nothing about them is on the server to delete.
