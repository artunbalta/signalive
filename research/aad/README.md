# Attention decoding on public ear EEG

The questions the earbuds depend on, asked of real recordings before a single
earbud exists: can electrodes around the ear tell which of two voices a person
follows, can two separate earbuds do it with no wire between them, how many
electrodes it takes, whether each person has to calibrate it, and how fast it
can follow a switch.

Everything on [/research](../../app/research/page.tsx) comes from here.

## Run it

Python 3.9 or later with NumPy and SciPy. About 400 MB of disk while it runs,
two minutes of compute on a laptop.

```sh
python3 research/aad/preprocess.py   # fetch and filter all 36 people (about 7 GB streamed, one at a time)
python3 research/aad/analyze.py      # every configuration, held out, about 2 minutes on 6 cores
python3 research/aad/export.py       # the page's numbers, three demo recordings, the TypeScript fixture
python3 research/aad/fixtures.py     # reference numbers for lib/sense's unit tests
```

`data/` (raw downloads and the 64 Hz intermediate files) is not committed.
`results.json` is: it is the full output of `analyze.py`, per person and per
configuration. `python3 research/aad/analyze.py --mesd-only` recomputes the
switch durations from it without rerunning the decoders.

## Data

[Attended speaker paradigm (cEEGrid data)](https://doi.org/10.18112/openneuro.ds004015.v1.0.2),
OpenNeuro ds004015, released under CC0 by Holtze, Rosenkranz, Jaeger, Debener
and Mirkovic ([Frontiers in Neuroscience, 2022](https://doi.org/10.3389/fnins.2022.869426)).

- 36 people wearing cEEGrids: flexible arcs of electrodes around both ears,
  18 channels, 500 Hz, referenced to an electrode behind the right ear.
- Two audiobooks at once, one from the left and one from the right; each
  person was told to follow one side for the whole session.
- Three 10 minute blocks per person in which both stories were equally loud
  (the data set's own "selected blocks"). Story 1 is the left audio channel.
- The data set ships each story's speech envelope at 64 Hz, not the audio.

## Pipeline

[`pipeline.py`](pipeline.py) defines the chain once; `lib/sense` ports it to
TypeScript and its tests check it against numbers this code produces (to
about 1e-11, including six seconds of a real recording end to end).

1. Causal Butterworth band pass, 1 to 9 Hz, order 2, at 500 Hz.
2. Resampling to 64 Hz by linear interpolation.
3. A montage: `wired` keeps the recording's reference for every electrode;
   `wireless` references each ear to its own average, as two independent
   earbuds would have to.
4. Per channel scaling to unit variance.
5. A linear backward model: the attended story's envelope at time t is
   rebuilt from every channel at t to t + 484 ms (32 lags), ridge regression
   with the strength chosen by inner cross validation.
6. A window's verdict is the story whose envelope correlates best with the
   rebuilt one.

Nothing looks at a sample from the future of the moment it outputs, except
the lags in step 5, which is why a decision needs half a second of EEG after
its window.

## Testing

- **Personal decoders**: trained on two of a person's blocks (20 minutes),
  tested on the third, three times.
- **Generic decoders**: trained on the other 35 people, tested on the held
  out person. That person's channel scale comes from their first two minutes,
  without labels, as an earbud would estimate it from the first minutes of
  wear.
- **Calibration**: personal decoders from 1 to 20 minutes of the person's own
  data, and the generic decoder adapted with those minutes.
- **Electrode ranking**: greedy, per ear, judged by how well a generic decoder
  rebuilds the attended story for people it never saw. It is chosen on the
  whole group, which can flatter the per ear counts slightly.
- **Switch time**: the minimal expected switch duration (MESD) of
  [Geirnaert, Francart and Bertrand](https://www.eurasip.org/Proceedings/Eusipco/eusipco2019/Proceedings/papers/1570533767.pdf):
  a gain control chain that steps toward each decoded story, with the
  attended story held in the top 35% of the gain range 80% of the time and at
  least five steps; accuracy interpolated linearly between window lengths.

## Results

Share of decisions that name the followed story, mean over 36 people, generic
decoders (no calibration). A coin flip scores 50%; for one person, 30 minutes
of one minute decisions must reach 66.7% to differ from chance.

| Configuration | 2 s | 10 s | 60 s | MESD (median) |
|---|---|---|---|---|
| 4 per ear, wireless | 54.2% | 58.0% | 68.1% | 120 s |
| 4 per ear, wired | 54.2% | 57.8% | 69.6% | 126 s |
| All 18, wired | 54.2% | 58.9% | 70.9% | 111 s |
| All 18, wireless | 54.5% | 58.7% | 71.3% | 118 s |
| 2 per ear, wireless | 53.8% | 57.6% | 68.0% | 141 s |
| One earbud (right), 4 | 53.5% | 56.5% | 66.1% | 174 s |
| One earbud (left), 4 | 52.5% | 55.6% | 59.3% | 284 s |

Personal decoders trained on 20 minutes land within about a point of these
(4 per ear, wireless: 69.3% at 60 s). Trained on fewer minutes they do worse
than the generic decoder: 53.5% with 1 minute, 61.4% with 5, 66.2% with 10.

25 of 36 people clear the one person bar at 60 s with 4 per ear, wireless and
no calibration; 4 sit at or below 50%.

Electrodes, best first: left `L01 L04b L06 L04`, right `R02 R05 R08 R04`.

## What it decides

- **True wireless works.** Referencing each ear to itself costs about a point
  and a half against a wired montage. No neckband.
- **Four electrodes per ear** leave margin: two per ear already reach 68%.
- **No calibration step** is needed to start.
- **EEG is the slow channel.** About two minutes to follow a switch, and two
  second decisions barely beat a coin flip. Head orientation has to steer,
  the clench is the explicit command, and the EEG says over minutes who a
  person keeps coming back to.

## Limits

cEEGrids around the ear are not earbuds in the ear. Attention was instructed
and held for whole blocks, never switched, in a quiet room with people sitting
still. These are published research recordings, not Signalive product
measurements, and nothing here supports any claim about hearing.
