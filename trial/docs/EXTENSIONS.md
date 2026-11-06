# Extension points

The web trial validates what ordinary browsers and earbuds can do today. Four seams are
left open for what comes later. Each has a stub that does nothing, and the rest of the app
already talks to the seam, so a real implementation plugs in without touching the
assistant, the recorder or the lab. The first one is filled: `SignaliveSensorProvider`
reads Signalive earbuds, their digital twin or an OpenBCI board, once the visitor connects
them in Settings.

| Seam | Interface | Stub | Fed today by |
|---|---|---|---|
| Earbud sensors | `SensorProvider` (`lib/extensions/sensor-provider.ts`) | `NullSensorProvider` | `SignaliveSensorProvider` while earbuds are connected in Settings |
| Gestures | `GestureEvent` on `gestureBus` (`lib/gestures/`) | | earbud media keys, keyboard, the connected earbuds' jaw clench |
| Attention | `AttentionSignalProvider` (`lib/extensions/attention-provider.ts`) | `nullAttentionProvider` | head direction on the Focus screen (a stand-in, see below); the earbuds' decoder when it has a model |
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

### Signalive earbuds

`SignaliveSensorProvider` (`lib/extensions/signalive-provider.ts`) runs the phone side
software in the repository's `lib/sense`, imported as `@sense/*` rather than copied (the
README says how the import and its type check work). Every source speaks SSP v0, the
Signalive Sensor Protocol (`hardware/PROTOCOL.md` at the repository root), so everything
after the transport is the same whichever is connected:

| Transport | Class (`lib/sense/transport.ts`) | What it is |
|---|---|---|
| `simulated` | `TwinTransport` over `DigitalTwin` | Two emulated earbuds, four electrodes each at 500 Hz and an IMU at 100 Hz, playing a synthetic background (seeded noise of 5 uV RMS and a 10 Hz rhythm of 10 uV, three minutes, looped). `twin.clench(kind)` adds jaw muscle activity to every electrode of both; `twin.setYaw(deg)` turns the head. Every frame carries the simulated flag. |
| `bluetooth` | `WebBluetoothTransport` | Real earbuds: one GATT service per earbud (`5a9a0001-...`), frames notified on one characteristic, commands written to another. Each earbud is its own device, so each needs its own pick in the browser's chooser (Settings offers "Add the other earbud"). A dropped earbud is reconnected. Chrome and Edge only. |
| `cyton` | `CytonSerialTransport` | An OpenBCI Cyton dev kit over Web Serial (its USB dongle, 115200 baud), 8 channels at 250 Hz, re-encoded on the phone as SSP frames of one device. Wire inputs 1 to 4 to the left ear and 5 to 8 to the right. Chromium on computers only. |

What happens to the frames: the provider keeps the transport and the connection, and hands
every byte to one `PhoneSession` (`lib/sense/session.ts`), the phone side as it will ship and
the same one the site's research console runs.

1. **Decode.** One `SspDecoder` per earbud. A HELLO gives the electrodes' labels, the rates,
   the ADC scale and the battery; the rate the earbuds announce is adopted before any EEG
   when both agree, and an earbud that streams without a HELLO is asked for one.
   `EegStream` places EEG frames in a series with NaN for exactly the samples lost on the
   air.
2. **One timeline.** Each earbud's clock is mapped onto the phone's (`ClockSync`, from frame
   arrivals), and both ears are read out on a fixed grid on the phone's clock, never by
   count: tick k is t0 + k / fs and takes each ear's nearest sample, or NaN. The earbuds
   start at different moments (two chooser picks) and their crystals drift apart; a stalled
   earbud's backlog that arrives after its moments were read out is dropped. Four
   electrodes are read from each ear, the protocol's design target, and a device carrying
   both ears is split down the middle.
3. **Clench.** Three `ClenchDetector`s run side by side: both ears at once, at four times
   their background, and each ear alone, at five, since nothing on the other side can veto
   a touch on that earbud. Each is fed only while its own ears have signal, and one speaks
   for the earbuds, chosen by how much of the last two seconds each ear covered: both ears
   while both are there, otherwise the one that is, so a weak or dropped earbud leaves the
   clench on the other. A single clench is published as `jaw_clench`, a double as
   `jaw_double_clench` and a hold (over 700 ms) as `jaw_hold`, through
   `emitSensorGesture(type, "signalive", confidence)`, the confidence being how far the
   clench cleared that detector's threshold (`1 - k / strength`, clipped to 0..1), and the
   report's latency from the jaw's onset (`detail.latencyMs`). Four bursts within 3 s are
   chewing and are ignored for 2 s; the bites before the fourth have been published by then,
   so the detector also takes them back (`ClenchDetector.takeWithdrawals`, the session's
   `onClenchWithdrawn`) and the provider withdraws their gestures from the bus
   (`withdrawSensorGesture`), about two seconds after the first bite.
4. **Head.** The IMU's quaternion gives the head's yaw (`yawDeg`), both earbuds averaged on
   the circle and forgotten half a second after their last motion frame.
   `provider.onYaw()` passes it on at every motion frame to the head tracker's `earbuds`
   source, which takes the first reading as straight ahead (the IMU has no compass) and
   steers like the camera.
5. **Attention.** When the earbuds send speech envelopes (AUDIO_ENV), a model is there
   and the earbuds' electrodes are the model's inputs in its order: the session places the
   envelopes on the same timeline as the EEG, its decoder (the learned one, or a linear
   one; `createDecoder` picks by the model's version) decides every 10 s, an
   `AttentionBelief` adds those decisions up by what each is worth, and `fuseAttention`
   weighs the belief with facing the talker. Once a second the provider reports the likeliest talker and, when it or its
   emphasis changes, writes the session's STEER to both earbuds (relative to the head, at
   most 9 dB). The talkers' places in the room come from the `azimuths` option (by default
   the simulated earbuds' own). `provider.attention` reports the talker as
   `earbuds:talker<i>`, the id a hear-through path would register those voices under in the
   `SourceStage`. Real earbuds get the learned decoder: `lib/client/earbuds.ts` fetches
   `/vendor/attention/neural.json` (copied from `public/research/neural.json` by
   `scripts/copy-vendor.mjs`) once they are connected, and hands it over with
   `provider.useDecoderModel()`, so the chooser never waits for half a megabyte. Any
   model can also be passed up front: `earbuds.connect("bluetooth", { decoderModel })`.

The provider's `view` store holds what Settings shows: the phase, each earbud's battery,
wear and lead off (per electrode, once an earbud reports it), the frames received and lost,
the head yaw, whether the clench detector is listening and on which ears, and the last
attention decision.
`stream()` yields every channel as it arrives (`left:L1` in microvolts, `left:yaw` in
degrees) and ends at disconnect. `capabilities` lists the channels the earbuds announced in
their HELLO (before that, what the transport is known to carry), the three jaw gestures, and
attention only where the decoder can run.

`lib/client/earbuds.ts` holds the one provider for the page: Settings connects it from a
tap and disconnects it, it stays across screens, and `earbuds.sensor` is
`NullSensorProvider` while nothing is connected. The provider's code loads when the
Earbuds section opens, ahead of the tap, so the browser's chooser still opens within the
tap's user activation.

**Plugging in real hardware.** Nothing in the app changes. Firmware that speaks SSP v0
(`hardware/firmware/ssp.c` is the reference encoder) advertises the service UUID, sends a
HELLO when streaming starts (labels, EEG rate, nanovolts per count, IMU rate, battery),
then EEG frames of raw int24 counts, IMU frames with the quaternion in the head frame, and
EVENT frames for battery, wear and lead off, and obeys START, STOP, SET_EEG_RATE, STEER and
HELLO. Connect with "Earbuds over Bluetooth" in Settings, pick one earbud, then add the
other. Every sample stays in the tab: nothing from the sensors is uploaded, stored or
logged.

**Other prototypes.** A device that does not speak SSP can still be a `SensorProvider`:
Web Bluetooth (`requestDevice({ filters: [{ services: [SERVICE_UUID] }] })`, then
`startNotifications()` and decode each notification's `DataView`), Web Serial, or WebHID
(`navigator.hid.requestDevice({ filters: [{ vendorId }] })`, then each `inputreport`
event's `DataView`), always from a user gesture.

**Gestures from sensors.** Classification (a jaw clench from EMG, for example) runs in
the provider or a classifier behind it. Recognized gestures are published with
`emitSensorGesture(type, sensorId, confidence, latencyMs?)`, and from there they behave exactly like an
earbud tap. A sensor that finds out later that a gesture was not one takes it back with
`withdrawSensorGesture(type, at)` (`at` is what `emitSensorGesture` returned):
`gestureBus.onWithdraw` listeners undo what it started, and `lib/client/commands.ts` calls
off the moment it began keeping (`moments.withdraw`), the replay or the Focus lock. To add a provider to the app, start it from a user gesture (the Earbuds
section in Settings does) and keep its lifetime with the page (`lib/client/earbuds.ts`).

## Gestures

`lib/gestures/types.ts` defines the stream: `tap`, `double_tap`, `triple_tap`,
`jaw_clench`, `jaw_double_clench`, `whisper_start`, `whisper_end`, each with a source
(`media_key`, `keyboard`, `sensor`) and optional detail (the media action, the key, a
classifier's confidence). `triple_tap` is the one addition to the brief's list: earbuds
commonly send "previous track" for a triple tap.

Commands live in `lib/client/commands.ts` (`toggle_listening`, `mark_moment`,
`stop_recording`, `toggle_recording`, `stop_speaking`). The user maps gestures to commands
in Settings; the defaults are tap to start or stop listening, double tap to mark the
moment, triple tap to stop recording, a jaw clench to rewind and a double jaw clench to
mark the moment. The assistant
and the recorder never read buttons directly, so a new source needs no change in them.

Connected Signalive earbuds produce the two jaw gestures themselves; in Settings, their
simulation has buttons to clench, clench twice and turn the head. The keyboard stands in
for everything during development: T, D and R for taps, J and K for the jaw gestures.

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
orientation, keys, or the motion sensor of connected earbuds), or the voice locked with a
jaw clench. Its three sources are
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
