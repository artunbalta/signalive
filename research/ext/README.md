# The earbud's software on other people's public recordings

`research/aad` asks one public dataset what electrodes around the ear can tell
about attention. This folder runs the phone's own code, unchanged, on other
public recordings, to answer questions `research/NEXT.md` had left to hardware:
whether a real clench is caught and what else sets the detector off, and
whether the earbud's contacts can sit in the ear or must sit around it.

Every result here comes from code in this folder and `lib/sense`. The
recordings stay their authors'; only derived numbers are kept (`data/` is not
committed).

## Run it

```sh
# Clenches around the ear (Park, Kim, Choi, Hwang; CC BY 4.0)
F=https://ndownloader.figshare.com/files D=research/ext/data/park
curl -L -o $D/Clench.mat $F/41253999 && curl -L -o $D/Blink.mat $F/70871604
curl -L -o $D/EyeMovement.mat $F/41254005 && curl -L -o $D/AlphaModulation.mat $F/41253990
curl -L -o $D/ECG.mat $F/41254002
python3 research/ext/clench_export.py
npx vitest run --config research/ext/vitest.config.mts research/ext/clench_real.test.ts

# A consumer headband (Lee and Ahn; CC BY 4.0)
curl -L -o research/ext/data/muse/sourcedata.zip https://ndownloader.figshare.com/files/58088461
(cd research/ext/data/muse && unzip -q sourcedata.zip "sourcedata/*Muse2*")
python3 research/ext/muse_export.py
npx vitest run --config research/ext/vitest.config.mts research/ext/clench_muse.test.ts

# Labelled movements (PhysioMotion, OpenNeuro ds006386; CC0): participants 1 to 12
python3 research/ext/physiomotion_export.py
npx vitest run --config research/ext/vitest.config.mts research/ext/clench_physiomotion.test.ts

# 18 hours of quiet listening (ds004015; CC0), after research/aad/preprocess_all.py
python3 research/ext/clench_listening_export.py
npx vitest run --config research/ext/vitest.config.mts research/ext/clench_listening.test.ts

# In the ear, around it and on the scalp (Ear-SAAD; its BIDS files say CC BY-NC-SA 4.0)
curl -L -o research/ext/data/earsaad/bids_dataset.zip "https://zenodo.org/api/records/16536441/files/bids_dataset.zip/content"
(cd research/ext/data/earsaad && unzip -q bids_dataset.zip)
python3 research/ext/earsaad_prep.py
python3 research/ext/earsaad_decode.py
```

`edf.py` reads EDF and EDF+ files with NumPy alone.

## A clench in real life

The detector (`lib/sense/clench.ts`) as the phone runs it: per ear, the 30 to
120 Hz power of that ear's electrodes against an adaptive floor; a burst needs
both ears above k = 4 times their floor; single, double (two short bursts close
together) or hold (over 0.7 s); chewing withdraws what it reported. Each ear is
referenced to its own average, as an earbud with its reference in the same ear
would see it.

| Recording | Who | Cued clenches caught | False reports |
|---|---|---|---|
| Around the ear, 18 electrodes, 250 Hz | 15 people, 10 cued 3 s clenches each | 70% (10 people at 9 or 10 of 10, 5 at 3 or fewer) | 0 in 15 min of blinking and 59 min of eye movements; 3 in 89 min of rest and heartbeat |
| Consumer headband, one electrode behind each ear, 256 Hz | 26 people, 20 cued clenches each | 52% (10 people at 90% or more, many at none) | 0 in rest; 6 an hour while blinking, 15 an hour moving the head |
| Temporal scalp, 4 channels per side, 1000 Hz | 12 people, cued molar clenching | 99% of clench blocks | see the next table |
| Around the ear, 4 per ear, 500 Hz, people sitting and listening | 36 people, 18 hours, no clench asked for | | 5.7 an hour: singles 3.6, holds 2.0, doubles 0.11; the median person 2 an hour, the worst 37 |

The people it missed are the ones whose clench is weak at these electrodes: on
the weaker ear the muscle signal of the missed reached only 2.4 to 3.9 times the
background, under the threshold of 4. A lower threshold catches them and costs
false reports (around the ear, 250 Hz):

| k | Clenches caught | False reports an hour (blinks, eye movements, rest, heartbeat) |
|---|---|---|
| 2.1 | 97% | 21 |
| 2.5 | 94% | 7.0 |
| 3 | 89% | 3.3 |
| 3.5 | 80% | 1.8 |
| 4 (shipped) | 70% | 1.1 |

A threshold set for each person from three clenches did not reliably beat a
fixed one: chosen on half the people it caught every later clench at 1.4 false
an hour, and on the other half 84% at 7.1.

What sets it off, by labelled movement (temporal scalp, 1000 Hz; a report
during the movement or up to 0.7 s after):

| Movement | Events | Share that produced a report | Of them doubles |
|---|---|---|---|
| Swallowing | 104 | 51% | 0 |
| Raising the eyebrows | 133 | 35% | 0 |
| Head nods | 292 | 3.8% | 0 |
| Blinking | 108 | 1.9% | 0 |
| Tongue moving as in speech | 452 | 1.3% | 2 |
| Head turns | 428 | 0.7% | 0 |
| Eye movements | 349 | 0% | 0 |

False doubles against every other false report:

| Recording | Hours | Doubles an hour | Singles and holds an hour |
|---|---|---|---|
| Quiet listening, around the ear, 500 Hz | 18.2 | 0.11 | 5.6 |
| Rest, blinks, eye movements, heartbeat, around the ear, 250 Hz | 2.7 | 0 | 1.1 |
| Blinks and head movements, headband, 256 Hz | 3.9 | 0.26 | 12 |
| PhysioMotion's unannotated stretches, temporal scalp, 1000 Hz | 16.2 | 1.3 | 53 |

The last row is the time between the labelled movements, whose activity
nobody annotated (instructions, talk with the experimenter), so it is no
background rate; it is still where doubles were rarest relative to the rest.

**What it decides.** In every recording a false double was 20 to 50 times
rarer than a false single or hold, and in quiet listening and rest it stayed
far under one an hour. The command that must not fire by accident (keeping a
moment) belongs on the double clench, and the single on something harmless
to trigger. Swallowing is the movement to reject, and the microphone that
already faces the ear canal in a noise cancelling earbud can hear it
(`hardware/SPEC.md`, HW-MIC-03). Detection itself splits people: for a third
of them the clench at these sites is too weak for the shipped threshold,
which experiment 1 of `research/NEXT.md` must measure on the earbud's own
contacts.

## In the ear, or around it

Pending: `earsaad_decode.py` (in-ear, around-ear, both, scalp; linear and
learned; calibration free).
