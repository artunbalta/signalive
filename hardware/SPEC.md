# Hardware Requirements Specification v0

Signalive earbuds: ear EEG for auditory attention decoding, jaw clench EMG picked up by the
same electrodes, a 6 axis IMU for head orientation, and outward microphones so the earbud
itself can bring the chosen voice forward.

| | |
|---|---|
| Version | v0, draft, 2026-11-02 |
| Scope | One earbud unless a requirement says otherwise. Left and right are identical and independent. |
| Companions | [README.md](README.md) (index), [ARCHITECTURE.md](ARCHITECTURE.md) (data flow, latency, failure modes), [BOM.md](BOM.md) (parts and prices), [PROTOCOL.md](PROTOCOL.md) (the SSP wire protocol, which wins on anything about bytes on the air) |
| Phone side | Written and tested in [`lib/sense/`](../lib/sense/). This document asks the hardware only for what that code consumes. |

**How to read it.** Each requirement has an ID, a priority, the requirement, the reason and
the verification. **Must**: a prototype that misses it fails review. **Target**: the design
goal; a miss needs a written reason. Datasheet and paper numbers link to their source. "To
verify" marks a number nobody has confirmed yet; "estimate" marks arithmetic on stated
assumptions. **Band A** is the attention band, 1 to 9 Hz, where the decoder works
([pipeline.py](../research/aad/pipeline.py)). **Band C** is the clench band, 30 to 120 Hz
([clench.ts](../lib/sense/clench.ts)). Test IDs (T-01 to T-13) refer to section 12.

## Key numbers

| Item | Value | Requirement |
|---|---|---|
| Contacts per ear | 4 sensing + 1 reference + 1 bias, all dry, all in or on the same ear, at least 2 sensing outside the canal | HW-EEG-01, -02 |
| Contact impedance | each ≤ 1 MΩ at 10 Hz; median ≤ 200 kΩ (target) | HW-EEG-04 |
| AFE noise, inputs shorted | ≤ 1 µVrms over 0.5 to 100 Hz and ≤ 0.3 µVrms over band A | HW-AFE-02 |
| Sample rate | 500 Hz preferred, 250 Hz minimum, all channels simultaneous | HW-AFE-03 |
| DC offset tolerance | ≥ ±300 mV differential without saturation (target) | HW-AFE-05 |
| IMU | 6 axis, ≥ 100 Hz, quaternion in the head frame | HW-IMU-01, -02 |
| Microphones | ≥ 2 outward facing per earbud, 3 preferred | HW-MIC-01 |
| Steered hear-through delay | ≤ 5 ms target, ≤ 10 ms maximum | HW-AUD-02 |
| Stream per earbud | 9.3 kB/s at 500 Hz, 6.1 kB/s at 250 Hz | HW-BLE-02 |
| Attention mode runtime | ≥ 5 h target, ≥ 4 h minimum; estimate 5.2 to 6.4 h on a 60 to 74 mAh cell | HW-PWR-01 |

---

## 1. Electrodes

**What is known.** Ear EEG began with electrodes on a personalised earpiece in the ear canal
and concha ([Looney et al. 2012](https://doi.org/10.1109/MPUL.2012.2216717); placement as
described in a [2019 follow-up](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.00730/full)),
and its evoked responses have a signal to noise ratio on par with scalp electrodes over the
temporal region ([Kidmose et al. 2013](https://doi.org/10.1109/TBME.2013.2264956)). Dry
contact works in individualised soft earpieces with actively shielded, nanostructured
electrodes ([Kappel et al. 2019](https://doi.org/10.1109/TBME.2018.2835778)), made of
iridium oxide on titanium ([Favre-Félix et al. 2019](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.01294/full)),
and dry Ag/AgCl performs like iridium oxide ([Kappel and Kidmose 2022](https://doi.org/10.1109/EMBC48229.2022.9871923)).
A universal fit earpiece with Ag spray coated dry electrodes, four in the ear and two outside
it, has been built and worn ([Kaveh et al. 2020](https://doi.org/10.1109/TBCAS.2020.3001265),
[arXiv text](https://arxiv.org/abs/2003.00657)). The validation data come from cEEGrids: ten
printed Ag/AgCl electrodes per ear, 3 mm across, in a C around the ear, with a little
electrolyte ([Debener et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4648079/),
[Bleichner and Debener 2017](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2017.00163/full)).
Recorded simultaneously on 15 people, attention decoding over 60 s windows reached 83.4% with
scalp EEG, 67.2% around the ear and 61.1% in the ear with 12 dry Ag/AgCl electrodes, six per
ear ([Geirnaert, Kappel and Kidmose 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12644565/)).
Plan for the earbud to land below the cEEGrid numbers until a prototype shows otherwise. Our
own run of the calibration free decoders on those recordings, each ear referenced to itself,
puts the dry in-ear electrodes at chance and the around the ear ones at 61% in one minute
decisions ([research/ext](../research/ext/README.md)): contacts in the canal alone are not
enough (HW-EEG-02).

**HW-EEG-01 Contact count** (Must)
- Requirement: 6 dry contacts per ear: 4 sensing (E1 to E4), 1 reference (REF), 1 bias
  (BIAS, the driven ground). All six in or on the same ear.
- Rationale: 4 sensors per ear is the product's design target ([lib/copy.ts](../lib/copy.ts),
  science block). On the public cEEGrid data, 4 per ear with each ear referenced to itself
  lands near all 18 electrodes, and 2 per ear close behind
  ([research/aad/README.md](../research/aad/README.md)), so 4 is the target with margin and 2
  is the fallback layout. REF and BIAS must sit in the same ear because a true wireless
  earbud has nothing else to refer to (section 3). Six per ear has precedent in research
  earpieces ([Geirnaert et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12644565/);
  [Mikkelsen et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6856384/), six per
  earpiece). Commercial earbuds carry fewer: three per earbud in
  [NextSense](https://villpress.com/?p=7979), two in the canal in
  [IDUN's Dryode Duo](https://iduntechnologies.com/).
- Verification: inspection; per channel signal check in T-04.

**HW-EEG-02 Placement** (Must and Target)
- Requirement (Must): at least two of the four sensing contacts outside the ear canal, on or
  around the outer ear, as far from the canal and from REF as the shell, a wing or an ear hook
  can reach (helix root, behind the ear, the upper concha). (Target): spread every contact as
  far apart as one ear allows. Starting layout: E1 in the canal; E2 in the cymba; E3 and E4
  outside the concha, one at the helix root and one behind the ear on a hook or wing; REF at
  the reachable position farthest from the sensing contacts that still keeps contact; BIAS
  anywhere with reliable contact.
- Rationale: on the same 15 people at the same moments, with each ear referenced to itself
  and no calibration, as two earbuds must decode, dry contacts inside the ear gave one minute
  decisions at chance (48%) and wet contacts around the ear gave 61%, with the same decoders
  ([research/ext](../research/ext/README.md), Ear-SAAD). Within-ear recordings are typically
  10 to 20 dB smaller than scalp referenced ear recordings ([Frontiers in Neuroscience 2019](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.00943/full)),
  and amplitude falls off steeply when electrode and reference are close
  ([Mikkelsen et al. 2015](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2015.00438/full)).
  The lead's ranking of cEEGrid positions (left L01 L04b L06 L04, right R02 R05 R08 R04, in
  [research/aad/README.md](../research/aad/README.md)) says which around the ear positions
  carry the most; mapping them onto earbud positions is an open question for the wired
  prototype.
- Verification: T-07 compares candidate layouts on the same people.

**HW-EEG-03 Material** (Must)
- Requirement: dry contact (no gel, no skin preparation), soft or compliant at the skin, with
  a stable electrochemical surface. Default: Ag/AgCl, printed or coated, on a conductive
  elastomer or a rigid insert. Alternatives: iridium oxide on titanium, gold.
- Rationale: dry Ag/AgCl and iridium oxide gave similar impedance and recording quality in
  ear EEG ([Kappel and Kidmose 2022](https://doi.org/10.1109/EMBC48229.2022.9871923)). A soft
  Ag/AgCl coated conductive elastomer exists as a product: Datwyler SoftPulse, 83 ± 5 Shore
  A, average electrode to tissue impedance 25 to 200 kΩ at 10 Hz
  ([Datwyler](https://datwyler.com/company/innovation/softpulse/technology/)). Conductive
  cloth on viscoelastic foam also works but needs saline for a low impedance contact
  ([Goverdovsky et al. 2016](https://doi.org/10.1109/JSEN.2015.2471183)). Suppliers in
  [BOM.md](BOM.md).
- Verification: material certificates; T-03; T-11 (sweat); biocompatibility per HW-REG-06.

**HW-EEG-04 Contact impedance** (Must and Target)
- Requirement (Must): per contact, impedance magnitude at 10 Hz ≤ 1 MΩ after 5 minutes of
  wear, without skin preparation, in at least 80% of people per tip size. (Target): median
  ≤ 200 kΩ; mismatch between any two contacts of one ear ≤ 500 kΩ. Also record the 50 Hz
  value, which is how the literature reports it.
- Rationale: dry in-ear electrodes have measured 392 kΩ at 50 Hz on average with a < 1 MΩ
  acceptance rule ([Kaveh et al. 2020](https://arxiv.org/abs/2003.00657)), 120 kΩ at 50 Hz
  for gold ([Kaveh et al. 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11297174/)), and
  230 kΩ to 1.2 MΩ against 5.1 to 34 kΩ wet, at the high and low frequency ends of a 0.1 Hz
  to 2 kHz sweep (exact frequencies to verify) ([Kappel and Kidmose 2015](https://doi.org/10.1109/EMBC.2015.7319063)).
  Commercial soft dry contacts are specified at 25 to 200 kΩ at 10 Hz (Datwyler, above) and
  at under 20 to 200 kΩ typical ([IDUN](https://iduntechnologies.com/)). The validation data
  were wet: about 16 kΩ in [Debener et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4648079/)
  and kept below 20 kΩ in [Holtze et al. 2022](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2022.869426/full).
  Expect one to two orders of magnitude more impedance than the data the decoder was
  validated on, hence the AFE input requirements in section 2.
- Verification: T-03.

**HW-EEG-05 Contact stability** (Target)
- Requirement: through 10 minutes each of talking, chewing, walking and head turns, no lead
  off event and impedance within 2x of the seated value; artifact power in band A reported
  per activity.
- Rationale: the ear canal deforms with chewing, swallowing and speaking
  ([Goverdovsky et al. 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5537365/)); jaw
  artifacts degrade signal to noise more in the ear than on the scalp, most in 32 to 100 Hz
  ([Kappel et al. 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5553928/)); walking and
  running degraded cEEGrid responses in [Lee et al. 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8688416/).
  Measured on recordings ([research/aad](../research/aad/README.md), hardware_bars.py, the final decoder on people it never saw): movement is the degradation that costs most at a plausible rate: two 200 µV jolts a
  minute cost five points of one minute accuracy and ten a minute fifteen. A software gate
  that blanks a quarter second around any sample over five times its channel's spread
  recovered five to seven of those points and cost nothing at rest; the phone's chain now
  runs it (lib/sense ArtifactGate). Contact stability sets how often it has to act.
- Verification: T-05.

**HW-EEG-06 Lead off detection** (Must)
- Requirement: every contact (E1 to E4, REF, BIAS) monitored continuously while streaming. A
  lost contact is reported within 1 s through the SSP EVENT LEAD_OFF and the LEAD_OFF flag
  ([PROTOCOL.md](PROTOCOL.md)). The excitation puts no energy into band A or band C.
- Rationale: the phone turns a lost channel into missing data and re-derives the montage. The
  ADS1299 offers DC lead off currents of 6 nA, 24 nA, 6 µA or 24 µA and AC excitation at
  7.8 Hz or 31.2 Hz ([datasheet](https://www.ti.com/lit/ds/symlink/ads1299.pdf)); both AC
  frequencies fall inside our bands, and the datasheet notes continuous AC lead off needs an
  external out of band source. A 6 nA DC current into 1 MΩ shifts the input by only 6 mV.
- Verification: T-04.

**HW-EEG-07 Contact area** (Target)
- Requirement: each sensing contact ≥ 10 mm² of skin contact (to be revised from T-03 data).
- Rationale: impedance falls with area. Reference points: cEEGrid electrodes are 3 mm across,
  about 7 mm², wet ([Bleichner and Debener 2017](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2017.00163/full));
  Kaveh et al. used 60 mm² dry in-ear contacts and two 4 cm² outside the ear
  ([arXiv](https://arxiv.org/abs/2003.00657)).
- Verification: drawing; T-03.

**HW-EEG-08 Universal fit** (Must)
- Requirement: no custom moulds. Electrode tips in at least 3 sizes, user replaceable.
- Rationale: the client brief treats custom moulds as fatal to a consumer product
  ([AGENT_BRIEF](../AGENT_BRIEF_ear-attention-interface.md), Phase 2.2). The dry in-ear
  results above mostly come from individualised earpieces; the universal fit precedent is
  Kaveh et al. 2020.
- Verification: T-05 and T-07 across at least 10 different ears.

---

## 2. Analog front end (AFE)

The AFE has to digitise microvolt signals behind dry contacts of up to a megaohm, at 24 bits,
without being the noise floor. Candidates against the requirements below (all figures from
the linked datasheets and product pages; prices in [BOM.md](BOM.md)):

| | [ADS1299-4](https://www.ti.com/lit/ds/symlink/ads1299.pdf) | [ADS1294R](https://www.ti.com/lit/ds/symlink/ads1294r.pdf) | [AFE159RP4](https://www.ti.com/product/AFE159RP4) |
|---|---|---|---|
| Channels | 4 | 4 | 4 |
| Input referred noise | 1 µVpp, 0.01 to 70 Hz, gain 24; 0.20 µVrms at 500 SPS (131 Hz), gain 24 | 4 µVpp, 150 Hz, gain 6; 0.5 µVrms at 500 SPS, gain 12 | 4 µVpp in 150 Hz |
| CMRR at 50 and 60 Hz | -110 dB min | -105 dB min | -140 dB |
| Data rate | 250 SPS to 16 kSPS | 500 SPS to 32 kSPS (high resolution mode), 250 SPS to 16 kSPS (low power mode) | 125 SPS to 128 kSPS |
| Power, all 4 channels | 22 mW typ, 5 V analog | 4.1 to 5.4 mW, 3 V | about 1.7 mW (0.42 mW per channel, conditions to verify) |
| Analog supply | 4.75 to 5.25 V | 2.7 to 5.25 V | 3.15 to 5.25 V plus 1.7 to 1.9 V |
| Package | TQFP-64, 10 x 10 mm body | nFBGA-64, 8 x 8 mm | DSBGA-49, 3.7 x 3.6 mm |
| Role | Dev kit silicon (OpenBCI Cyton), Rev A reference | Earbud candidate, full datasheet public | Earbud candidate, public datasheet is a summary (Rev. A, Nov 2024) |

**HW-AFE-01 Channels** (Must)
- Requirement: at least 4 differential channels sampled simultaneously from one clock, a
  reference input shared by the channels (REF), and a bias drive output (BIAS).
- Rationale: HW-EEG-01. Simultaneous sampling keeps the montage arithmetic exact.
- Verification: datasheet; T-01 cross channel timing with a common test signal.

**HW-AFE-02 Noise** (Must and Target)
- Requirement (Must): input referred noise with inputs shorted ≤ 1 µVrms integrated over 0.5
  to 100 Hz (about 6.6 µVpp) and ≤ 0.3 µVrms over band A, at the operating gain and 500 SPS.
  (Target): ADS1299 class, ≤ 0.25 µVrms over the full 500 SPS bandwidth.
- Rationale: the amplifier must stay well below the noise of dry contacts. A dry ear EEG
  front end measured 1.6 µVrms over 1 to 500 Hz without electrodes and 4.65 µVrms with them
  ([Kaveh et al. 2020](https://arxiv.org/abs/2003.00657)), so the contact, not the AFE,
  should set the floor. Clinical EEG guidance asks for less than 1 µV peak to peak of added
  noise at any frequency from 0.5 to 100 Hz ([ACNS Guideline 4](https://www.acns.org/UserFiles/file/Guideline4-RecordingClinicalEEGonDigitalMedia_v1.pdf)).
  The three candidates above meet the Must on their datasheet numbers; band A, where 1/f
  noise lives, has to be measured. Measured on recordings ([research/aad](../research/aad/README.md), hardware_bars.py, the final decoder on people it never saw): white noise added at every electrode cost under
  a point of one minute accuracy up to 200 nV/√Hz and three points at 800; 1/f noise in the
  decoder's band cost under a point up to 0.5 µVrms and three points at 2 µVrms. Band A is
  the limit that matters, and the Must above keeps it at 0.3 µVrms.
- Verification: T-01.

**HW-AFE-03 Sample rate** (Must)
- Requirement: 500 SPS supported and preferred; 250 SPS minimum. Selectable at run time by the
  SSP command SET_EEG_RATE.
- Rationale: the clench detector works in band C, which needs Nyquist above 120 Hz: at 250 Hz
  the software clamps the band top to 112.5 Hz ([clench.ts](../lib/sense/clench.ts)); at
  500 Hz the whole band fits. Jaw muscle EMG peaks around 50 to 60 Hz (masseter) and 40 to
  80 Hz (temporalis) within a 20 to 300 Hz bandwidth ([Muthukumaraswamy 2013](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2013.00138/full)).
  The validation data were recorded at 500 Hz ([Holtze et al. 2022](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2022.869426/full)).
  [PROTOCOL.md](PROTOCOL.md) budgets 250 Hz as the default stream; 500 Hz costs air time
  (6.1 against 9.3 kB/s) and little power (section 8). On public recordings, the phone's
  unchanged detector caught 70% of cued clenches from electrodes around the ear at 250 Hz,
  52% from one electrode behind each ear at 256 Hz, and 99% of cued clench blocks from the
  temporal scalp at 1000 Hz ([research/ext](../research/ext/README.md)). Those sets differ in
  electrodes and people as well as rate, so this agrees with the rate mattering rather than
  proving it; T-13 at both rates settles it. Measured on recordings ([research/aad](../research/aad/README.md),
  hardware_bars.py): attention alone would lose nothing down to 100 Hz, so the rate is set
  by the clench.
- Verification: T-01 at both rates; T-13 at both rates.

**HW-AFE-04 Resolution and scale** (Must)
- Requirement: 24 bit delta sigma conversion; one count ≤ 50 nV referred to the input at the
  operating gain; the nanovolts per count reported in HELLO within 1% of the measured gain.
- Rationale: an ADS1299 class part at gain 24 gives 22.35 nV per count over ±187.5 mV
  ([PROTOCOL.md](PROTOCOL.md), HELLO); the phone converts counts to microvolts with the HELLO
  scale, and the clench detector's thresholds are relative but the bench limits are not.
  Measured on recordings ([research/aad](../research/aad/README.md), hardware_bars.py, the final decoder on people it never saw): converter steps of up to 10 µV cost nothing measurable and 20 µV cost five points,
  so resolution has a margin of more than a hundred times over a 24 bit part.
- Verification: inject a calibrated 10 µV, 5 Hz sine through a divider; compare.

**HW-AFE-05 DC offset tolerance** (Must and Target)
- Requirement: DC coupled inputs. (Must): ≥ ±150 mV differential without saturation at the
  operating gain while meeting HW-AFE-02. (Target): ≥ ±300 mV.
- Rationale: dry contacts carry offsets of tens of millivolts that drift with motion and
  sweat: 5.6 ± 39.3 mV and 6.3 ± 29.4 mV for two dry types against -0.4 ± 21.8 mV for gel
  ([Vasconcelos et al. 2021](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2021.748100/full),
  which notes offsets can saturate the amplifier input). The ADS1299 full scale is ±VREF /
  gain with VREF 4.5 V: ±187.5 mV at gain 24 and ±375 mV at gain 12, where noise is still
  0.23 µVrms at 500 SPS ([datasheet](https://www.ti.com/lit/ds/symlink/ads1299.pdf)). A recent
  biopotential AFE states ±300 mV of DC offset tolerance ([ams OSRAM AS7058 datasheet](https://look.ams-osram.com/m/6b2e246fe55145c1/original/AS7058-IC-for-PPG-ECG-and-body-impedance-measurement.pdf)).
  AC coupling caps with megaohm contacts make slow, offset prone input networks; avoid them.
- Verification: T-01 with a ±300 mV DC source in series with the phantom.

**HW-AFE-06 Input impedance and bias current** (Must)
- Requirement: ≥ 1 GΩ DC input impedance with lead off detection off; input bias current
  ≤ 1 nA.
- Rationale: against 1 MΩ contacts, 1 GΩ keeps the divider error at 0.1%, and 1 nA through
  1 MΩ adds only 1 mV of offset. The ADS1299 gives 1000 MΩ minimum and ±300 pA maximum
  ([datasheet](https://www.ti.com/lit/ds/symlink/ads1299.pdf)). Metering ADCs fail here: the
  ADS131M04 draws 0.2 µA at gain 8 and above ([datasheet](https://www.ti.com/lit/ds/symlink/ads131m04.pdf)).
- Verification: datasheet for the AFE159RP4 (full datasheet to request from TI); measure
  offset change with a 1 MΩ series resistor.

**HW-AFE-07 Common mode rejection** (Must and Target)
- Requirement (Must): AFE CMRR ≥ 100 dB at 50 and 60 Hz. (Target): system rejection ≥ 80 dB
  with a 500 kΩ imbalance between inputs and the bias drive on.
- Rationale: clinical guidance asks for at least 90 dB ([ACNS](https://www.acns.org/UserFiles/file/Guideline4-RecordingClinicalEEGonDigitalMedia_v1.pdf)).
  With dry contacts the limit is the divider, not the chip: 1 GΩ input against a 500 kΩ
  imbalance converts common mode to differential at about 1 part in 2000 (66 dB) before the
  bias loop reduces the common mode itself. Dry in-ear contacts are "more prone to common-mode
  interference" ([Geirnaert et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12644565/)).
  Mains at 50 and 60 Hz (and 100, 120 Hz) sits inside band C, so this protects the clench
  channel more than the attention band. Measured on recordings ([research/aad](../research/aad/README.md), hardware_bars.py, the final decoder on people it never saw): 50 Hz common to every electrode with 1%
  imbalance did nothing to attention up to 10 mV and cost five points at 50 mV.
- Verification: T-02.

**HW-AFE-08 Bias drive** (Must)
- Requirement: per ear, a bias amplifier drives BIAS with the inverted common mode of that
  ear's inputs; stable into a contact of up to 1 MΩ; current limited by a series resistor so
  the worst case DC current into the skin stays in the microampere range (limit value to
  verify, using IEC 60601-1 patient auxiliary current as a reference although this is not a
  medical device).
- Rationale: the bias loop is what keeps a floating earbud's inputs inside their common mode
  range. The ADS1299 bias amplifier has 100 kHz gain bandwidth and a 1.1 mA short circuit
  current ([datasheet](https://www.ti.com/lit/ds/symlink/ads1299.pdf)), hence the resistor.
- Verification: T-02; fault test with BIAS shorted to each input.

**HW-AFE-09 Power and size** (Must and Target)
- Requirement (Must): ≤ 6 mW for 4 channels at 500 SPS, package ≤ 64 mm². (Target): ≤ 2 mW,
  ≤ 16 mm².
- Rationale: section 8. The ADS1294R meets the Must (4.1 to 5.4 mW, 8 x 8 mm); the AFE159RP4
  meets the Target on its headline figures (about 1.7 mW, 3.7 x 3.6 mm). The ADS1299-4 (22 mW
  at a 5 V analog supply, 10 x 10 mm body) does not belong in the earbud, as the client brief
  already concluded ([AGENT_BRIEF](../AGENT_BRIEF_ear-attention-interface.md), section 3.1).
- Verification: T-12 current measurement.

**HW-AFE-10 Supply** (Must)
- Requirement: operate across the full discharge range of the cell (about 3.0 to 4.2 V for
  Li-ion, cutoff to verify against the chosen cell) through the PMIC.
- Rationale: the AFE159RP4 needs 3.15 V or more on its first analog rail
  ([TI](https://www.ti.com/product/AFE159RP4)), so a Li-ion design needs a boost or buck
  boost converter for it; the ADS1294R runs from 2.7 V
  ([datasheet](https://www.ti.com/lit/ds/symlink/ads1294r.pdf)). Converter ripple must stay out of the
  bands (HW-AFE-12).
- Verification: T-01 at 3.0, 3.7 and 4.2 V cell voltage.

**HW-AFE-11 Anti aliasing** (Target)
- Requirement: content from 250 Hz to 2 kHz (EMG, audio amplifier switching) aliases into
  band A attenuated by ≥ 40 dB.
- Rationale: jaw EMG extends to 300 Hz (Muthukumaraswamy 2013, above); the delta sigma
  decimation filter alone has weak rejection near multiples of the output rate.
- Verification: swept tone injection, 250 Hz to 2 kHz, at 250 and 500 SPS.

**HW-AFE-12 Coupling from radio, audio and switchers** (Must)
- Requirement: with BLE streaming at full rate, audio playing at maximum level and every
  converter running, the shorted input spectrum shows no line above 0.5 µVrms in 1 to 120 Hz.
- Rationale: microvolt traces sit millimetres from the antenna, the speaker driver and the
  PMIC. BLE connection events are periodic (a 30 ms interval puts a 33 Hz line and its
  harmonics inside band C).
- Verification: T-01, the "everything on" condition.

---

## 3. Referencing: the decision between true wireless and a wired link

**Why this section decides the product.** An EEG amplifier measures each electrode against a
reference and holds the body near its input common mode through a bias electrode. Two true
wireless earbuds share no wire, so they cannot share a reference or a bias: each earbud
measures its own ear against a reference in that same ear. That discards the potential
difference across the head and keeps only the small differences between contacts a couple of
centimetres apart in one ear. Within-ear recordings are typically 10 to 20 dB smaller than
scalp referenced ones ([Frontiers in Neuroscience 2019](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.00943/full)).
With dry in-ear electrodes, referencing each ear to its own average cost 4.1 points of
decoding accuracy and adding one scalp reference gained 9.3 points
([Geirnaert et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12644565/)); in real life
recordings only the auditory steady state response stayed significant with a same ear
reference ([Kappel and Kidmose 2018](https://doi.org/10.1109/EMBC.2018.8513532)); and
mismatch negativity needed a reference in the opposite ear ([Kappel et al. 2019](https://doi.org/10.1109/TBME.2018.2835778)).

The lead asked the same question of the public cEEGrid data (36 people, two competing
audiobooks, [OpenNeuro ds004015](https://doi.org/10.18112/openneuro.ds004015.v1.0.2)):
**wired**, every electrode against the recording's reference behind the right ear (R4b, with
R4a as ground, [Holtze et al. 2022](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2022.869426/full)),
which needs a wire between the ears; **wireless**, each ear referenced to its own average,
which two independent earbuds can do; and each **ear alone**
([pipeline.py](../research/aad/pipeline.py) `montage_matrix`,
[analyze.py](../research/aad/analyze.py)).

Share of decisions naming the followed story, 4 electrodes per ear, generic decoder (no
calibration), mean over 36 people; a coin flip scores 50%.

<!-- MEASURED: filled from research/aad/results.json -->
| Montage | 2 s | 5 s | 10 s | 30 s | 60 s | 5 min | MESD |
|---|---|---|---|---|---|---|---|
| Wired: 4 per ear against one reference behind the right ear | 54.2% | 56.0% | 57.8% | 63.0% | 69.6% | 80.6% | 126 s |
| Wireless: 4 per ear, each ear referenced to itself | 54.2% | 55.9% | 58.0% | 63.2% | 68.1% | 85.2% | 120 s |
| Left earbud only: 4, referenced to itself | 52.5% | 54.2% | 55.6% | 58.2% | 59.3% | 74.1% | 284 s |
| Right earbud only: 4, referenced to itself | 53.5% | 54.9% | 56.5% | 61.2% | 66.1% | 79.2% | 174 s |

Generic decoder (no calibration), mean over 36 people, held out. Chance is 50%.

Written by `python3 research/aad/spec_table.py` from `configs.{wired,wireless,left,right}_4.generic`
in results.json (36 people, decoders that never saw the person, no calibration). Retention
R = (wireless - 50) / (wired - 50) is **1.03 at 10 s and 1.02 at 30 s**
(0.92 at 60 s, where the two montages differ by 1.6 points, within one
standard error of the mean): by the rule below, **true wireless earbuds**.

**How the table decides the product form** (the rule; on the numbers above it says true wireless):

- Let retention R = (wireless - 50) / (wired - 50), with accuracies in percent, at the 10 s
  and 30 s windows.
- **R ≥ 0.9: true wireless earbuds**, each ear on its own reference. No neckband.
- **0.7 ≤ R < 0.9:** true wireless stays the plan, but the wired prototype repeats the
  comparison with dry in-ear contacts and real split grounds (T-08) before the earbud layout
  freezes.
- **R < 0.7:** the shared reference carries the signal. The product needs a galvanic link
  between the ears, a neckband or a cable carrying a common reference. A reference potential
  cannot be sent over a radio.
- The left only and right only rows set what the system can still do when one earbud is out
  ([ARCHITECTURE.md](ARCHITECTURE.md), failure modes) and whether a single earbud could carry
  attention at all.

**Current reading.** The lead's first pass ([research/aad/README.md](../research/aad/README.md),
2026-11-02) concludes that true wireless works, with referencing each ear to itself costing
about a point and a half against the wired montage. Two cautions for the hardware. First,
cEEGrids are wet and sit around the ear; the in-ear literature above shows a larger same ear
penalty. Second, a montage computed in software from a wired recording reproduces the
geometry of two earbuds but not their electrics: two floating devices, two bias loops, two
different mains pickups. T-08 measures the electrics.

**A note on REF placement.** Averaging the four sensing channels of one ear cancels the REF
electrode's own potential, so for the wireless montage the REF position affects saturation
and common mode pickup, not the derived signals. Counting REF as a fifth electrode in the
average (its channel is zero by construction) recovers one more electrode of geometry, and
then its position matters like any other. The montage is a matrix in
[decoder.ts](../lib/sense/decoder.ts), so this is a software choice the hardware should keep
open.

**HW-REF-01 Per ear reference and bias** (Must, true wireless)
- Requirement: each earbud carries its own REF and BIAS in the same ear, with no galvanic
  connection between the earbuds, and isolated from any charger while worn.
- Rationale: above.
- Verification: inspection; T-08.

**HW-REF-02 Shared reference provision in the wired prototype** (Must, Rev A)
- Requirement: the wired prototype can run in two configurations on the same person: one AFE
  for both ears with a shared reference, and two isolated, battery powered AFEs, one per
  ear, each with its own bias.
- Rationale: this is the only way to measure the true wireless penalty with dry in-ear
  contacts, including the electrical effects software re-referencing cannot reproduce.
- Verification: T-08.

**HW-REF-03 Montage left to software** (Must)
- Requirement: the earbud streams every sensing channel against REF, unmixed. No hardware
  averaging or re-referencing.
- Rationale: the montage, its electrode subset and its handling of a lost contact are
  software ([PROTOCOL.md](PROTOCOL.md), "Why the firmware is thin").
- Verification: inspection of the firmware and the HELLO channel labels.

---

## 4. IMU

Head orientation is the fast attention cue: the phone combines yaw with the decoder through a
von Mises prior around where the head points ([fusion.ts](../lib/sense/fusion.ts)), and the
earbud keeps its beam on the chosen talker while the head turns.

**HW-IMU-01 Sensor and rate** (Must)
- Requirement: 6 axis (3 axis accelerometer, 3 axis gyroscope), delivered at ≥ 100 Hz in SSP
  IMU frames (accel in milli g, gyro in 0.1 degree per second, quaternion; head frame x
  forward, y right, z down; [PROTOCOL.md](PROTOCOL.md)), each frame stamped on the earbud
  clock.
- Rationale: candidates and their published figures: Bosch BMI270, accelerometer 12.5 Hz to
  1.6 kHz and gyroscope 25 Hz to 6.4 kHz output rates, 685 µA at full rate
  ([Bosch](https://www.bosch-sensortec.com/en/products/motion-sensors/imus/bmi270/)); ST
  LSM6DSO, 0.55 mA accelerometer plus gyroscope in high performance mode
  ([ST](https://estore.st.com/en/lsm6dsotr-cpn.html)); ST LSM6DSV16BX, 0.95 mA in the same
  mode, with an embedded sensor fusion low power algorithm and features ST markets for true
  wireless earbuds ([ST](https://estore.st.com/en/lsm6dsv16bxtr-cpn.html)).
- Verification: T-09.

**HW-IMU-02 Orientation output** (Must)
- Requirement: a game rotation vector (quaternion, no magnetometer) in the head frame,
  computed by the IMU's fusion block or by firmware, with a per unit mounting rotation
  calibrated at manufacture so both earbuds report the same head. Yaw positive to the right,
  the sense of a STEER azimuth.
- Rationale: the SSP IMU frame carries this quaternion. Whether the LSM6DSV16BX fusion block
  outputs exactly this vector is to verify against its datasheet; with the BMI270 the
  firmware computes it.
- Verification: T-09 turntable.

**HW-IMU-03 Orientation accuracy** (Target)
- Requirement: yaw error ≤ 5° after a 90° turn and return; drift ≤ 2° per minute at rest after
  gyro bias estimation (both to verify as achievable with the chosen part).
- Rationale: talkers at a table are tens of degrees apart, and the fusion prior's width
  (kappa 2 in fusion.ts) assumes the yaw is right to well under that. Reference: BMI270 gyro
  noise density 0.007 dps/√Hz (Bosch, above).
- Verification: T-09.

**HW-IMU-04 Current** (Target)
- Requirement: ≤ 1 mA in the operating mode.
- Rationale: all three candidates above meet it on their published figures.
- Verification: T-12.

---

## 5. Microphones and the steered audio path

The phone never touches live audio. Each earbud steers its own microphones toward the talker
the phone names in a STEER command (azimuth in 0.1°, gain in 0.1 dB), keeps following that
talker as the head turns, and plays the result ([PROTOCOL.md](PROTOCOL.md), STEER). All
latency here is about how natural and comfortable the sound is.

**HW-MIC-01 Count and geometry** (Must and Target)
- Requirement (Must): ≥ 2 outward facing MEMS microphones per earbud, digital (PDM or TDM).
  (Target): 3, not collinear, to resolve azimuth in the horizontal plane without front and
  back confusion.
- Rationale: a two microphone endfire pair steers well only along its own axis. Spacing is
  bounded by the shell; spatial aliasing starts near c / 2d, about 11.4 kHz at 15 mm
  (arithmetic, c = 343 m/s).
- Verification: T-10 beam patterns.

**HW-MIC-03 A microphone facing the ear canal** (Target)
- Requirement: the signal of a microphone that faces into the canal (the feedback microphone
  that active noise cancelling already places there), at ≥ 8 kHz, available to the gesture
  logic on the earbud or on the phone as a 64 Hz energy envelope.
- Rationale: in labelled public recordings the commonest movement to set the clench detector
  off is swallowing (51% of swallows produced a false single at the temporal scalp), then
  raising the eyebrows (35%); talking, head turns and blinks stayed between 1 and 4%
  ([research/ext](../research/ext/README.md), PhysioMotion). A swallow and the wearer's own
  voice are loud in the occluded canal and silent on the outward microphones, and muscle
  signal is invisible to the IMU, so this is the cheapest sensor that can tell them from a
  clench. The electrodes cannot do it alone: on the same labelled recordings no feature the
  detector can compute as it goes (peak, duration, slow potentials, upper against lower
  contacts, spectral balance, symmetry) told a swallow from a clench burst (AUC at most 0.66
  each, 0.62 combined on people left out; keeping 95% of clenches would reject 1% of
  swallows), `research/ext/swallow_features.py`.
- Verification: T-13, with the canal envelope recorded alongside.

**HW-MIC-02 Microphone performance** (Must)
- Requirement: SNR ≥ 65 dB(A); acoustic overload ≥ 125 dB SPL; sensitivity matched within
  ±1 dB; ≤ 0.5 mA each in the operating mode.
- Rationale: small arrays amplify microphone self noise at low frequencies, so noise and
  matching set the beam. Candidates: Infineon IM72D128, 71.5 dB SNR, -36 ± 1 dB, 430 µA high
  performance and 160 µA low power ([Digi-Key](https://www.digikey.com/en/products/detail/infineon-technologies/IM72D128V01XTMA1/16730911),
  [release](https://www.electropages.com/2025/09/mems-microphone-lineup-delivers-best-class-audio-and-power-performance));
  TDK T5838, 68 dB SNR, 133 dB SPL overload, 330 µA high quality and 130 µA low power
  ([TDK](https://invensense.tdk.com/products/t5838/), [TDK news](https://invensense.tdk.com/news-media/tdk-introduces-worlds-lowest-power-PDM-microphone-with-acoustic-activity-detect/));
  Syntiant (formerly Knowles) SPH18R1LM4H-1, 68.5 dB SNR, 129 dB SPL overload, 470 µA
  ([audioXpress](https://audioxpress.com/news/knowles-debuts-trio-of-sisonic-mems-microphones-for-high-performance-tws-and-hearable-designs)).
  Infineon IM69D130 draws about 1 mA in normal mode (1.3 mA in its
  [Digi-Key listing](https://www.digikey.com/en/products/detail/infineon-technologies/IM69D130V01XTSA1/8030732);
  980 µA, 300 µA in low power mode, on Infineon's [XENSIV overview](https://www.digikey.es/en/product-highlight/i/infineon/xensiv-acoustic-sensors)),
  so it fails the current limit outside its low power mode.
- Verification: datasheet; T-10.

**HW-AUD-01 Steering runs in the earbud** (Must)
- Requirement: microphones to DSP to speaker entirely inside the earbud. The phone only writes
  STEER; the earbud maps the azimuth to the nearest talker it tracks and follows that talker
  with its own IMU, without the phone resending on every head movement.
- Rationale: sound cannot make a round trip through the phone in a few milliseconds. On
  Android the platform alone adds 30 to 100 ms and most Bluetooth audio latency comes from
  buffering in the headset ([Google Oboe note](https://github.com/google/oboe/wiki/TechNote_BluetoothAudio));
  one LC3 frame alone is 7.5 or 10 ms ([Bluetooth SIG](https://www.bluetooth.com/blog/a-technical-overview-of-lc3/)).
- Verification: T-10.

**HW-AUD-02 Hear-through delay** (Must and Target)
- Requirement (Must): acoustic delay of the steered path, outer microphone to the eardrum
  position of an ear simulator, ≤ 10 ms. (Target): ≤ 5 ms, and ≤ 2 ms if the fit leaks
  enough that direct and processed sound mix.
- Rationale, naturalness: listener studies of processing delay in ear worn devices. With
  sealed fittings, delays of 20 to 30 ms were rated disturbing ([Stone and Moore 1999](https://doi.org/10.1097/00003446-199906000-00002),
  [2002](https://doi.org/10.1097/00003446-200208000-00008)) and 9 ms was already more
  disturbing than none ([Stone and Moore 2003](https://doi.org/10.1097/01.AUD.0000058106.68049.9C)).
  Where processed sound mixes with sound leaking past the device, about 5 to 6 ms was rated
  just acceptable ([Stone et al. 2008](https://doi.org/10.1097/AUD.0b013e3181734ef2)), 3 to
  5 ms was noticed in most trials and more than 10 ms was judged objectionable 90% of the
  time ([Agnew and Thornton 2000](https://doi.org/10.1055/s-0042-1748062)), detection
  thresholds ranged from 0.1 to 8 ms ([Denk et al. 2021](https://doi.org/10.1121/10.0003064)),
  and delays below 2 ms were preferred ([Lelic et al. 2022](https://doi.org/10.1121/10.0014950)).
  An electrode tip has to seal for contact, which helps, but leakage is never zero.
- Verification: T-10.

**HW-AUD-03 Smooth changes** (Must)
- Requirement: gain changes ramp (target 50 to 300 ms); a change of steered talker crossfades;
  no clicks.
- Rationale: comfort. The phone's gain controller moves in steps toward the decoded talker,
  up to 9 dB of boost by default ([gain.ts](../lib/sense/gain.ts)).
- Verification: T-10 and a listening panel.

**HW-AUD-04 Fail safe to neutral** (Must)
- Requirement: with no STEER and no link for 10 s (target), ramp to gain 0 dB (natural
  hear-through). A DSP fault falls back to plain passthrough at neutral gain, never to a
  steered or silent ear.
- Rationale: the phone can vanish (app killed, out of range); the earbud must not hold the
  wearer in a steered state.
- Verification: T-10 fault injection.

**HW-AUD-05 Output level** (Must)
- Requirement: output level and sound dose limiting per IEC 62368-1 clause 10.6 and the EN
  50332 measurement methods (applicability to a hear-through product to confirm with the test
  lab).
- Rationale: [IEC 62368-1](https://webstore.iec.ch/en/publication/6932) carries the acoustic
  safeguards for personal music players ([EN IEC 62368-1 A11](https://evs.ee/en/evs-en-iec-62368-1-2020-a11-2020-consolidated));
  [EN 50332-1](https://genorma.com/en/standards/en-50332-1-2013) is the measurement method and
  [EN 50332-3](https://shop.standards.ie/en-ie/standards/en-50332-3-2017-353150_saig_cenelec_cenelec_805613)
  covers sound dose.
- Verification: test lab.

**HW-AUD-06 No audio in the EEG** (Must)
- Requirement: with speech playing at maximum output, the correlation between the played
  speech envelope and every EEG channel, after the band A chain, stays inside its null
  distribution.
- Rationale: the earbud plays the attended voice louder. Any electrical or magnetic coupling
  from the speaker or its driver into the contacts would hand the decoder the answer and fake
  its accuracy.
- Verification: T-06.

**HW-AUD-07 Talker envelopes** (Target, optional in SSP)
- Requirement: compute one speech envelope per tracked talker at 64 Hz from the earbud's
  microphones and send it as AUDIO_ENV.
- Rationale: lets the phone decode attention without raw audio leaving the earbud
  ([PROTOCOL.md](PROTOCOL.md)). Each envelope sample is stamped on the same clock as the
  EEG, its microphone and DSP delay compensated to within 10 ms: measured on recordings ([research/aad](../research/aad/README.md), hardware_bars.py, the final decoder on people it never saw): envelopes 25 ms
  late or early cost 1.3 to 2.4 points of one minute accuracy, 50 ms about four, 100 ms
  fifteen. Separation can be rough: each envelope with 70% of the other talker mixed in cost
  under a point, so what matters is that each envelope leans toward its own talker.
- Verification: compare with envelopes from a reference recording; measure the envelope to
  EEG delay with a click heard by the microphones and coupled into one electrode.

---

## 6. On-earbud processing

**HW-MCU-01 Thin firmware** (Must)
- Requirement: the firmware samples, timestamps, packetizes and obeys the five SSP commands,
  and nothing else: no filtering, decoding or gesture logic.
- Rationale: everything that changes lives in lib/sense and ships with the app; updating
  earbuds over the air is slow and risky ([PROTOCOL.md](PROTOCOL.md)).
- Verification: code review.

**HW-MCU-02 Timestamps** (Must)
- Requirement: the AFE runs from the same crystal as the frame clock, or each data ready edge
  is captured by a hardware timer on that clock; frame timestamps to 1 µs resolution;
  crystal within ±50 ppm (target).
- Rationale: the phone aligns the two earbuds by time to about 10 ms and fits each crystal's
  drift ([PROTOCOL.md](PROTOCOL.md), time sync). Measured on recordings ([research/aad](../research/aad/README.md), hardware_bars.py, the final decoder on people it never saw): an offset between the two earbuds'
  clocks cost nothing up to 20 ms, two points at 40 ms and seven at 80 ms, so 10 ms leaves
  twice the margin. The speech envelopes are stricter: late or early against the EEG by
  25 ms they cost 1.3 to 2.4 points and by 50 ms about four (HW-AUD-07).
- Verification: T-12 clock fit residuals.

**HW-MCU-03 Reference encoder conformance** (Must)
- Requirement: frames byte identical to [hardware/firmware/ssp.c](firmware/ssp.c) for the
  golden inputs.
- Rationale: the firmware and the phone are checked against each other, not each against
  itself (`hardware/firmware/build.sh`, `lib/sense/protocol.test.ts`).
- Verification: run the golden generator on target and diff.

**HW-MCU-04 Transmit queue** (Must)
- Requirement: at least 2 s of frames buffered (about 19 kB at 500 Hz); overflow drops the
  oldest frame, still counts it in seq, and sets DEVICE_DROP.
- Rationale: rides out lost connection events without breaking the timeline.
- Verification: T-12 with forced interference.

**HW-MCU-05 Commands and events** (Must)
- Requirement: SET_EEG_RATE switches between 250 and 500 Hz; STEER reaches the audio DSP
  within 10 ms; BATTERY every 10 s while streaming; WEAR on insertion and removal.
- Rationale: [PROTOCOL.md](PROTOCOL.md).
- Verification: T-12.

**HW-MCU-06 Secure update** (Must)
- Requirement: signed firmware images, secure boot, update over BLE.
- Rationale: RED cybersecurity requirements (HW-REG-03).
- Verification: test lab.

**HW-DSP-01 Audio DSP capacity** (Must)
- Requirement: enough DSP for a 2 to 3 microphone beamformer at ≥ 16 kHz sampling (24 to 48
  kHz preferred), gain, limiter and talker tracking, inside the HW-AUD-02 delay.
- Rationale: one candidate is the Cirrus Logic CS47L63, "a high-performance low-power audio
  DSP for earbud headphones" with a Halo Core DSP (3 cores, 450 MIPS, 672 kB), 4 inputs and a
  mono differential headphone driver ([Cirrus](https://www.cirrus.com/products/cs47l63/)),
  used on Nordic's [nRF5340 Audio DK](https://www.nordicsemi.com/Products/Development-hardware/nRF5340-Audio-DK).
  Whether it suffices is to verify on that kit.
- Verification: T-10 on the Audio DK, then on Rev A.

---

## 7. Bluetooth LE

**HW-BLE-01 Link** (Must)
- Requirement: Bluetooth LE 5.0 or later with LE 2M PHY and data length extension (251 byte
  link layer payload), ATT MTU 247 (244 byte notifications), one SSP frame per notification;
  each earbud an independent peripheral with its own connection ([PROTOCOL.md](PROTOCOL.md)).
- Rationale: 2M PHY arrived with Bluetooth 5 and data length extension with 4.2
  ([Novel Bits](https://novelbits.io/bluetooth-5-speed-maximum-throughput/),
  [Punch Through](https://punchthrough.com/maximizing-ble-throughput-part-3-data-length-extension-dle-2/));
  a 247 byte MTU leaves 244 bytes after the 3 byte ATT header (Novel Bits).
- Verification: T-12, with the negotiated parameters logged.

**HW-BLE-02 Throughput** (Must)
- Requirement: sustain the stream below with at least 2.5x headroom on reference Android and
  iOS phones, both earbuds connected.
- Rationale, per earbud, frames as full as MTU 247 allows ([PROTOCOL.md](PROTOCOL.md)
  throughput table):

| Stream | Raw payload | As SSP frames | Frames/s |
|---|---|---|---|
| EEG, 4 channels x 24 bit x 500 Hz | 6,000 B/s (48 kbit/s) | 6,500 B/s (18 samples per 234 B frame) | 27.8 |
| EEG at 250 Hz | 3,000 B/s | 3,250 B/s | 13.9 |
| IMU at 100 Hz (20 B per sample) | 2,000 B/s | 2,340 B/s (5 samples per 117 B frame) | 20 |
| AUDIO_ENV, 3 talkers at 64 Hz (optional) | 384 B/s | 480 B/s | 4 |
| EVENT, battery every 10 s | | 2 B/s | 0.1 |
| **Total at 500 Hz** | 8,384 B/s | **9,322 B/s (74.6 kbit/s)** | **52** |
| **Total at 250 Hz** | 5,384 B/s | **6,072 B/s (48.6 kbit/s)** | **38** |

  The 16 byte header and CRC plus per frame fields add 11% at 500 Hz. Realistic capacity:
  PROTOCOL.md budgets a 30 ms connection interval with 4 packets per event, 133
  notifications or about 32.5 kB/s per earbud, so 500 Hz uses 39% of the notifications and
  29% of the bytes. Punch Through reports about 50 KB/s achievable on newer iOS and Android
  phones with data length extension on the default 1M PHY
  ([Punch Through](https://punchthrough.com/maximizing-ble-throughput-part-4-everything-you-need-to-know/));
  both earbuds at 500 Hz need 18.6 kB/s of it. Nordic's throughput sample reaches 1504 kbps on
  2M PHY between two Nordic boards ([nRF Connect SDK](https://nrfconnectdocs.nordicsemi.com/ncs/latest/nrf/samples/bluetooth/throughput/README.html)),
  a ceiling no phone will give. One full notification occupies 1.4 ms of air on 2M PHY and
  2.5 ms on 1M (PROTOCOL.md), so 500 Hz keeps the earbud radio busy about 7% of the time on
  2M PHY.
- Verification: T-12. Note for test setup: the lib/sense Web Bluetooth transport runs in
  Chrome and Edge on desktop and Android, not in Safari or on iOS
  ([caniuse](https://caniuse.com/web-bluetooth)), so iPhone testing needs a native test app.

**HW-BLE-03 Link security and privacy** (Must)
- Requirement: LE Secure Connections pairing; the frames and commands characteristics
  require an encrypted, bonded link; resolvable private addresses.
- Rationale: EEG is neural data under the state laws in HW-REG-08; RED requires privacy
  safeguards for personal data ([RED Article 3(3)(e)](https://www.legislation.gov.uk/eudr/2014/53/article/3)),
  and EN 18031-2 covers wearable radio equipment that processes personal data
  ([In Compliance](https://digital.incompliancemag.com/issue/march-2026/reds-cybersecurity-requirements-update-en-18031-x2024/)).
- Verification: sniffer test: no frame readable without bonding.

**HW-BLE-04 Robustness** (Target)
- Requirement: frame loss ≤ 0.1% seated and ≤ 1% walking with the phone in a front pocket,
  over 1 h.
- Rationale: the phone inserts missing data for gaps instead of shifting samples
  ([PROTOCOL.md](PROTOCOL.md), loss), but every gap costs decoder evidence. The head shadows
  the link from one ear. Measured on recordings ([research/aad](../research/aad/README.md), hardware_bars.py, the final decoder on people it never saw): scattered 20 ms frames lost cost under a point up to 10% of
  all frames, and 200 ms bursts three points at 20%: the targets above are set by the clench,
  whose bursts last a few hundred milliseconds, not by attention.
- Verification: T-12.

**HW-BLE-05 RF exposure** (Must)
- Requirement: keep the available maximum time averaged power ≤ 1 mW so the FCC exemption
  applies at any separation, or else complete an SAR evaluation; confirm the method with the
  test lab.
- Rationale: [47 CFR 1.1307(b)(3)](https://www.law.cornell.edu/cfr/text/47/1.1307) exempts
  sources of no more than 1 mW time averaged regardless of distance. SAR limits are 1.6 W/kg
  over 1 g for the head and 4 W/kg over 10 g for extremities including the pinnae
  ([47 CFR 1.1310](https://www.law.cornell.edu/cfr/text/47/1.1310)). Arithmetic: the nRF5340
  transmits at up to +3 dBm, 2 mW ([Nordic](https://docs.nordicsemi.com/r/bundle/ps_nrf5340/page/keyfeatures_html5.html));
  at a 7% radio duty cycle that averages about 0.14 mW.
- Verification: test lab.

**HW-BLE-06 Coexistence** (Target)
- Requirement: the stream holds its loss target while the phone also runs Wi-Fi and, if the
  earbud plays music, the audio link.
- Rationale: Nordic lists the nRF5340 radio as Bluetooth LE and IEEE 802.15.4
  ([Nordic](https://docs.nordicsemi.com/r/bundle/ps_nrf5340/page/keyfeatures_html5.html)),
  with no Classic Bluetooth: it plays music over LE Audio but not over Classic A2DP. Music
  from phones without LE Audio needs a dual mode audio SoC ([BOM.md](BOM.md)), which then
  shares the radio with the SSP stream.
- Verification: T-12 with concurrent audio.

---

## 8. Power

**Attention mode** means steered hear-through on, EEG at 500 Hz, IMU at 100 Hz and BLE
streaming. **Sensing only** means the same without the audio path.

Estimate per earbud, attention mode, showing the arithmetic:

| Block | Basis | mW |
|---|---|---|
| AFE, ADS1294R, 4 channels | 4.1 to 5.4 mW at 3 V, low power to high resolution mode ([datasheet](https://www.ti.com/lit/ds/symlink/ads1294r.pdf)) | 5.4 |
| IMU, LSM6DSV16BX | 0.95 mA ([ST](https://estore.st.com/en/lsm6dsv16bxtr-cpn.html)) at an assumed 1.8 V | 1.7 |
| MCU and BLE stream, nRF5340 | radio active about 7% of the time (52 notifications/s x 1.4 ms) at 3.2 mA TX and 2.6 mA RX at 3 V ([Nordic](https://docs.nordicsemi.com/r/bundle/ps_nrf5340/page/keyfeatures_html5.html)) is about 0.7 mW; CPU, wakeups and AFE reads on top | 3.0 (estimate) |
| Audio path: microphones, DSP, speaker | cross check below | 25 (estimate) |
| Converter and PMIC losses | 10% of the above | 3.5 (estimate) |
| **Total** | | **38.6** |

Cross check for the audio path: AirPods Pro 2 are rated up to 6 h of listening with active
noise cancellation on, at 50% volume ([Apple](https://support.apple.com/en-us/111851)). iFixit
gives 0.16 Wh for the first generation AirPods Pro earbud cell
([iFixit](https://www.ifixit.com/Teardown/AirPods+Pro+Teardown/127551)). If the second
generation cell is similar (to verify), a complete shipping earbud averages about
160 mWh / 6 h, or 27 mW, including its Bluetooth audio stream. A steered hear-through path has
no audio stream but runs a beamformer; 25 mW is the planning figure until it is measured on
the nRF5340 Audio DK (T-12). It is the largest uncertainty in this table.

Runtime = usable energy / load, with 90% of nominal energy usable (estimate):

| Cell | Nominal | Usable | Attention mode (38.6 mW) | Sensing only (11.1 mW) |
|---|---|---|---|---|
| VARTA CP1254 A4, 74 mAh, 3.7 V ([Rapid](https://www.rapidonline.com/varta-88315101501-coinpower-button-cell-li-ion-3-7v-74mAh-rechargeable-08-0956)) | 274 mWh | 246 mWh | 6.4 h | 22 h |
| VARTA CP1254 A3, 60 mAh, 3.7 V ([VARTA folder](https://www.aperza.com/catalog/page/10007767/25628/)) | 222 mWh | 200 mWh | 5.2 h | 18 h |
| 0.16 Wh class cell (first generation AirPods Pro) | 160 mWh | 144 mWh | 3.7 h | 13 h |

Sensing only is (5.4 + 1.7 + 3.0) x 1.1 = 11.1 mW: the EEG and IMU chain is about 29% of
attention mode. Swapping in the AFE159RP4 (about 1.7 mW) brings attention mode to 34.5 mW,
7.1 h on 74 mAh. An ADS1299-4 at 22 mW behind a boost converter (85% efficient, estimate)
brings it to 61 mW, 4.0 h on 74 mAh: fine for a bench prototype, wrong for the earbud.
Halving the EEG rate to 250 Hz saves little power: delta sigma AFE power does not scale much
with output rate, and the radio share is already small. The rate choice is about air time.

**HW-PWR-01 Runtime** (Must and Target)
- Requirement: attention mode ≥ 4 h per charge (Must), ≥ 5 h (Target).
- Rationale: the estimate above; the client brief asked for at least 5 h per charge and set
  the prototype gate at more than 4 h ([AGENT_BRIEF](../AGENT_BRIEF_ear-attention-interface.md),
  section 3.4).
- Verification: T-12 rundown test.

**HW-PWR-02 Sensing chain budget** (Target)
- Requirement: AFE, IMU, MCU and BLE together ≤ 10 mW average at 500 Hz, before converter
  losses.
- Rationale: keeps sensing under a third of attention mode.
- Verification: T-12 per block current.

**HW-PWR-03 Cell** (Must)
- Requirement: a Li-ion coin cell of the 60 to 75 mAh class (12 mm diameter class), certified
  to IEC 62133-2 and UN 38.3 (HW-REG-04); charging only inside the cell's temperature window.
- Rationale: VARTA's CoinPower range spans 29 to 145 mAh ([VARTA](https://www.varta-ag.com/en/industry/product-solutions/lithium-ion-button-cells));
  the CP1254 A4 is 74 mAh in 12.1 x 5.4 mm (Rapid, above); Grepow's GRP1254 family is 68 to
  96 mAh by variant in 12 x 5.4 mm and charges at 0 to +45 °C ([Grepow](https://www.grepow.com/button-cell-battery/grp1254-g1-75mah.html)).
- Verification: cell certificates.

**HW-PWR-04 Case** (Target)
- Requirement: the case recharges both earbuds at least 3 times.
- Rationale: benchmark: Apple rates AirPods Pro 2 at 6 h per charge and 30 h with the case
  ([Apple](https://support.apple.com/en-us/111851)).
- Verification: rundown test.

**HW-PWR-05 Low battery behaviour** (Target)
- Requirement: at 20% the phone lowers the EEG rate to 250 Hz; at 10% it stops EEG and keeps
  hear-through and IMU; at cutoff the earbud ramps audio to neutral and shuts down cleanly.
- Rationale: hear-through is what the wearer notices; EEG is the slow channel.
- Verification: T-12.

---

## 9. Mechanical

**HW-MECH-01 Contact force** (Must)
- Requirement: enough force for HW-EEG-04 and HW-EEG-05 while comfortable for ≥ 2 h of
  continuous wear (Must) and ≥ 4 h (Target). The pressure target is set from T-03 and T-05
  data (no verified literature value yet: to verify).
- Rationale: dry contact quality and comfort pull in opposite directions; the number has to
  come from our own panel.
- Verification: comfort panel of ≥ 10 people; T-03, T-05.

**HW-MECH-02 Tip sizes** (Must)
- Requirement: at least 3 tip sizes, every size carrying its contacts, user replaceable, with
  a keyed electrical connection to the shell.
- Rationale: HW-EEG-08.
- Verification: inspection; T-05 across sizes.

**HW-MECH-03 Retention** (Must)
- Requirement: stays seated through walking, chewing, talking and head turns.
- Rationale: HW-EEG-05.
- Verification: T-05.

**HW-MECH-04 Sweat and ingress** (Must and Target)
- Requirement: IPX4 (protected from splashing water) Must; IP54 (dust protected, splashing
  water) Target, per IEC 60529; contacts and their connections survive artificial sweat.
- Rationale: [IEC 60529](https://webstore.iec.ch/en/publication/2452) defines the codes
  ([digit meanings](https://www.interpower.com/ic/designers/designing-for-export/guides-and-charts/IP-Ingress-Protection-Codes.html)).
  Sweat is salty: Ag/AgCl is at home in chloride, bare silver and many plated metals are not.
- Verification: test lab; T-11.

**HW-MECH-05 Durability** (Target)
- Requirement: tips survive ≥ 1000 insertions with impedance staying within 2x of new.
- Rationale: coatings wear; the tip is the consumable.
- Verification: T-11.

**HW-MECH-06 Layout separation** (Must)
- Requirement: electrode traces guarded or shielded and routed away from the antenna, the
  speaker and its driver, and the PMIC inductor.
- Rationale: HW-AFE-12 and HW-AUD-06. Kappel et al. 2019 used actively shielded electrodes.
- Verification: T-01, T-06.

---

## 10. Environmental

**HW-ENV-01 Temperature** (Target, to verify against the chosen cell)
- Requirement: operating 0 to 40 °C ambient; charging 0 to 45 °C (the GRP1254 window,
  [Grepow](https://www.grepow.com/button-cell-battery/grp1254-g1-75mah.html)); storage -20
  to 45 °C.
- Verification: chamber test.

**HW-ENV-02 Humidity** (Target)
- Requirement: 10 to 95% RH, non condensing.
- Verification: chamber test.

**HW-ENV-03 ESD** (Must)
- Requirement: IEC 61000-4-2 at the contacts and charging pads, target levels ±8 kV contact
  and ±15 kV air (levels to verify with the test lab), with input protection adding ≤ 1 nA of
  leakage at the AFE inputs.
- Rationale: the electrodes are exposed conductors in a skin contact device; HW-AFE-06.
- Verification: test lab; T-01 after ESD.

**HW-ENV-04 Mains environment** (Must)
- Requirement: HW-AFE-12 holds in a typical office and home, not only on the bench.
- Verification: T-02, in situ.

---

## 11. Safety, regulatory and privacy

> **Regulatory note.** Signalive is a consumer audio product. It must not be marketed,
> labelled or described with medical claims: nothing that says or implies that it diagnoses,
> treats, monitors, prevents or compensates for any medical or hearing condition. Audio
> steering is described as comfort and focus. Claims of that kind would make it a medical
> device (FDA in the US, Regulation (EU) 2017/745 in the EU) and change every assumption in
> this document. For reference, FDA's general wellness guidance (revised 6 January 2026)
> keeps low risk products outside device regulation only while they avoid references to
> diseases, clinical conditions or diagnostic thresholds
> ([FDA](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices),
> [summary](https://www.cov.com/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products)).

**HW-REG-01 Radio certification** (Must)
- Requirement: FCC Part 15, including [15.247](https://www.law.cornell.edu/cfr/text/47/15.247)
  for 2.4 GHz digital modulation; EU Radio Equipment Directive 2014/53/EU, whose Article 3
  covers health and safety, EMC and spectrum use ([text](https://www.legislation.gov.uk/eudr/2014/53/article/3)),
  with the harmonised standards for 2.4 GHz radios and radio EMC (EN 300 328 and EN 301 489,
  editions to confirm with the test lab); Bluetooth SIG qualification and listing.
- Verification: accredited test lab.

**HW-REG-02 RF exposure** (Must)
- Requirement: HW-BLE-05. Portable devices are those used within 20 cm of the body
  ([47 CFR 2.1093](https://www.law.cornell.edu/cfr/text/47/2.1093)); exemption guidance in
  [FCC KDB 447498](https://apps.fcc.gov/oetcf/kdb/forms/FTSSearchResultPage.cfm?id=20676&switch=P).
- Verification: test lab.

**HW-REG-03 Cybersecurity** (Must)
- Requirement: meet RED Delegated Regulation (EU) 2022/30 through EN 18031-1 and EN 18031-2:
  no default passwords, secure update, protected personal data.
- Rationale: 2022/30 applies to wearable radio equipment and became applicable on 1 August
  2025 ([UK factsheet](https://www.gov.uk/government/publications/radio-equipment-regulations-2017/regulation-eu-202230-factsheet)).
  The EN 18031 series was listed in the Official Journal on 30 January 2025
  ([CETECOM](https://cetecomadvanced.com/en/news/red-cybersecurity-standard-en-18031-harmonized/)).
  Delegated Regulation 2026/339 repeals 2022/30 with effect from 11 December 2027, when the
  Cyber Resilience Act takes over ([European Commission](https://single-market-economy.ec.europa.eu/sectors/electrical-and-electronic-engineering-industries-eei/radio-equipment-directive-red_en));
  plan for the CRA from Rev B.
- Verification: test lab; HW-BLE-03, HW-MCU-06.

**HW-REG-04 Battery** (Must)
- Requirement: cells and packs to [IEC 62133-2:2017](https://webstore.iec.ch/en/publication/32662)
  (consolidated with Amendment 1:2021); UN 38.3 transport tests T.1 to T.8
  ([summary](https://testxchange.com/magazine/un-383-testing-and-certification-for-lithium-ion-batteries)),
  required for US transport by [49 CFR 173.185](https://www.law.cornell.edu/cfr/text/49/173.185).
- Verification: supplier certificates; pack tests at the lab.

**HW-REG-05 Product safety** (Must)
- Requirement: [IEC 62368-1](https://webstore.iec.ch/en/publication/6932) (audio, video and
  ICT equipment), including the acoustic safeguards of clause 10.6 (HW-AUD-05).
- Verification: test lab.

**HW-REG-06 Biocompatibility** (Must)
- Requirement: every skin contact material (contacts, tips, shell) evaluated within a risk
  management process per [ISO 10993-1:2025](https://connect.snv.ch/en/iso-10993-1-2025) and
  tested for cytotoxicity ([ISO 10993-5:2009](https://connect.snv.ch/en/iso-10993-5-2009)),
  skin sensitisation ([ISO 10993-10:2021](https://connect.snv.ch/en/iso-10993-10-2021)) and
  irritation ([ISO 10993-23:2021](https://connect.snv.ch/en/iso-10993-23-2021)). Nickel
  release from any metal in prolonged skin contact checked against EU REACH (limit and test
  method to verify).
- Rationale: ISO 10993 is written for medical devices; it is used here as the recognised
  method for prolonged skin contact, not as a medical claim. Prolonged, daily contact in the
  ear canal is the worst case. Note that Wacker states its conductive LR 3162 silicone does
  not comply with pharmaceutical and food regulations ([Wacker](https://www.wacker.com/h/en-us/c/elastosil-lr-3162-ab/p/000009484)),
  so a material's datasheet is never a substitute for testing the finished tip.
- Verification: accredited biocompatibility lab, on finished parts.

**HW-REG-07 Electrical safety at the skin** (Must)
- Requirement: no conductive path from any charger to the contacts while worn (charging only
  in the case); DC currents into the skin limited (HW-AFE-08; lead off at nanoampere level,
  HW-EEG-06).
- Verification: design review; fault tests.

**HW-REG-08 Neural data privacy** (Must)
- Requirement: EEG stays on the phone by default. The earbud keeps no EEG beyond its transmit
  queue, the link is encrypted (HW-BLE-03), and nothing leaves the phone without the wearer's
  explicit opt in.
- Rationale: recorded EEG is "neural data" in a growing set of US laws:
  - Colorado [HB24-1058](https://leg.colorado.gov/bills/hb24-1058): approved 17 April 2024,
    effective 7 August 2024; neural data is biological data, sensitive when used for
    identification purposes.
  - California [SB 1223](https://calmatters.digitaldemocracy.org/bills/ca_202320240sb1223):
    chaptered 28 September 2024 (Chapter 887); neural data is sensitive personal
    information under the CCPA, in force from 1 January 2025 ([FPF](https://fpf.org/?p=246546)).
  - Since then: Montana SB 163, effective 1 October 2025 ([BillTrack50](https://www.billtrack50.com/billdetail/1749178), [FPF](https://fpf.org/?p=246546));
    Connecticut SB 1295, Public Act 25-113, effective 1 July 2026
    ([summary](https://www.recordinglaw.com/news/connecticut-data-privacy-law-2026-amendments));
    Delaware HB 380, signed 2 September 2026, effective 1 January 2027
    ([Delaware](https://legis.delaware.gov/BillDetail/143105)); Vermont S.71, Act 145,
    effective 1 January 2028 ([Vermont](https://legislature.vermont.gov/bill/status/2026/S.71));
    California AB 1883, restricting employers' collection of neural data, effective 1 January
    2027 ([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/california-enacts-new-restrictions-on-ai-based-employee-monitoring)).
- Verification: privacy review of firmware, app and any server, before the first external
  user.

**HW-REG-09 People in tests** (Must)
- Requirement: every recording with people runs under informed consent and, where
  applicable, ethics approval; recordings are handled under HW-REG-08.
- Verification: consent records.

---

## 12. Bench test plan

Record every test as SSP streams through lib/sense, so the phone code that ships is the code
that is tested. People counts are minimums.

| ID | Test | Verifies | Method | Pass |
|---|---|---|---|---|
| T-01 | Shorted input noise and coupling | HW-AFE-02, -05, -10, -11, -12 | Inputs shorted to REF at the connector, then through a dry contact phantom (1 MΩ per input, 500 kΩ imbalance), then with a ±300 mV DC source in series. 10 min at 250 and 500 SPS. Report rms over 0.5 to 100 Hz, band A and band C, and the spectrum. Repeat with BLE streaming at full rate, audio at maximum level, all converters on, at 3.0, 3.7 and 4.2 V. | HW-AFE-02 limits; no line above 0.5 µVrms in 1 to 120 Hz |
| T-02 | Common mode and mains | HW-AFE-07, -08, HW-ENV-04 | 50 and 60 Hz common mode injected through an imbalance network, bias drive on and off; then worn in an office and a home | ≥ 80 dB system rejection with bias on |
| T-03 | Contact impedance | HW-EEG-04, -07, HW-MECH-01 | 20 people, every contact, magnitude at 10 Hz and 50 Hz (sweep 1 Hz to 1 kHz where the equipment allows), at 0, 5, 30 and 120 min, dry skin and after exercise | ≥ 80% of people per tip size within limits |
| T-04 | Lead off | HW-EEG-06 | Lift each contact in turn; 1 h of normal wear for false alarms | Detected within 1 s; no false alarm in 1 h |
| T-05 | Motion, chewing and talking | HW-EEG-05, HW-MECH-03 | 10 people: rest 5 min, talking 5 min, chewing gum 5 min, treadmill walking 10 min, head turns 2 min, while a cEEGrid on the Cyton records alongside where geometry allows | No lead off; impedance within 2x; artifact power reported per activity |
| T-06 | Audio in the EEG | HW-AUD-06 | Speech at maximum output for 10 min; contacts on a saline or resistor phantom; envelope correlation with each channel after the band A chain, against a permutation null | Inside the 95% null |
| T-07 | Attention decoding | HW-EEG-01, -02, section 3 | Two audiobooks at once, left and right, 3 x 10 min per person as in ds004015, 20 people (10 minimum); the research/aad pipeline unchanged; compare with the MEASURED table; candidate layouts A and B | Reported against the cEEGrid numbers, per person and on average |
| T-08 | Split ground | HW-REF-01, -02 | Same people, two configurations: one AFE with a shared reference, and two isolated battery AFEs, one per ear | The decision rule of section 3 applied to dry in-ear data |
| T-09 | IMU | HW-IMU-01 to -03 | Output rate and timestamp jitter; turntable 90° turns; 10 min at rest; axis and sign check against PROTOCOL.md | HW-IMU-03 limits; yaw positive to the right |
| T-10 | Steered audio | HW-MIC-01, -02, HW-AUD-01 to -04, HW-DSP-01 | Ear simulator: delay by impulse and swept sine; beam pattern at 0, ±30, ±60, ±90°; gain ramps; STEER loss and DSP fault injection | HW-AUD-02 limits; neutral within 10 s of link loss |
| T-11 | Sweat and wear | HW-EEG-03, HW-MECH-04, -05 | Artificial sweat soak with impedance before and after; 1000 insertion cycles | Impedance within 2x of new |
| T-12 | Link and power | HW-BLE-01 to -06, HW-MCU-02 to -05, HW-PWR-01 to -05 | Both earbuds streaming at 500 Hz to a reference Android phone (Chrome) and an iPhone (native test app) for 1 h: loss, gaps, clock fit residuals, negotiated parameters; per block current with a power profiler; rundown in attention mode; concurrent audio | HW-BLE-02 headroom, HW-BLE-04 loss, HW-PWR-01 runtime |
| T-13 | Clench detection | Band C chain end to end | 20 people. Per person 50 single, 20 double and 20 hold clenches, seated and walking; then 1 h free living (talking, eating, chewing gum, laughing). lib/sense `ClenchDetector` unchanged, at 250 and 500 Hz. The trial's Studies, clench (`/studies/clench`) runs this protocol (60 cues over four conditions and a free period) and saves the raw signal | True detection > 95% and false positives < 1 per hour, the client brief's gate ([AGENT_BRIEF](../AGENT_BRIEF_ear-attention-interface.md), Phase 2). Public recordings already show singles and holds failing the false bar in quiet listening (5.6 an hour at k = 4) while doubles stay under it (0.11 an hour), and false doubles 20 to 50 times rarer than false singles in every recording ([research/ext](../research/ext/README.md)) |

---

## 13. Open items and numbers to verify

- AFE159RP4: full datasheet from TI (input impedance, bias current, lead off, bias drive,
  conditions behind 0.42 mW per channel and 4 µVpp).
- Audio path power: measure on the nRF5340 Audio DK; the 25 mW planning figure rests on an
  assumed AirPods Pro 2 cell energy.
- Contact pressure and comfort target (HW-MECH-01): no verified literature value.
- Kappel and Kidmose 2015: the exact frequencies behind "low" and "high" frequency impedance.
- Whether the LSM6DSV16BX fusion block outputs the game rotation vector SSP expects.
- IMU drift achievable (HW-IMU-03); ESD and temperature levels (HW-ENV-01, -03) with the test
  lab; nickel release limit under REACH.
- RF exposure method and harmonised standard editions, with the test lab.
- Applicability of IEC 62368-1 clause 10.6 and EN 50332 to a hear-through product.
- The MEASURED table, filled by the lead from research/aad/results.json, and the decision
  rule in section 3 confirmed.
