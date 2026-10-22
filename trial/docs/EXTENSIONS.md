# Extension points

The web trial validates what ordinary browsers and earbuds can do today. Four seams are
left open for what comes later. None of them senses, decodes or classifies anything in
this version; each has a stub that does nothing, and the rest of the app already talks to
the seam, so a real implementation plugs in without touching the assistant, the recorder
or the lab.

| Seam | Interface | Stub | Fed today by |
|---|---|---|---|
| Earbud sensors | `SensorProvider` (`lib/extensions/sensor-provider.ts`) | `NullSensorProvider` | nothing |
| Gestures | `GestureEvent` on `gestureBus` (`lib/gestures/`) | | earbud media keys, keyboard |
| Attention | `AttentionSignalProvider` (`lib/extensions/attention-provider.ts`) | `nullAttentionProvider` | head direction on the Focus screen (a stand-in, see below) |
| Per source gain | `SourceStage` (`lib/audio/source-stage.ts`) | pass through | the assistant's voice, the three Focus voices |

## Sensors

```ts
interface SensorProvider {
  readonly id: string;
  readonly capabilities: SensorCapabilities; // channels, gestures it classifies, attention, transport
  connect(): Promise<void>;                  // call from a user gesture (device pickers need one)
  stream(): AsyncIterable<SensorSample>;     // { channelId, t, values: Float32Array }
  disconnect(): Promise<void>;
}
```

**Web Bluetooth** (Chrome and Edge on desktop and Android; not Safari or Firefox). A
prototype earbud exposes a GATT service with one notify characteristic per stream:

```ts
const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
const server = await device.gatt!.connect();
const service = await server.getPrimaryService(SERVICE_UUID);
const emg = await service.getCharacteristic(EMG_UUID);
await emg.startNotifications();
emg.addEventListener("characteristicvaluechanged", (e) => {
  const view = (e.target as BluetoothRemoteGATTCharacteristic).value!;
  // decode view (for example int16 little endian samples) into a SensorSample and
  // push it into the queue that stream() yields from
});
```

**WebHID** (Chromium desktop) suits wired or dongle prototypes:
`navigator.hid.requestDevice({ filters: [{ vendorId }] })`, `device.open()`, then decode
each `inputreport` event's `DataView`.

**Gestures from sensors.** Classification (a jaw clench from EMG, for example) runs in
the provider or a classifier behind it. Recognized gestures are published with
`emitSensorGesture(type, sensorId, confidence)`, and from there they behave exactly like an
earbud tap. To add a provider to the app, start it from a user gesture in the shell (next
to the media key switch on the assistant screen) and keep its lifetime with the page.

## Gestures

`lib/gestures/types.ts` defines the stream: `tap`, `double_tap`, `triple_tap`,
`jaw_clench`, `jaw_double_clench`, `whisper_start`, `whisper_end`, each with a source
(`media_key`, `keyboard`, `sensor`) and optional detail (the media action, the key, a
classifier's confidence). `triple_tap` is the one addition to the brief's list: earbuds
commonly send "previous track" for a triple tap.

Commands live in `lib/client/commands.ts` (`toggle_listening`, `mark_moment`,
`stop_recording`, `toggle_recording`, `stop_speaking`). The user maps gestures to commands
in Settings; the defaults are tap to start or stop listening, double tap to mark the
moment, triple tap to stop recording, and the same for the two jaw gestures. The assistant
and the recorder never read buttons directly, so a new source needs no change in them.

The keyboard stands in for everything during development: T, D and R for taps, J and K for
the jaw gestures.

A screen that is live can claim a gesture for as long as it runs (`claimGesture` in
`lib/gestures/claims.ts`): while Focus plays, the jaw clench locks onto the voice you face
(`lock_focus`) instead of running its binding (`rewind` by default). Releasing the claim
restores the user's binding.

## Attention

```ts
interface AttentionSignalProvider {
  readonly id: string;
  currentAttendedSource(): { sourceId: string; confidence: number } | null;
}
```

The audio graph already routes every sound the app plays through `SourceStage`, one gain
node per source id, before the master output. Attention decoding adds two things:

1. **Separated sources.** A hear-through path would take the microphone, separate the
   voices around the wearer (beamforming, or a separation network in an AudioWorklet), and
   connect each separated voice to `engine.sources.input(sourceId)`.
2. **Weighting.** Install the provider with `engine.sources.setAttentionProvider(p)` and
   call `engine.sources.applyAttention()` on the decoder's decision interval (for example
   every 250 ms). With a confident decision it raises the attended source and lowers the
   others; with no decision, or the stub, nothing changes. The default boost and cut
   (6 dB each, confidence 0.7 and above) are deliberately conservative starting points.
   `among` limits the weighting to some sources (so the app's own voices are left alone),
   and `neutralDb` sets them all to one level when nobody is attended.

The Focus screen exercises this path end to end with a stand-in signal: its provider
(`lib/client/focus.ts`) reports the voice the head is turned to (camera head pose, phone
orientation, or keys), or the voice locked with a jaw clench. Its three sources are
separate recordings rather than voices separated from a microphone, so step 1 is the part
it does not cover. An in-ear decoder replaces the provider; nothing else changes.

## A WebSocket relay for streaming recognition

The shipped streaming provider (Deepgram) issues short lived browser tokens, so the
browser connects to it directly and no relay is needed. A provider without browser
credentials needs a small relay outside Vercel functions (which do not hold WebSocket
connections), on any Node host:

1. Accept a WebSocket from the browser with the user's Supabase access token, and verify
   it with `getStore().verify(token)`.
2. Read 16 kHz PCM16 frames from the socket into an async iterable and pass it to
   `getStt().transcribeStream(audio, { language })`.
3. Send each yielded event (`partial`, `final`, `error`) back as JSON.

The browser side mirrors `lib/client/stt-stream.ts` with the relay's URL in place of the
grant.

## New providers

Each adapter is an interface in `lib/server/providers/types.ts`:

| Interface | Methods |
|---|---|
| `SttProvider` | `transcribeFile`, `transcribeStream`, optional `createBrowserStreamGrant`, plus capabilities |
| `LlmProvider` | `streamAssistantReply` (with the notes tool), `extractStructured` |
| `TtsProvider` | `synthesize` (raw PCM16 mono at `sampleRate`) |
| `EmbeddingProvider` | `embed` (1024 dimensions; the model name is stored with every vector) |

Write the adapter next to the existing ones, add its id to the list in
`lib/shared/types.ts`, wire its key and model variables in `lib/server/env.ts`, and
construct it in `lib/server/providers/index.ts`. Errors become `ProviderError` codes;
provider messages are never forwarded or logged.
