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
python3 research/aad/calibrate.py    # what one ten second decision of the linear decoder is worth
for s in 7 11 23; do AAD_SEED=$s AAD_ENSEMBLE=3 python3 research/aad/deep.py; done   # the learned decoder, 3 splits, about 12 minutes each
python3 research/aad/belief.py       # single decisions into a running belief, both decoders
python3 research/aad/deep_export.py  # the learned model for the phone, its fixture, the page's numbers
```

The learned decoder needs PyTorch (2.5 here, on Apple silicon's GPU; a CPU works,
slower).

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

| Configuration | 2 s | 10 s | 60 s | 5 min | MESD (median) |
|---|---|---|---|---|---|
| 4 per ear, wireless | 54.2% | 58.0% | 68.1% | 85.2% | 120 s |
| 4 per ear, wired | 54.2% | 57.8% | 69.6% | 80.6% | 126 s |
| All 18, wired | 54.2% | 58.9% | 70.9% | 85.2% | 111 s |
| All 18, wireless | 54.5% | 58.7% | 71.3% | 85.6% | 118 s |
| 2 per ear, wireless | 53.8% | 57.6% | 68.0% | 84.3% | 141 s |
| One earbud (right), 4 | 53.5% | 56.5% | 66.1% | 79.2% | 174 s |
| One earbud (left), 4 | 52.5% | 55.6% | 59.3% | 74.1% | 284 s |

Five minute windows leave each person only six decisions, so they say
little about any one person, but over 36 people they show where evidence
gathered across a conversation lands: 85% with four electrodes per ear on
two separate earbuds, 89% over ten minutes.

With the learned decoder below, the same windows read 55.6%, 62.2%, 76.6%,
89.4% and 94.4% over ten minutes.

Personal decoders trained on 20 minutes land within about a point of these
(4 per ear, wireless: 69.3% at 60 s). Trained on fewer minutes they do worse
than the generic decoder: 53.5% with 1 minute, 61.4% with 5, 66.2% with 10.

25 of 36 people clear the one person bar at 60 s with 4 per ear, wireless and
no calibration; 4 sit at or below 50%.

Electrodes, best first: left `L01 L04b L06 L04`, right `R02 R05 R08 R04`.

## Decoder v2: learned

The linear decoder rebuilds the followed story's envelope through one fixed
filter. [`deep.py`](deep.py) learns both sides instead: two small networks of
one dimensional convolutions (a 1 by 1 mix to 24 channels, three layers of
kernel 9 dilated 1, 2 and 4 with GELU, a 1 by 1 mix to a 12 dimensional
embedding; about 16,000 weights each), one over the eight electrode channels
of the wireless montage and one over each story's envelope, which also sees
half a second of that story before each EEG sample. Training takes 5 second
crops and asks, by cross entropy over the two stories, that the followed
story's embedding move with the EEG's: the mean over time of their per
sample product, each centred and scaled by its mean norm. A window of any
length is judged by the same score over that window alone.

- **Held out by person.** Six folds; each fold's models are trained on 25
  people and stopped on 5 more, never on the 6 they are tested on. Three
  networks per fold from different starting points; a window's scores are
  their average. Three different random splits of the 36 people; each
  person's accuracy is averaged over the three models that never saw them.
- **Causal like an earbud.** The EEG is scaled by each person's first two
  minutes, unlabelled, as the linear generic decoder is; each envelope by its
  own running spread (30 s); no layer reaches more than 0.44 s ahead.
- **Set once.** The settings above were chosen before these runs and not
  tuned on the test folds. Ensembles of three were added after single
  networks were seen to vary between splits (72.2% to 75.1% at 60 s).
- **The check.** The same models, given both stories rotated 97 s out of
  step with the EEG: the same voices, so a network that had learned to tell
  them apart and read something else from the EEG (where the eyes were
  turned, say) would keep scoring. It falls to chance.

| 4 per ear, wireless, no calibration | 2 s | 10 s | 60 s | 5 min | 10 min | MESD (median) | People past the bar at 60 s |
|---|---|---|---|---|---|---|---|
| Linear | 54.2% | 58.0% | 68.1% | 85.2% | 88.9% | 120 s | 25 of 36 |
| Learned | 55.6% | 62.2% | 76.6% | 89.4% | 94.4% | 78 s | 30 of 36 |
| Learned, stories out of step | 49.9% | 49.8% | 49.1% | 47.4% | 45.7% | | |

One minute decisions per split: 77.4%, 76.3%, 76.2%. The out of step control
stays within noise of 50% (at 5 and 10 minutes each person has only six and
three windows). The page draws the whole curve.

Tried on the way and dropped, in [`improve.py`](improve.py) and
[`improved.json`](improved.json): canonical correlation with a linear
discriminant (de Cheveigné et al. 2018; 69.3% at 60 s, MESD 108 s), the same
with the envelope's onsets as a second feature (70.0%, 100 s), and
unsupervised adaptation to each person from their own decisions (65.1%,
worse: thirty second self labels are too noisy to learn from).

`deep_export.py` trains the shipped model on 31 people (five more to stop on),
three networks, and writes it to `public/research/neural.json` with every
weight as float32. `lib/sense/neural.ts` runs it on the phone, streaming, and
its tests match this code's own streaming reference to 1e-9 on eight seconds
of a real recording.

## Decoder v3: every block, chosen on validation

Version 2 trained on the three blocks per person the data set selects.
[`deep3.py`](deep3.py) trains on all five (the two extra blocks only ever
train, never test) and chose its settings by a rule fixed before any run:
the lowest mean validation log loss of ten second decisions, on the five
validation people of each fold only, ties within 0.002 going to the simpler
variant ([`search.py`](search.py), [`variants/`](variants/)). Of thirteen
variants (wider or longer receptive fields, larger embeddings, contrastive
loss, augmentation, crop length, alignment, dropout, epochs, learning rate)
the version 2 architecture with a learning rate of 1e-3 on all blocks won
(0.6356; a longer receptive field 0.6357, inside the tie margin). The final
models are that variant, five networks per fold, on the same three random
splits.

| 4 per ear, wireless, no calibration | 2 s | 10 s | 60 s | 5 min | 10 min | MESD (median) | People past the bar at 60 s |
|---|---|---|---|---|---|---|---|
| Learned v3 | 56.6% | 64.1% | 78.9% | 91.0% | 96.9% | 57 s | 30 of 36 |
| Learned v3, stories out of step | 49.9% | 50.3% | 49.0% | 48.0% | 49.7% | | |

One minute decisions per split: 79.2% (split 7), 79.4% (11), 78.1% (23).

**No onset in the numbers.** On Ear-SAAD a window that began at a trial's
first sample heard the sound start and scored 100% at five minutes. Here the
filters run 20 s ahead of every block, but the stories still start at its
first sample, so [`onset_check.py`](onset_check.py) scores every test block
again with its first seconds dropped from the EEG and both stories alike
(split 7, five networks): one minute decisions 79.2%, 78.4% and 78.8% with 0,
10 and 30 s dropped, five minute ones 91.2%, 90.7% and 91.7%.

**Held out by story and by study.** Every person in this data set heard the
same stories, so a network tested on new people alone could learn the
stories. With one network per fold and the search's settings, every test
block was also scored by networks trained without any block of the same
part of the stories, from anyone (`"holdout": "part"`), and by networks
trained on one source study and tested on the other (`"holdout": "study"`):

| One network per fold, split 7 | 10 s | 60 s | 5 min | Out of step, 60 s |
|---|---|---|---|---|
| Stories shared | 61.7% | 75.6% | 91.2% | 48.4% |
| Story content held out | 61.4% | 75.9% | 87.5% | 48.3% |
| Source study held out | 60.0% | 72.1% | 86.1% | 47.6% |

The network does not learn the stories. Set against the published around
the ear results, all trained on the person tested
([../LITERATURE.md](../LITERATURE.md)), a calibration free decoder over four
electrodes per ear, each ear referenced to itself, is at least as accurate.

## What a decision is worth

On the phone a ten second decision moves the estimate of who is being
listened to by exp(weight times margin), the margin being how far the winning
story's score beat the other's. The weight was set by hand at 10.
[`calibrate.py`](calibrate.py) fits it by maximum likelihood on the ten
second decisions of decoders that never saw the person:

| Decoder | Fitted weight | Right | Log loss, fitted | Log loss at 10 |
|---|---|---|---|---|
| Linear | 2.97 | 58.0% | 0.673 | 0.758 |
| Learned | 15.9 | 62.2% | 0.649 | 0.655 |
| Learned v3 | 17.0 | 64.1% | 0.634 | 0.644 |

At 10 the linear decoder's decisions were trusted about three times too
much: where the fusion was 91% sure, they were right 67% of the time, and the
log loss was worse than a coin flip's (0.693). The learned decoder's scores
run on a smaller scale, so its weight is larger. Each model now carries its
own (`eegWeight`), and `DEFAULT_EEG_WEIGHT` is the linear one's.

## From decisions to a belief

So the phone acts on no single decision. [`belief.py`](belief.py) measures
what `AttentionBelief` in `lib/sense/fusion.ts` does: a hidden Markov model
over the two stories, filtered forward one ten second decision at a time,
each decision weighed as above, with a chance h per decision that attention
moved since the last. Steadiness counts from each block's second minute;
switches are simulated halfway through each block (the decisions after it
count for the other story) and timed until the belief first favours the new
one, missed when that takes over five minutes.

| h | Linear: names the story | to come over | missed | Learned: names the story | to come over | missed |
|---|---|---|---|---|---|---|
| 1% | 82.5% | 95 s | 7% | 87.4% | 80 s | 2% |
| **2%** | **80.3%** | **70 s** | **5%** | **85.9%** | **60 s** | **1%** |

With decoder v3 (weight 17.0) the belief at 2% names the followed story 87.1%
of the time and comes over to a new one in 50 s, missing 1%.
| 5% | 75.6% | 30 s | 0% | 82.0% | 40 s | 0% |

Single decisions are right 58.0% (linear) and 62.2% (learned) of the time.
The phone uses 2% (`DEFAULT_HAZARD`).

## What holding the voice is worth

The belief settles on the followed story, but the product also has the
head. [`hold_value.py`](hold_value.py) replays every held out person's real
ten second decisions (the final models') under a simulated head that looks
away: each ten second step it faces the followed talker, nobody (a plate, a
phone) or the other talker, by a Markov chain with set shares and looks of
about 20 s, the talkers at -60 and +60 degrees as in the recordings. It
counts the steps from the second minute on in which each way of choosing
brings the followed voice forward; times how long each takes to bring a new
voice forward when attention and head turn together (decisions flipped at a
random moment, as in `belief.py`); and, when attention moves and the head
does not, how much of the last two minutes the new voice is forward. The
decisions are real; the head is an assumption, swept in `hold_value.json`.
A quarter of the time looking away:

| How the voice is chosen | Half at the other talker | All at the other talker | All at nobody | Attention moves, head stays | To follow a real turn |
|---|---|---|---|---|---|
| The voice faced | 75.5% | 74.9% | 76.4% | 13.5% | 0 s |
| Faced, the last one held while facing nobody | 84.2% | 75.1% | 95.6% | 16.0% | 0 s |
| Faced for 20 s before it changes | 86.8% | 76.6% | 99.5% | 13.5% | 10 s |
| The belief alone | 87.1% | 87.1% | 87.1% | 87.7% | 50 s |
| Head and belief, as shipped (kappa 2) | 88.6% | 81.7% | 95.7% | 43.1% | 0 s |
| Head and belief, head weighed half (kappa 1) | 91.6% | 89.2% | 94.3% | 72.0% | 10 s |
| Head and belief, head weight growing over 40 s | 92.0% | 87.5% | 95.8% | 50.7% | 20 s |

- **Looking away at nothing**, the head alone does it: hold the last voice
  faced, or wait 20 s before changing, and nothing beats it.
- **Looking at someone else while following** is where the EEG earns its
  place, and **attention that moves while the head stays** is where only the
  EEG can: every head rule stays at or under a quarter.
- **The shipped fusion trusts the head too much.** Its weight (kappa 2) was
  set by hand while the EEG's was fitted; at half that weight a glance no
  longer outweighs a minute of evidence, a real turn still comes through in
  about ten seconds, and most covert moves are followed.
  `SessionOptions.headKappa` sets it (default unchanged: without EEG the
  lower weight also softens how far the faced voice comes forward), and
  `headDwellS` makes the weight grow with time on one talker.

## How accuracy grows with the people trained on

[`scaling.py`](scaling.py) trains the generic linear decoder on N people
drawn from the other 35 (eight draws each) and tests it on the held out
person; the learned decoder's points are single networks per fold trained
on N of each fold's training people (`variants/scale.jsonl`, `ntrain`).
One minute decisions, 4 per ear, wireless:

| People trained on | 2 | 5 | 10 | 15 | 20 | 25 | 30 | 35 |
|---|---|---|---|---|---|---|---|---|
| Linear | 61.1% | 64.8% | 66.9% | 67.6% | 68.2% | 67.9% | 68.1% | 68.1% |
| Learned, one network |  | 68.6% | 70.9% | 75.1% | 75.9% | 76.8% |  |  |

The linear decoder, about 260 weights, has learned all it can from about
fifteen people. The learned one, about 33,000, was still climbing when the
folds ran out of people to train it on, at five minutes as at one (81.0%,
84.3%, 87.0%, 88.9% and 91.2% from 5 to 25 people): more listeners are worth
more than a larger network.

## What the electronics may add

[`hardware_bars.py`](hardware_bars.py) takes the raw 500 Hz recordings of
every held out person, does to them what a cheaper or harsher earbud would,
and runs the whole causal chain and the final decoder that never saw them
(split 7, the first two networks of each fold: every curve is compared with
the same model on the clean recording). Where one minute decisions start to
fall is the bar each part has to clear; [`hardware.json`](hardware.json) has
every level.

Model final.seed7, 2 networks per fold; clean one minute accuracy 78.1%.

| What is degraded | Within a point of clean | Three points lost at | Worst tried |
|---|---|---|---|
| White noise at every electrode | 100 nV/√Hz | 1600 nV/√Hz | 60.2% at 3200 nV/√Hz |
| 1/f noise in the decoder's band | 0.5 µVrms | 2 µVrms | 57.2% at 16 µVrms |
| One converter step | 10 µV | 20 µV | 72.6% at 20 µV |
| Sampling rate | down to 100 Hz | not within the range tried | 78.1% at 500 Hz |
| Clock offset between the earbuds | 20 ms | 80 ms | 64.3% at 160 ms |
| Frames lost one at a time | 10% of frames | 40% of frames | 73.8% at 40% of frames |
| Frames lost in 200 ms bursts | under 1% of frames | 20% of frames | 73.4% at 20% of frames |
| 50 Hz mains, 1% imbalance | 10000 µV | 50000 µV | 72.9% at 50000 µV |
| Speech envelopes late or early | under ±25 ms | ±50 ms | 55.7% at ±200 ms |
| The other voice in each envelope | 70% mixed in | not within the range tried | 77.2% at 70% mixed in |

| 200 µV jolts a minute | 0 | 2 | 5 | 10 |
|---|---|---|---|---|
| Ungated | 78.1% | 72.7% | 69.1% | 63.5% |
| Gated, a quarter second either side | 78.7% | 77.8% | 74.4% | 70.1% |
| Gated as the phone does it, half a second from the jolt on | 79.8% | 77.2% | 75.1% | 71.5% |

- **The amplifier is not the limit.** Noise, resolution and sampling rate
  all have wide margins over an ADS1299 class part; 1/f noise inside the
  decoder's band is the one to watch (half a microvolt). Attention would be
  fine sampled at 100 Hz; the clench is what needs 250 to 500.
- **Neither is the radio.** Two earbuds' clocks may disagree by 20 ms and a
  tenth of all frames may go missing one at a time before a point is lost.
- **Timing between microphones and electrodes is.** The speech envelopes
  must sit on the EEG's clock to within about 10 ms: 25 ms late already
  costs two points. Separation, on the other hand, can be rough: each
  envelope may carry 70% of the other voice.
- **Movement is the real cost, and a gate is the answer.** Two jolts a
  minute cost five points; a gate that blanks every channel around any
  sample over five times its channel's spread wins most of them back. The
  phone's chain now runs it (`ArtifactGate` in `lib/sense/dsp.ts`, on by
  default) in the form that needs no delay: half a second from the crossing
  on. Its two settings were fixed before it was tried. On the clean
  recordings, scored with all five networks of all three splits
  ([`gate_check.py`](gate_check.py), [`gate.json`](gate.json)), it blanked
  6% of the samples and changed one minute accuracy from 78.9% to 79.2% and
  five minute from 91.0% to 92.1%: it costs nothing at rest.

## What it decides

- **True wireless works.** Referencing each ear to itself costs about a point
  and a half against a wired montage. No neckband.
- **Four electrodes per ear** leave margin: two per ear already reach 68%.
- **No calibration step** is needed to start.
- **EEG is the slow channel.** Two second decisions barely beat a coin flip.
  With the learned decoder (v3) one minute decisions are right 79% of the
  time, five minute ones 91%, and the running belief settles on the followed
  story 87% of the time while following a switch in under a minute. Head
  orientation has to steer, the clench is the explicit command, and the EEG
  says over a minute or two who a person keeps coming back to.

## Limits

cEEGrids around the ear are not earbuds in the ear. Attention was instructed
and held for whole blocks, never switched, in a quiet room with people sitting
still; the belief's switch times come from simulated switches that assume the
decoder is as good after a real one. These are published research recordings, not Signalive product
measurements, and nothing here supports any claim about hearing.
