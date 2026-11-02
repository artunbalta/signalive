# SSP v0: the Signalive Sensor Protocol

The wire protocol between a Signalive earbud and the phone. Version 0.

| | |
|---|---|
| Firmware reference encoder | `hardware/firmware/ssp.h`, `hardware/firmware/ssp.c` (C99, no allocation) |
| Phone decoder and encoder | `lib/sense/protocol.ts` |
| Digital twin of the earbuds | `lib/sense/twin.ts` |
| Transports | `lib/sense/transport.ts` (twin, Web Bluetooth, OpenBCI Cyton over Web Serial) |
| Cross language fixture | `lib/sense/__fixtures__/ssp-golden.bin` and `.json`, written by `hardware/firmware/golden.c` |

## Why the firmware is thin

Everything that might change lives on the phone: the band pass filters, the
montage, the attention decoder and its trained model, the clench detector and
its thresholds, the fusion of head direction with the decoder, and the gain
policy. All of it is TypeScript in `lib/sense/`, shipped with the app and
updated with it.

The earbud firmware does four things and nothing else:

1. sample the ear electrodes, the IMU and (optionally) its microphones' speech envelopes,
2. stamp every frame with its own microsecond clock,
3. packetize into the frames below, one frame per BLE notification,
4. obey five commands from the phone.

That split is what lets the software be finished before the hardware exists.
The firmware is small enough to be checked byte for byte against a golden
stream, rarely needs an update (updating earbuds over the air is slow and
risky), and every source of SSP frames looks the same to the phone: the
digital twin, the OpenBCI dev kit and, later, the earbuds themselves.

The one thing the phone cannot do is touch live audio: sound cannot make a
round trip through the phone fast enough. So the earbud runs its own audio
processing on its own microphones, and the phone only steers it, with a
direction and a gain (the STEER command). If the earbud also computes a
speech envelope per talker (AUDIO_ENV), the phone can decode attention
without raw audio ever crossing the air.

## Topology

True wireless: the left and right earbud are independent BLE peripherals,
each with its own connection to the phone, its own clock and its own
sequence numbers. They share no wire and no electrical reference, so each
ear's electrodes are referenced within that ear (the "wireless" montage in
`research/aad/pipeline.py`). A dev kit that carries both ears on one board
(the OpenBCI Cyton) is a single device and uses side 2.

The design target is 4 electrodes per ear, at 250 Hz (500 Hz supported).

## GATT

| | UUID | Properties |
|---|---|---|
| SSP service | `5a9a0001-282b-483b-bc7c-5ef1d6777a4d` | primary |
| Frames, earbud to phone | `5a9a0002-282b-483b-bc7c-5ef1d6777a4d` | notify |
| Commands, phone to earbud | `5a9a0003-282b-483b-bc7c-5ef1d6777a4d` | write, write without response |

The three share one random 128 bit base (`5a9aXXXX-282b-483b-bc7c-5ef1d6777a4d`),
numbered in the second 16 bits as Nordic's UART service does. They are fixed.
`ssp.h` defines them as strings and, through `SSP_UUID_LE(n)`, as the 16
little endian bytes most BLE stacks take for a GATT table;
`lib/sense/protocol.ts` exports them as `SSP_SERVICE_UUID`,
`SSP_FRAMES_UUID` and `SSP_COMMANDS_UUID` (lowercase, as Web Bluetooth
requires). The golden fixture carries the C strings, and the TypeScript
tests require the same.

Each earbud advertises the service UUID, so the phone's chooser can filter on
it, and puts its name in the scan response. One frame is one notification;
one command frame is one write.

### MTU and frame size

The protocol assumes ATT MTU 247 with LE data length extension (link layer
payload 251 bytes), so a notification carries up to 244 bytes and one frame
travels in one link layer packet. 2M PHY is used when both ends support it.
Frames are never fragmented: the earbud packs as many samples as fit the MTU
it actually negotiated.

Every frame costs 16 bytes of header and CRC. Samples per frame:

| ATT MTU | Max frame | EEG, 4 channels | EEG, 8 channels | IMU |
|---|---|---|---|---|
| 185 | 182 B | 13 | 6 | 8 |
| **247** | **244 B** | **18** (234 B frame) | **9** (234 B frame) | 11 |
| 517 | 514 B | 41 | 20 | 24 |

In general an EEG frame of n samples of c channels is 18 + 3nc bytes, so
n = floor((MTU - 3 - 18) / (3c)). `ssp_max_eeg_samples` and
`maxEegSamples` compute it. At 250 Hz, 18 samples is 72 ms of EEG per frame,
which delays nothing that matters: attention decisions are made over seconds
and a clench takes a few hundred milliseconds.

A host command is at most 21 bytes. With the default MTU of 23 that is one
byte more than a single write, so the phone negotiates the MTU before it
sends anything.

## Frame format

Every field is little endian, the CRC included.

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | magic `0x53` ("S") |
| 1 | 1 | magic `0x4C` ("L") |
| 2 | 1 | version, 0 |
| 3 | 1 | type |
| 4 | 1 | side: 0 left, 1 right, 2 single device (in a command: either) |
| 5 | 1 | flags |
| 6 | 2 | seq, u16, per side, wraps |
| 8 | 4 | timestamp, u32, device microseconds of the frame's first sample, wraps |
| 12 | 2 | payload length L, u16, at most 1008 |
| 14 | L | payload |
| 14 + L | 2 | CRC-16/CCITT-FALSE over bytes 0 to 13 + L |

The CRC is polynomial 0x1021, initial value 0xFFFF, no reflection, no final
xor; its check value for the ASCII string `123456789` is 0x29B1. No v0 frame
is longer than 1024 bytes on any transport, which bounds how long a decoder
can wait on a corrupted length field.

**seq.** One counter per earbud across every frame type, incremented for
every frame the earbud makes, including frames it had to drop. It starts at
0 when streaming starts. Commands carry the phone's own counter.

**timestamp.** The earbud's microsecond clock when the frame's first sample
was taken. It wraps every 2^32 us, 71.6 minutes, and the phone unwraps it.
The ADC must run from the same crystal as this clock (or each sample must be
stamped as it is taken), so that the timestamps and the sample clock agree.

**flags.**

| Bit | Name | Meaning |
|---|---|---|
| 0x01 | STREAM_START | first frame after streaming (re)starts: the phone forgets this side's sequence and timeline |
| 0x02 | LEAD_OFF | an electrode is off; the last lead off EVENT says which |
| 0x04 | DEVICE_DROP | the earbud dropped frames itself before this one (its queue was full); the gap was not the radio |
| 0x80 | SIMULATED | made by an emulator (the digital twin), never by hardware |

### Types

| Code | Type | Direction |
|---|---|---|
| 0x01 | HELLO | earbud to phone |
| 0x02 | EEG | earbud to phone |
| 0x03 | IMU | earbud to phone |
| 0x04 | EVENT | earbud to phone |
| 0x05 | HOST COMMAND | phone to earbud |
| 0x06 | AUDIO_ENV | earbud to phone, optional |

### 0x01 HELLO

Who the earbud is and how to read its samples. Sent when streaming starts
(with STREAM_START), when the phone asks for one, and in answer to
SET_EEG_RATE. The phone reads no EEG until it has a HELLO for that side.

| Offset | Size | Field |
|---|---|---|
| 0 | 3 | firmware version: major, minor, patch |
| 3 | 1 | channel count c, 1 to 32 |
| 4 | 8 | device id |
| 12 | 2 | EEG sample rate, Hz, u16 |
| 14 | 4 | ADC nanovolts per count, float32, referred to the electrode |
| 18 | 2 | IMU sample rate, Hz, u16 (0: no IMU) |
| 20 | 1 | battery percent (255: unknown) |
| 21 | 4c | channel labels, 4 bytes each, printable ASCII, NUL padded |

Payload: 21 + 4c bytes. For an ADS1299 class front end at gain 24 the scale
is 4.5 V / 24 / 2^23 = 22.35 nV per count (exact in float32), a full scale
of plus or minus 187.5 mV. A count of 8388607 or -8388608 is a saturated
channel.

### 0x02 EEG

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | sample count n, 1 to 255 |
| 1 | 1 | channel count c, as in HELLO |
| 2 | 3nc | raw ADC counts, signed int24, interleaved by sample: s0c0, s0c1, ..., s0c(c-1), s1c0, ... |

Sample k of the frame was taken at timestamp + k * 1e6 / rate device
microseconds. Microvolts are counts * nvPerLsb / 1000. Encoders saturate a
count outside the int24 range instead of wrapping it.

### 0x03 IMU

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | sample count n |
| 1 | 20n | per sample: accel x, y, z (int16, milli g); gyro x, y, z (int16, 0.1 degree per second); quaternion w, x, y, z (int16, 16384 = 1.0) |

Everything is in the head frame, aerospace convention: x forward, y right,
z down. Each earbud rotates its IMU's axes into that frame with a mounting
rotation fixed at manufacture, so both earbuds report the same head. At rest
the accelerometer reads (0, 0, -1000). The quaternion rotates head frame
vectors into a world frame with z down and an arbitrary yaw origin (a game
rotation vector; no magnetometer needed). Yaw is
atan2(2(wz + xy), 1 - 2(y^2 + z^2)): positive when the head has turned right,
the same sense as a STEER azimuth. The twin sends 5 samples per frame at
100 Hz (50 ms).

### 0x04 EVENT

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | code |
| 1 | 4 | value, u32 |

| Code | Event | Value |
|---|---|---|
| 0x01 | BUTTON | 1 press, 2 double press, 3 long press |
| 0x02 | WEAR | 1 in the ear, 0 out |
| 0x03 | BATTERY | percent; sent every 10 s while streaming |
| 0x04 | LEAD_OFF | bit i set when channel i (the order of HELLO's labels) has lost contact; 0 when all are back |

The timestamp is when the event happened.

### 0x05 HOST COMMAND

Written by the phone to the commands characteristic, one frame per write.
The header's side is the earbud the phone means (2: either); an earbud acts
on a command addressed to its own side or to 2 and ignores the rest, which
guards against a phone mixing up its two connections. The timestamp is the
phone's clock, for logs only.

| Op | Command | Arguments | Payload |
|---|---|---|---|
| 0x01 | START | none | 1 B |
| 0x02 | STOP | none | 1 B |
| 0x03 | SET_EEG_RATE | rate, u16, Hz | 3 B |
| 0x04 | STEER | azimuth, int16, 0.1 degree (0 ahead, positive right, -1800 to 1800); gain, int16, 0.1 dB | 5 B |
| 0x05 | HELLO | none | 1 B |

* **START** starts streaming: a HELLO with STREAM_START, then frames. While
  streaming it changes nothing.
* **STOP** stops it; the earbud sends nothing more until START, except a
  HELLO when asked.
* **SET_EEG_RATE** picks the nearest rate the earbud supports and answers
  with a HELLO giving the rate in effect. When the rate changed while
  streaming, that HELLO carries STREAM_START, since the EEG timeline
  restarts.
* **STEER** tells the earbud's own audio processing which voice to bring
  forward and by how much; gain 0 means no emphasis. The phone writes the
  same STEER to both earbuds. The earbud should take the azimuth as a
  pointer to the nearest talker it is tracking and keep following that
  talker as the head turns, so the phone does not resend on every head
  movement.
* **HELLO** asks for a HELLO now, for example after reconnecting to an earbud
  that kept streaming.

`ssp_parse_command` returns `SSP_ERR_SHORT`, `MAGIC`, `VERSION`, `LENGTH`,
`CRC`, `TYPE`, `SIDE` or `COMMAND` for each way a write can be wrong.

### 0x06 AUDIO_ENV (optional)

Speech envelopes the earbud computes from its own microphones, one per
talker it is tracking, at 64 Hz, the rate the decoder runs at.

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | sample count n |
| 1 | 1 | talker count k, 1 to 8 |
| 2 | 2k | azimuth of each talker, int16, 0.1 degree, relative to the head |
| 2 + 2k | 2nk | envelope, u16, interleaved by sample |

Envelope values are linear amplitude with any fixed scale (the decoder only
correlates them). A talker's azimuth is where the head heard it at the
frame's first sample; adding the IMU yaw at that time gives a world
direction. Sample k was taken at timestamp + k * 15625 us. The twin sends 16
samples (250 ms) per frame from the left earbud.

## Throughput

Per earbud, with frames as full as MTU 247 allows (IMU 5 samples, envelopes
16 samples per frame):

| Stream | Frame | Frames/s | Bytes/s |
|---|---|---|---|
| EEG, 4 channels at 250 Hz (design target) | 18 samples, 234 B | 13.9 | 3250 |
| EEG, 4 channels at 500 Hz | 18 samples, 234 B | 27.8 | 6500 |
| EEG, 8 channels at 250 Hz (dev kit) | 9 samples, 234 B | 27.8 | 6500 |
| IMU at 100 Hz | 5 samples, 117 B | 20 | 2340 |
| AUDIO_ENV, 3 talkers at 64 Hz | 16 samples, 120 B | 4 | 480 |
| EVENT, battery | 21 B | 0.1 | 2 |
| **Total at 250 Hz** | | **38** | **6072** |
| **Total at 500 Hz** | | **52** | **9322** |

One full notification takes 2.5 ms of air on 1M PHY (the 251 byte link layer
packet, its empty acknowledgement and two interframe spaces) and 1.4 ms on
2M PHY, a ceiling of 400 or 710 notifications per second on an otherwise idle
radio. The phone's radio is not idle: it serves both earbuds, any audio it
streams to them, and Wi-Fi. So the plan uses a conservative budget per
earbud of a 30 ms connection interval with 4 packets per connection event:
133 notifications, about 32.5 kB, per second.

| | Notifications | Bytes |
|---|---|---|
| 250 Hz design target | 38 of 133 per second (29%) | 6.1 of 32.5 kB/s (19%) |
| 500 Hz | 52 of 133 per second (39%) | 9.3 of 32.5 kB/s (29%) |

At least 2.5 times headroom in the worst case, more than 3 times at the
design target, and four times that again on 2M PHY with a 15 ms interval.

## Loss

BLE's link layer acknowledges and retransmits, so on a live connection
notifications arrive in order or not at all. Frames go missing when the
earbud's queue overflows (it still numbers the frame it drops, and sets
DEVICE_DROP on the next one it sends), when the connection drops, or when a
busy phone stack discards a notification. The phone:

1. **marks the gap.** A break in a side's seq is a gap (`SspDecoder.stats.gaps`,
   and `lost` frames). A frame with STREAM_START is never a gap.
2. **sizes it by time, not by count.** seq counts frames of every type, so it
   cannot say how many EEG samples were lost. The timestamps can: missing =
   round((t - t_prev) / period) - n_prev, with the period measured from the
   timestamps of contiguous frames rather than assumed.
3. **inserts NaN, never shifts.** The series gets that many NaN, and the
   frame's samples go after them, at their true positions. A later sample is
   never moved to close a gap, because that would misalign it with the other
   ear and with the talkers' envelopes. `EegStream` in `lib/sense/protocol.ts`
   does exactly this. A gap over 30 s restarts the series instead, and so does
   a clock that steps back (an earbud that restarted while its HELLO was
   lost); the same frame twice is dropped.

IMU and envelope streams follow the same rule at their own rates. The
decoder reads NaN as missing data. Until a HELLO has arrived for a side
(for instance after a reconnect), the phone asks for one and reads nothing.

## Time sync

The earbuds share no clock. Each one stamps frames with its own crystal,
typically within 20 to 50 ppm of nominal: two earbuds 35 ppm apart drift
2.1 ms apart every minute and 126 ms every hour, so the phone must align
them by time, never by sample count.

Per side, the phone keeps a running linear map from device microseconds
(unwrapped) to its own milliseconds (`ClockSync` in `lib/sense/protocol.ts`):

* every frame contributes one point: the device time of its last sample,
  and the phone's clock when the notification arrived;
* the slope is the rate ratio of the two crystals, fitted over a sliding
  60 s window: the earliest arrival in each eighth of the window (earliest
  relative to the slope so far) traces the lower envelope, and the slope is
  the median of the slopes between those eight points, so a stretch where
  every frame came late (a stalled phone) cannot tilt it. It is held at
  exactly 1 until the window spans 10 s and clamped to 1%, which still
  admits a dev kit clocked by its ADC's internal oscillator (0.5%);
* the offset rides the lower envelope of the arrival delays, because a
  frame is never early but often late (a connection interval, a busy radio),
  so the earliest arrivals are the truest.

Pairing: each ear's samples are placed on the phone's clock through that
ear's map, and a left sample pairs with the right sample within half a
period of it (`EarAligner`). An instant one ear has no sample for gets NaN
there; at 35 ppm and 250 Hz that slip happens about once every two minutes.
Pairing by sample count would be wrong from the start, by however far apart
the two connections opened, and would then slide.

Unwrapping: a timestamp more than half the range (35.8 minutes) behind the
last one has wrapped; a smaller step back is a frame of another type
stamped slightly earlier, which is normal (`ClockUnwrap`).

**Tolerance.** The decoder makes a decision over a window of seconds, at
64 Hz, with lags up to half a second, so left and right need to agree to
about 10 ms, less than one sample at 64 Hz. With the twin's clocks at +20 and
-15 ppm and 4 to 34 ms of arrival jitter, `ClockSync` maps both earbuds onto
the phone's clock within 1.5 ms after the first 15 s, and measures each
drift within 10 ppm (`lib/sense/twin.test.ts`). A clock 0.4% slow and a
phone that holds every frame back for two seconds both stay within 2 ms
(`lib/sense/protocol.test.ts`).

## The dev kit as an SSP device

Until the earbuds exist, an OpenBCI Cyton (8 channels, ADS1299, 250 Hz)
stands in for them over Web Serial at 115200 baud (`CytonSerialTransport`).
The phone re-encodes its 33 byte packets as SSP, so nothing downstream can
tell the difference:

* one device, side 2, with a HELLO of firmware 0.0.0, device id `CYTON`
  in ASCII, 8 channels, 250 Hz, no IMU, battery unknown, and OpenBCI's own
  scale, 4.5 V / 24 / (2^23 - 1) per count, so the board's raw counts pass
  through unchanged;
* EEG frames of 9 samples, the most 8 channels fit at MTU 247;
* the device clock counts the board's samples (4000 us each). Where the
  board's 8 bit counter skips, its radio lost packets: the next frame
  carries DEVICE_DROP after a missing sequence number, and its timestamp
  leaves the hole in place. The same counter twice is one packet delivered
  twice and is dropped. After more than a second of silence the counter may
  have wrapped, and the phone's clock says how many times. While the board
  is stopped, the phone's clock keeps the device clock running;
* START and STOP map onto the board's "b" and "s" (START while streaming
  changes nothing; each start sends a HELLO with STREAM_START), HELLO and
  SET_EEG_RATE answer with a HELLO, and STEER has nothing to steer.

## A real frame

The first left EEG frame of the golden stream, 18 samples of 4 channels,
234 bytes, as the C encoder wrote it (`build.sh` prints it):

```
0000  53 4c 00 02 00 00 01 00 40 42 0f 00 da 00 12 04
0010  80 b0 fd 51 bc 00 65 24 0b 42 dc ff ad af fd 0e
0020  bc 00 47 24 0b 07 dd ff 8f af fd 46 bb 00 fc 24
0030  0b 8e dd ff bc ae fd 8f ba 00 66 25 0b 30 de ff
0040  4a ae fd 3e ba 00 20 26 0b 69 de ff 70 ad fd 94
0050  b9 00 66 26 0b 37 df ff 17 ad fd 3c b9 00 da 26
0060  0b d0 df ff ad ac fd f5 b8 00 98 27 0b 35 e0 ff
0070  d9 ab fd d6 b9 00 27 28 0b b3 df ff 83 ab fd 2f
0080  ba 00 f4 28 0b 4d df ff bd aa fd e4 ba 00 34 29
0090  0b 89 de ff 04 aa fd 66 bb 00 0b 2a 0b 27 de ff
00a0  d8 a9 fd b7 bb 00 ac 2a 0b 98 dd ff ec a9 fd 75
00b0  bc 00 fd 2a 0b c6 dc ff 3e aa fd 13 bd 00 81 2a
00c0  0b 6c dc ff 94 aa fd 63 bd 00 b8 29 0b ca db ff
00d0  9c ab fd 4b be 00 82 29 0b 06 db ff b3 ab fd c4
00e0  be 00 c7 28 0b 61 da ff 05 da
```

| Bytes | Field | Value |
|---|---|---|
| `53 4c` | magic | "SL" |
| `00` | version | 0 |
| `02` | type | EEG |
| `00` | side | left |
| `00` | flags | none |
| `01 00` | seq | 1 |
| `40 42 0f 00` | timestamp | 1000000 us |
| `da 00` | payload length | 218 |
| `12` | samples | 18 |
| `04` | channels | 4 |
| `80 b0 fd` | sample 0, channel 0 | -151424 counts, -3.385 mV |
| `51 bc 00` | sample 0, channel 1 | 48209 counts, 1.078 mV |
| `65 24 0b` | sample 0, channel 2 | 730213 counts, 16.321 mV |
| `42 dc ff` | sample 0, channel 3 | -9150 counts, -0.205 mV |
| ... | 17 more samples | electrode offsets plus a 10 Hz wave of 20 uV |
| `05 da` | CRC | 0xDA05 |

## Versioning

* The version byte is 0. A breaking change bumps it, and a v0 decoder skips
  frames of any other version.
* A payload may grow: decoders read the fields they know and ignore the rest,
  so later firmware can append fields without breaking older phones (and
  newer phones can extend a command without breaking older earbuds).
* A new frame type gets a new code. Decoders count an unknown type (with a
  valid CRC) as unreadable and still track its seq, so it never looks like
  a gap.

## Reference implementations and the cross language check

`hardware/firmware/build.sh` compiles `ssp.c` and `golden.c` with
`cc -std=c99 -Wall -Wextra -Werror -pedantic` (and `ssp.c` also with
`-Wconversion -Wsign-conversion -Wshadow` and more), runs the generator, and
rewrites the fixtures. `SANITIZE=1` also runs it under the address and
undefined behaviour sanitizers and checks the output is identical. The
generator checks the encoder's own edges (the CRC check value, size limits,
saturation, every command parse error) and writes nothing if one fails.

The golden stream holds HELLO from both earbuds and a dev kit, EEG frames
with the int24 extremes, a right earbud clock that wraps, an IMU, two EVENT
and an AUDIO_ENV frame, an 8 channel frame at its maximum size, six host
commands, and one EEG frame with a deliberately corrupted CRC, which costs
the right earbud one sequence number. `lib/sense/protocol.test.ts` decodes
the bytes with the TypeScript decoder (whole, byte by byte and in random
chunks) and compares every frame and the decoder's counts with the JSON,
then re-encodes every value with the TypeScript encoder and requires the
same bytes. The firmware and the phone are checked against each other, not
each against itself.

```sh
hardware/firmware/build.sh   # C: compile, self check, regenerate the fixtures
npm test                     # TypeScript: the cross language check and the rest
```
