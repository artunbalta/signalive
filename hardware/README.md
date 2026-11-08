# What remains is hardware

The phone side of Signalive is written and tested: the wire protocol, the signal chain, the
attention decoder, the gesture detector, the steering policy and a digital twin that plays
real recordings through the exact frames the earbuds will send. What is left is a pair of
earbuds that produce those frames. This folder is the handoff for the engineer who builds
them.

## What the software already does, and where

| Piece | Where | What it does |
|---|---|---|
| Wire protocol (SSP) | [PROTOCOL.md](PROTOCOL.md), [firmware/ssp.c](firmware/ssp.c), [lib/sense/protocol.ts](../lib/sense/protocol.ts) | Frames, CRC, sequence gaps, clock unwrapping, aligning two earbud clocks on the phone, NaN for lost samples. A C reference encoder for the firmware, checked byte for byte against the TypeScript decoder |
| Filtering and resampling | [lib/sense/dsp.ts](../lib/sense/dsp.ts) | Butterworth band pass designed exactly as SciPy does it, streaming second order sections, resampling to 64 Hz |
| Attention decoder | [lib/sense/decoder.ts](../lib/sense/decoder.ts) | Montage, scaling and a linear backward model that rebuilds the attended speech envelope; picks the best matching talker per window |
| Gain control | [lib/sense/gain.ts](../lib/sense/gain.ts) | Markov chain gain control: each decision moves one step, so no single decision is trusted |
| Head orientation fusion | [lib/sense/fusion.ts](../lib/sense/fusion.ts) | Combines where the head points with the decoder's evidence into a probability per talker |
| Clench detector | [lib/sense/clench.ts](../lib/sense/clench.ts) | 30 to 120 Hz muscle power on both ears; single, double and hold; chewing suppression |
| Digital twin | [lib/sense/twin.ts](../lib/sense/twin.ts) | Two simulated earbuds with drifting clocks, lost frames, clenches and head turns |
| Transports | [lib/sense/transport.ts](../lib/sense/transport.ts) | The twin, real earbuds over Web Bluetooth, and the OpenBCI Cyton dev kit over Web Serial (`CytonSerialTransport`) |
| Phone session | [lib/sense/session.ts](../lib/sense/session.ts) | All of the above in one class: bytes in from any transport, the two ears paired by time on the phone's clock, clenches, head direction, an attention posterior, and the STEER command back to the earbuds |
| Validation on public ear EEG | [research/aad/](../research/aad/) | 36 people with electrodes around the ear, two competing audiobooks: accuracy against window length, wired against true wireless referencing, electrodes per ear, calibration ([results](../research/aad/README.md)) |

Run the checks with `npm test` (TypeScript, including the cross language protocol check) and
`hardware/firmware/build.sh` (C).

## What the hardware must provide

Full requirements with reasons and tests in [SPEC.md](SPEC.md). In one breath, per earbud:

- 6 dry contacts in one ear: 4 sensing, a reference and a bias electrode (SPEC section 1).
- A 4 channel biopotential front end: ≤ 1 µVrms noise, 500 Hz preferred and 250 Hz minimum,
  ≥ 1 GΩ inputs, tolerant of large DC offsets (section 2).
- Its own electrical reference in its own ear, because true wireless earbuds share none; the
  measured cost of that is the table in section 3, and it decides the product form.
- A 6 axis IMU at ≥ 100 Hz and at least 2 outward microphones; the steered voice processed
  inside the earbud within 5 to 10 ms (sections 4 and 5).
- Thin firmware that samples, timestamps and sends SSP frames over Bluetooth LE: 9.3 kB/s at
  500 Hz (sections 6 and 7).
- At least 4 h, target 5 h, per charge with everything on (section 8), and the mechanical,
  regulatory and privacy requirements of sections 9 to 11. It is a consumer audio product
  and must not carry medical claims.

How the pieces connect, the latency budget and the failure modes are in
[ARCHITECTURE.md](ARCHITECTURE.md); reference parts, prices and the dev kit in
[BOM.md](BOM.md).

## Open questions only hardware can answer

1. **Dry contact signal quality on the arc.** The validation data are wet electrodes around
   the ear. Dry contacts in the canal decoded attention at chance without calibration, so the
   earbud carries its contacts on a slim arc that rests behind the ear, where the wet ones
   sat (SPEC HW-EEG-02, HW-MECH-07). How much of the signal survives dry contacts there is
   the first number to measure.
2. **Contact stability while moving.** Talking, chewing and walking move the ear canal and
   the contacts. Does contact hold, and how much artifact reaches the decoder's band?
3. **Per person calibration.** On the public data a generic decoder needs no calibration; a
   different geometry, tip size and ear may change that.
4. Two more that only a prototype shows: whether two electrically separate earbuds pick up
   more interference than the software montage predicts (SPEC T-08), and whether the
   earbud's own speaker leaks into its EEG channels (T-06).

## The path

1. **Dev kit, today.** OpenBCI Cyton (8 channels, ADS1299, 250 Hz) with cEEGrid electrodes
   around the ear, streaming into lib/sense through `CytonSerialTransport` (wiring in
   [BOM.md](BOM.md)). Gate: our own recordings reproduce the wired against wireless result
   and the clench detector works on people, not just on the twin.
2. **Wired prototype.** The bud and its arc, with dry contacts, wired to AFE evaluation boards and an nRF5340
   Audio DK, in two configurations, shared reference and split grounds (SPEC HW-REF-02).
   Gate: contact impedance (HW-EEG-04), decoding on the same people within reach of the
   cEEGrid result (T-07), the section 3 rule says true wireless (T-08), no audio in the EEG
   (T-06), clench detection above 95% with under 1 false positive per hour (T-13).
3. **True wireless earbuds.** Rigid flex boards in the bud and a flex circuit in the arc, most likely with an ODM.
   Gate, from the client brief: at least 90% of the wired prototype's metrics, more than 4 h
   per charge, fits 10 different ears without custom moulds, and the latency budget of
   [ARCHITECTURE.md](ARCHITECTURE.md).

The first experiments for the dev kit, sized and with their pass bars, are in
[research/NEXT.md](../research/NEXT.md).

## Files

| File | Contents |
|---|---|
| [README.md](README.md) | This page |
| [SPEC.md](SPEC.md) | Hardware Requirements Specification v0 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Data flow, latency budget, what runs where, failure modes |
| [BOM.md](BOM.md) | Reference parts, prices, the dev kit |
| [PROTOCOL.md](PROTOCOL.md) | SSP v0, the earbud to phone protocol |
| [firmware/](firmware/) | The SSP reference encoder in C and its golden stream generator |
