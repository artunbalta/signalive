# What the literature says about an attention-decoding earbud

A reading of the published work on the questions Signalive depends on, in
November 2026: how well attention can be decoded from electrodes around and
inside the ear, what inflates published numbers, which methods hold up, what
the hardware has to deliver, and which public data can test an earbud before
it exists. Where this repository has its own numbers, they are set against the
published ones with their protocols, because protocols differ more than
results do. Our numbers are in [aad/README.md](aad/README.md) and
[ext/README.md](ext/README.md).

## Attention decoding, in one paragraph

A listener following one voice among several tracks its envelope more closely
than the others', and a decoder can read that difference from EEG: rebuild
the envelope from the EEG and correlate it with each talker's (stimulus
reconstruction), relate both in a shared space (canonical correlation), or
learn both sides with networks. Accuracy rises with the length of the decision
window, so results are reported per window, and a switch of attention can be
followed no faster than a decision gathers evidence; the minimal expected
switch duration (MESD) folds both into one number of seconds
([Geirnaert et al. 2021, review](https://doi.org/10.1109/MSP.2021.3075932);
[Geirnaert, Francart, Bertrand 2019](https://www.eurasip.org/Proceedings/Eusipco/eusipco2019/Proceedings/papers/1570533767.pdf)).

## Around the ear and in it: the published numbers

SS: trained on the person being tested. SI: trained on other people only.

| Study | Electrodes | Training | 60 s accuracy |
|---|---|---|---|
| [Mirkovic et al. 2016](https://doi.org/10.3389/fnins.2016.00349) | cEEGrid, 16, linked mastoids | SS | 69.3%; one grid of 8, 64.9% |
| [Nogueira et al. 2019](https://doi.org/10.3389/fnins.2019.00720) | cEEGrid, 16 | SS | about 60% (5 of 10 people above chance) |
| [Holtze et al. 2022](https://doi.org/10.3389/fnins.2022.869426), the data set used here | cEEGrid, 16 | SS | 71.3% (group hyperparameters; per person choices fell under nested cross validation) |
| [Geirnaert, Kappel, Kidmose 2025](https://arxiv.org/abs/2505.14478) | 19 wet around ear; 12 dry in ear; 29 scalp; same people, same moments | SS | around ear 67.2%, in ear 61.1%, scalp 83.4%; going SI cost 1.7, 11.7 and 7.7 points; each ear referenced to itself cost 4.1 more in the ear |
| [Thornton et al. 2024](https://arxiv.org/abs/2401.05187) | 2 dry in ear, against a scalp reference | SS | about 63.5% at 30 s; a network did no better than a linear decoder |
| [Fiedler et al. 2017](https://doi.org/10.1088/1741-2552/aa66dd) | one in ear electrode as the reference for scalp FT7 | SS | 70% for speech: not an ear only result |
| [Zhang et al. 2025](https://arxiv.org/abs/2510.19174) | cEEGrid, three talkers | SS, nested | 41.5% at 30 s (chance 33.3%); networks at chance |
| [Yan et al. 2025](https://doi.org/10.21437/Interspeech.2025-85) | cEEGrid, spatial decoders | SS | 91% at 1 s in a block design, 26% (chance 25%) when the design does not give away the answer |

**Where this repository stands.** On ds004015, held out by person, with four
electrodes per ear and each ear referenced to itself as two separate earbuds
must be, the linear decoder reaches 68.1% at 60 s and the learned one 76.6%
(version 2; version 3 in [aad/README.md](aad/README.md)). That is above every
around-ear number above, SS or SI, with fewer electrodes and a stricter
reference. Two things make the comparison need care, and both were tested
rather than argued:

- Every person in ds004015 heard the same stories in the same blocks, and the
  EEG of other listeners alone identifies which side a person followed (AUC
  98%, [Holtze et al. 2022](https://doi.org/10.3389/fnins.2022.869426)). A
  network tested only on new people could learn the stories. So the learned
  decoder is also evaluated on story content it never trained on, and on a
  source study it never trained on.
- The 97 s out of step control (same voices, out of step with the EEG) shows
  the decisions come from tracking, not from recognising voices.

**What the in-ear numbers mean for the product.** The only same-moment
comparison puts dry in-ear contacts a third of the way from chance to the
scalp, around the ear half way, and calibration free in-ear decoding near
chance with a linear decoder ([Geirnaert, Kappel, Kidmose 2025](https://arxiv.org/abs/2505.14478)).
Signal amplitude within one ear is about 20 dB below the scalp, falling with
electrode spacing ([Kidmose et al. 2013](https://www.commsp.ee.ic.ac.uk/~mandic/research/EEG_BCI/PK_DPM_Ear_EEG_ERP_IEEE_TBME_2013.pdf);
[Yarici et al. 2023](https://www.frontiersin.org/articles/10.3389/fnins.2022.997377/full)).
Where an earbud's contacts sit is the first hardware decision, and
[ext/README.md](ext/README.md) runs this repository's decoders on that same
data set.

## What inflates published numbers

| Pitfall | What happens | How this repository guards against it |
|---|---|---|
| Shared stimuli across people | A model learns the stories, and scores well on new listeners of the same stories ([Puffay et al. 2023](https://doi.org/10.1088/1741-2552/ace73f); de Taillez et al. 2020, European Journal of Neuroscience) | Held out story content; held out study |
| Trials or blocks split into training and test | Trial identity leaks into the score | People are held out whole; nothing of a test person trains anything |
| Spatial "locus" decoders | They read where the eyes or the block design point, not attention: within condition 64 to 71%, across trials 42 to 45% ([Rotaru et al. 2024](https://doi.org/10.1088/1741-2552/ad2214); [Yan et al. 2025](https://doi.org/10.21437/Interspeech.2025-85)) | None used; every decision correlates EEG with speech envelopes |
| One attended side per person | Any self-training learns the person's side, so "unsupervised adaptation" looks like learning | No adaptation is claimed on this data |
| Choosing settings on the test people | Optimism that does not replicate (per person hyperparameters: 82.6% under plain cross validation, reversed under nested, [Holtze et al. 2022](https://doi.org/10.3389/fnins.2022.869426)) | Settings chosen on validation people only, by a rule fixed before the runs |
| Non-neural signals | Eye movements and muscle activity carry side information | Out of step control; 1 to 9 Hz only |

## Methods: what holds up

- **Linear decoders replicate best.** Across seven algorithms re-run on two
  64 channel data sets, canonical correlation was the best linear method, and
  networks that did well on one data set fell near chance on the other
  ([Geirnaert et al. 2021](https://doi.org/10.1109/MSP.2021.3075932)).
- **Learned models that compare EEG with each talker's speech, trained to
  tell the followed talker from others, do hold up across people** when the
  stimuli are held out ([Nguyen et al. 2025, AADNet](https://doi.org/10.1109/TNSRE.2025.3587637):
  SI 0.9 to 6.8 points below SS), and averaging many trained networks adds a
  few points (16 instances, +2.3 to +2.8,
  [Thornton et al. 2024](https://arxiv.org/abs/2401.17380)). This repository's
  learned decoder is of this kind.
- **Unsupervised adaptation is slow and small.** A time adaptive decoder
  needs 14 to 20 minutes of 60 s updates even with 64 channels
  ([Geirnaert, Francart, Bertrand 2022](https://doi.org/10.1101/2022.01.07.475386)),
  and around the ear going SI costs only 1.7 points to begin with.
- **EEG foundation models** have no attention decoding result yet, use scalp
  montages and one second patches; not worth the overfitting risk on 36
  people today.

## What the hardware must deliver

| Question | What the evidence says |
|---|---|
| Amplifier noise | Not the limit: TI parts measure 0.14 to 0.7 µVrms with inputs shorted; dry contacts took one ear EEG system from 1.6 to 4.65 µVrms ([Kaveh et al. 2020](https://arxiv.org/abs/2003.00657)) |
| Contacts | Dry in-ear contacts measure 0.1 to 2 MΩ with a spread as large as the mean; about one contact or measurement in ten is lost ([Kappel and Kidmose 2015](https://pubmed.ncbi.nlm.nih.gov/26736963/); [Mikkelsen et al. 2019](https://doi.org/10.1038/s41598-019-53115-3)) |
| Input impedance | 1 GΩ holds at DC; at 50 Hz the input capacitance sets it, so cap it at 10 to 15 pF ([ADS1299](https://www.ti.com/lit/ds/symlink/ads1299.pdf)) |
| Sampling | 500 SPS: at 250 SPS TI parts cut off near 65 Hz, inside the 60 to 80 Hz plateau of clench EMG ([Kappel et al. 2017](https://doi.org/10.1186/s12938-017-0391-2)) |
| Two earbuds, no wire | Galvanically isolated nodes match wired ones around the ear, 69.2% ([Geirnaert, Ding, Bertrand 2026](http://homes.esat.kuleuven.be/~abertran/reports/2026Geirnaert_2nodeAAD.pdf)); this repository measures 1.6 points for referencing each ear to itself |
| Power | An ADS1299-4 draws 22 mW on a 5 V rail: 3 to 3.6 h with audio; a 3 V part (ADS1294) or two ADS1292 keep 4.8 to 6.8 h. Shipping EEG audio products run 6 to 13 h |
| Artifacts | Walking at 0.5 to 3.5 Hz cut cEEGrid ERP AUC from 0.72 to 0.58 ([Lee et al. 2021](https://doi.org/10.1038/s41597-021-01094-4)); chewing exceeds 5 mV in the canal; nobody has published talking or chewing amplitudes inside 1 to 9 Hz at the ear |

The repository's own measurements of these tolerances, made by degrading real
recordings and rerunning the held out decoder, are in
[aad/README.md](aad/README.md) and [../hardware/SPEC.md](../hardware/SPEC.md).

## Public data that tests an earbud before it exists

| Question | Data set | License |
|---|---|---|
| Attention around the ear | [ds004015](https://doi.org/10.18112/openneuro.ds004015.v1.0.2), 36 people, cEEGrid | CC0 |
| In the ear against around it | [Ear-SAAD](https://zenodo.org/records/16536441), 15 people | CC BY-NC-SA 4.0 per its files |
| In-ear attention with audio | [Aarhus event based AAD](https://zenodo.org/records/8082867), 24 people | CC BY 4.0 |
| Attention that switches | [AASD](https://zenodo.org/records/17413336), 18 people, button marked switches | CC BY 4.0 |
| Cued clenches around the ear | [Park et al.](https://doi.org/10.6084/m9.figshare.23523588), 15 people | CC BY 4.0 |
| Labelled swallows, tongue, head and eye movements | [PhysioMotion, ds006386](https://openneuro.org/datasets/ds006386), 30 people | CC0 |
| A consumer headband | [Lee and Ahn](https://doi.org/10.6084/m9.figshare.30162868), Muse 2 and others | CC BY 4.0 |

Still missing from every public data set: chewing, eating and free
conversation recorded at the ear at 250 Hz or more, with labels. That is what
experiment 1 of [NEXT.md](NEXT.md) records.

## Freedom to operate

Not legal advice. Patents that touch this design and should go to counsel:
EEG to audio similarity steering a head worn device (Oticon US 9,432,777),
convolutional networks scoring EEG against each source (MIT and Columbia
US 11,630,513), learned separation selected by EEG (Columbia US 11,373,672),
ear electrodes referenced to a second body worn part (Oticon US 9,700,261,
which a within-ear reference avoids), two sided self referencing (Bose
US 10,213,157), and earbud electrode gestures (Naqi Logix, which acquired
Wisear: US 11,494,001 and US 12,008,163). The linear decoder is a fallback
that sits clear of the network claims.
