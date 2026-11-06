# The experiments only hardware can answer

`research/aad` answered what public recordings can: attention is decodable
from electrodes around the ear, two separate earbuds lose almost nothing
against a wired pair, four electrodes per ear are enough, and no calibration
is needed. A learned decoder (`deep.py`) does markedly better than the linear
one on the same people, the fusion now weighs each decision by what it
earned on people it never saw (`calibrate.py`), and a running belief turns
weak ten second decisions into a steady answer that still follows a switch
within about a minute (`belief.py`). Four questions remain that no public
data set answers. Each one below is sized
for a dev kit (an OpenBCI Cyton board, around the ear electrodes placed where
the ranking in `research/aad/README.md` says) and runs through code that
already exists: the board streams into `lib/sense` through
`CytonSerialTransport`, and the web trial records what the person hears.

Order matters: 1 decides whether the gesture channel ships, 2 and 3 decide
how much the attention channel is worth, 4 decides the ear tip.

## 1. Does a real clench survive real life?

The clench detector (`lib/sense/clench.ts`) is tested on synthetic jaw
muscle bursts. It has to meet real jaws, chewing, talking and walking.

- **People**: 20, each wearing the electrodes for 45 minutes.
- **Protocol**: 60 prompted clenches (20 single, 20 double, 20 held) at random
  moments while sitting, talking, walking and chewing gum; then 20 minutes of
  free conversation and a meal with no clenches asked for.
- **Labels**: the trial's clench button pressed by the experimenter at each
  prompt, so detections can be matched within a second.
- **Measure**: detection rate per kind, misclassified kinds, false detections
  per hour in the free period, latency from onset.
- **Bar to ship**: 95% of prompted single clenches caught, under one false
  detection an hour in conversation, under 0.7 s. The thresholds to tune are
  `k`, the band and the chewing rule.
- **Ready to run**: the trial's Studies, clench (`/studies/clench`), plays this
  protocol on any connected earbuds or an OpenBCI board, scores it against
  these bars and saves the report and the raw signal for tuning offline.
- **Already learned from the simulation**: run on the simulated earbuds with a
  simulated participant who chews gum and eats, the detector's chewing rule
  (four bursts in 3 s) let the first three bites of every meal through as
  clenches: 45 false detections an hour against a bar of one. The detector
  now takes those bites back once the fourth arrives, and a moment they began
  is called off before it is kept; in the same simulation that is 0 an hour,
  with every cued clench still caught. Whether real bites look enough like
  real clenches to need this is exactly what the study measures.

## 2. Can it follow a switch?

In the public data attention never moved. In life it does.

- **People**: 12.
- **Protocol**: two talkers from two loudspeakers at plus and minus 60
  degrees, both equally loud; a cue light tells the person which one to
  follow, switching at random every 30 to 90 seconds, for 30 minutes. The
  trial plays the audio, so its envelopes are known exactly.
- **Measure**: accuracy against the cue over time and the real switch time,
  compared with what MESD predicts from steady attention.
- **What it decides**: the belief's one setting, the chance per decision
  that attention moved (`DEFAULT_HAZARD` in `lib/sense/fusion.ts`, now 2%
  from simulated switches), measured against real ones, and whether the
  learned decoder's lead over the linear one holds when attention moves.

## 3. Does the EEG add anything to the head?

The product steers by head direction first. The EEG is only worth carrying if
it knows something the head does not.

- **People**: the same 12, with the earbud IMU (or the board's accelerometer).
- **Protocol**: the same two talkers, now with three blocks: facing the
  attended talker, facing the other one while listening to the first (as at a
  dinner table, looking at one person while following another), and facing
  straight ahead between them.
- **Measure**: accuracy of head direction alone, EEG alone, and the two fused
  (`lib/sense/fusion.ts`), per block.
- **What it decides**: the head prior's width (`kappa`; the EEG's weight is
  already fitted per decoder), and the honest pitch. If the EEG only helps
  when the head is turned away from the voice, that is the feature:
  listening without looking.

## 4. In the ear, or around it?

The public recordings come from arcs of electrodes around the ear, glued to
the skin. Earbuds touch the concha and the ear canal, dry.

- **People**: 10, with a pair of in ear electrode tips (silicone with a
  conductive coating, sized per ear) next to the around the ear electrodes.
- **Protocol**: experiment 2's blocks, ten minutes each, recorded from both
  electrode sets at once.
- **Measure**: signal quality (shorted input noise, impedance, motion
  artifacts) and decoding accuracy for each set.
- **What it decides**: where the four electrodes of the earbud go, and
  whether a dry tip is enough or the product needs a different contact.

## What carries over unchanged

Both decoders, the montage, the running belief, the clench detector, the
fusion, the protocol, the digital twin and the analysis scripts. The learned
decoder runs on the phone from `public/research/neural.json`; retraining it
on recordings from the earbuds themselves is `deep.py` and `deep_export.py`
pointed at the new data. A board or an earbud is just another
source of SSP frames, so every number from these experiments drops into the
same `results.json` format and the same page.
