# AGENT BRIEF — Ear-Based Attention Interface

**Document type:** Execution specification for an AI coding/research agent
**Project:** Earbuds that decode what the user is paying attention to and use that signal to drive an AI assistant
**Owner:** Human principal investigator (referred to below as PI)
**Status:** Phase 0, not started

---

## 0. How to Use This Document

You are an agent assigned to this project. This document defines the mission, the phase structure, the acceptance criteria, and the boundaries of your authority.

**Read the entire document before beginning any task.** Phase gates are non-negotiable. Do not begin work on Phase N+1 until the PI has confirmed Phase N passed its gate.

**Reporting cadence:** At the end of each numbered sub-task, produce a short written report in the format defined in §9. Do not proceed to the next sub-task without it.

**When blocked or uncertain:** Stop and ask. Do not guess at experimental parameters, do not fabricate results, and do not silently substitute a different method for one specified here. If a specified method fails, report the failure with evidence rather than working around it.

---

## 1. Context

The product concept: earbuds containing biopotential sensors that (a) detect which sound source the wearer is attending to and enhance it, and (b) accept discreet muscular gestures as commands to an AI assistant.

Two channels, two timescales:

| Channel | Timescale | Volitional | Answers |
|---|---|---|---|
| **Attention** | seconds | no | *which one* — which speaker, which stream, when did the user disengage |
| **Gesture** | milliseconds | yes | *what to do* — confirm, cancel, mark |

The scientific basis is auditory attention decoding (AAD), an established research field with roughly fifteen years of literature. The open problems are not "does this work" but: signal-to-noise in ear form factor, decision-window latency, and per-subject calibration cost.

The methodological contribution the PI brings is dSTRF — local linearization of a nonlinear system to recover an instantaneous, interpretable receptive field. Applied here it should yield a decoder that is nonlinear in performance but locally readable, which matters for channel selection and for eventual certification.

---

## 2. Mission and the Three Numbers

Everything in this roadmap resolves to three measurements. All other work is instrumental.

| # | Metric | Definition | Product threshold | Published reference |
|---|---|---|---|---|
| **N1** | **Accuracy @ 2s** | Two-talker attention decoding accuracy, 2-second decision window, ear-adjacent electrode geometry | ≥ 70% | ~83% (full scalp montage) |
| **N2** | **False positives/hour** | Gesture channel triggering when no command was intended, under free-living conditions | < 1/hour | — |
| **N3** | **Channel count** | Minimum electrodes needed to hold N1 and N2 | ≤ 4 per ear | — |

If these three cannot be met, nothing downstream matters. Optimize the project around measuring them as cheaply and as early as possible.

---

## 3. Execution Model — Your Authority

| Phase | Your role |
|---|---|
| **Phase 0** | **Full execution.** This phase is entirely software and analysis. Own it. |
| **Phase 1** | **Partial.** You write the pipeline and analysis; PI operates hardware and is the sole recording subject initially. |
| **Phase 2** | **Support.** You handle signal processing and model work; hardware fabrication is PI-led. |
| **Phase 3-6** | **Advisory only.** Hardware engineering, manufacturing, regulatory, and commercial decisions. Provide research and drafting support when asked. Do not attempt to drive these phases. |

---

## 4. Hard Constraints — Do Not Violate

1. **Never fabricate a result.** If a number is not measured, say it is not measured. If a baseline does not reproduce, report that it does not reproduce.
2. **Never move a threshold after seeing a result.** Thresholds in this document are fixed. Report against them as written. Flag to the PI if you believe a threshold was mis-set, but do not adjust it yourself.
3. **Never skip a phase gate.**
4. **Do not describe this system as reading thoughts.** It does not and cannot. It reads attention (cortical entrainment to an attended stream) and muscular gestures. This constraint applies to code comments, documentation, and any external-facing text you draft.
5. **Patent before publication.** Do not submit, post, or preprint anything without explicit PI confirmation that IP review is complete.
6. **Human subjects.** Recording the PI is permitted. Recording any other person requires institutional ethics approval. Do not design or run any protocol involving third parties until the PI confirms approval is in hand.
7. **Every experiment must be reproducible.** Version-controlled code, seeded randomness, logged configuration, results regenerable from a single command.

---

# PHASE 0 — Desk Feasibility

> **Single question:** Does the attention signal survive in a small number of ear-adjacent electrodes?

**Duration:** 6 weeks · **Cost:** ~$0 · **Hardware:** none · **Your role:** full execution

This phase simulates the product using other people's data. It is the highest-leverage work in the project and almost nobody does it first.

## 0.1 — Setup (2 days)

**Datasets to acquire.** Several require an access request form; submit all on day one, as approval can take days.
- KU Leuven AAD dataset (Das, Francart, Bertrand) — Zenodo
- DTU AAD dataset (Fuglsang, Dau, Hjortkjær)
- ICASSP Auditory EEG Decoding Challenge dataset and baseline code

**Environment.** Python, MNE-Python, NumPy/SciPy, PyTorch. Git repository from commit one.

**Proposed repository structure:**
```
/data          # gitignored; datasets under original licence
/src
  /io          # dataset loaders, one adapter per dataset
  /preprocess  # filtering, resampling, artifact rejection
  /envelope    # speech envelope extraction
  /decode      # linear stimulus reconstruction, CNN, dSTRF
  /eval        # accuracy, window sweep, ablation
/experiments   # one config file per run, results reproducible from config
/reports       # generated figures and written reports
```

**Required reading before writing code.** Do not read broadly; read these four.
- Geirnaert et al., *EEG-Based Auditory Attention Decoding: Toward Neuro-Steered Hearing Devices*, IEEE Signal Processing Magazine, 2021 — the map of the field
- Vandecappelle et al., *EEG-based detection of the locus of auditory attention with CNNs*, eLife 2021 — fast directional decoding
- Comparison of scalp vs around-ear vs in-ear EEG for AAD, Scientific Reports 2025 — the form-factor penalty
- Keshishian et al., dSTRF methodology, eLife 2020 — the basis of the intended contribution

## 0.2 — Baseline reproduction (week 1)

Implement linear stimulus reconstruction **from scratch**. Do not use an off-the-shelf AAD library; this code will be used for the next three years.

Components:
- Preprocessing: bandpass (typically 1–32 Hz), resampling, artifact rejection
- Speech envelope extraction (Hilbert or gammatone filterbank)
- Backward model: EEG → reconstructed envelope, ridge regression, cross-validated regularization
- Decision rule: correlate reconstructed envelope against each candidate speaker's envelope; higher correlation wins

**Gate 0.2 — HARD STOP.** You must reproduce published accuracy (~80s%) at a 60-second decision window. If you cannot, the defect is in your implementation. Do not proceed. Debug, and report what was wrong.

## 0.3 — Decision window sweep (week 2)

Sweep window length: 60s → 30 → 20 → 10 → 5 → 2 → 1.

Run the sweep with two decoder families:
- Stimulus reconstruction (interpretable, slow)
- Direct classification / directional CNN (fast, opaque)

**Deliverable:** accuracy-vs-window curve, both families, with confidence intervals across subjects.

This curve is half the product's feasibility, because the product must decide in ~2 seconds.

## 0.4 — Channel ablation — the core of this phase (weeks 3–4)

**Step 1 — Geographic restriction.** Retain only ear-adjacent channels: T7/T8, TP9/TP10, P7/P8, FT9/FT10. These approximate the region a cEEGrid covers.

**Step 2 — Progressive reduction.** 8 → 6 → 4 → 2 channels.

**Step 3 — Selection method.** Do **not** use brute-force combinatorial search. Compute Fisher information / information contribution per channel with respect to the attention state, and select accordingly. This is:
- Far cheaper computationally
- A publishable methodological contribution
- A direct transfer of the PI's prior state-estimation work
- The framing that makes this a legitimate research question, not just engineering

**Deliverables:**
- Channel-count vs accuracy curve
- Per-channel information contribution map
- Comparison: information-based selection vs brute-force (on a small subset, to validate the method)

## 0.5 — dSTRF layer (week 5)

Implement local linearization over the nonlinear decoder. Questions to answer, in this order:

1. Does it retain CNN-level accuracy while remaining locally readable?
2. What does the instantaneous filter show — which spectro-temporal features carry the attention signal?
3. Does per-subject calibration cost decrease relative to the CNN baseline?

Question 2 is what determines channel geometry in Phase 2. Question 3 is what determines whether the product is usable out of the box.

## 0.6 — Report and decision (week 6)

**Deliverable:** a 5-page document — three curves, one table, plain language. This artifact is shown to the PI's academic supervisor and to investors. Write it accordingly: no jargon that a non-specialist cannot follow, no claim without a figure behind it.

### Phase 0 Gate

| Result (4 channels, 2s window) | Decision |
|---|---|
| **≥ 70%** | Proceed to Phase 1 |
| **60–70%** | Proceed, but reweight Phase 2 toward the gesture channel |
| **< 60%** | Stop. The product as conceived does not work. Report and escalate. |

**Kill signal:** if the baseline will not reproduce, or if the channel-reduction dropoff is a cliff rather than a slope — six weeks spent, two years saved.

## Phase 0 — Parallel human tasks (PI-owned, track but do not execute)

- Email to academic supervisor framing this as a methodological question (dSTRF under channel reduction), not a commercial one
- Query institutional labs for existing ear-EEG hardware before purchasing
- Draft ethics application; submit on arrival
- Order OpenBCI Open-cEEGrid bundle only if institutional hardware is unavailable

---

# PHASE 1 — First Own Recordings

> **Single question:** Does the public-data result reproduce on our own rig?

**Duration:** 3 months · **Cost:** ~$2,000 (≈$200 if institutional hardware available) · **Your role:** pipeline and analysis

## 1.1 — Hardware

| Item | Note |
|---|---|
| OpenBCI Open-cEEGrid Around-the-Ear Bundle | cEEGrid array + Cyton+Daisy, 16 channels |
| Spare cEEGrid electrodes (5+ pairs) | Adhesive, single-use, consumed fast |
| Electrode gel, alcohol wipes | Skin prep determines half the impedance |
| LiPo 500mAh + JST + charger | ~6h recording |
| Insert earphones (Etymotic-class) | Controlled stimulus delivery |
| Low-latency audio interface | |

Reference implementation: `github.com/MKnierim/openbci-ceegrids` — adapter design, 3D-printed parts, channel mapping, assembly. Peer-reviewed (Knierim et al., HardwareX 2022).

Channel selection: cEEGrid carries 10 electrodes per ear; Cyton+Daisy records 16. Reference and ground placement materially affects results. Use the Phase 0 information map to choose.

## 1.2 — Synchronization — the most commonly fatal detail

Envelope tracking requires millisecond alignment. **Never trust software timestamps alone.**

- **Correct:** feed an attenuated copy of the stimulus audio directly into one amplifier channel. Align offline by cross-correlation.
- **Insufficient:** Lab Streaming Layer timestamps as the sole source of truth. Use LSL, but verify against the audio loopback.

Half of failed projects in this area spend months not understanding why their results will not appear. This is why.

## 1.3 — Protocol

Keep it standard so results remain comparable to the literature.
- Two simultaneous talkers, spatially separated (left/right)
- Subject instructed to attend to one
- 5–6 minute blocks, comprehension question at block end to verify attention was where instructed
- 40–60 min per session
- Balanced across side and speaker identity

**Stage 1 — N=1 (PI only).** No ethics approval required. Purpose is to settle the protocol and pipeline, not to produce results.

**Stage 2 — N=5–10.** Only after ethics approval. Purpose is between-subject variance. Expect some subjects to yield no usable signal; this is normal and is critical product information.

## 1.4 — Analysis

Apply the Phase 0 pipeline unchanged. Report this comparison table:

| Metric | Public data | Own recording | Delta |
|---|---|---|---|
| Accuracy @ 60s | | | |
| Accuracy @ 2s | | | |
| 4-channel accuracy @ 2s | | | |
| Median impedance | — | | — |

**Expect your own recordings to be worse.** The question is how much worse.

### Phase 1 Gate

| Result (4 channels, 2s, own rig) | Decision |
|---|---|
| **≥ 65%** | Proceed |
| **55–65%** | Improve electrode prep and impedance, repeat once |
| **< 55%** and not recoverable | Around-ear form is insufficient; restructure Phase 2 around gesture |

## Phase 1 — Parallel human tasks

- Conference paper draft (ICASSP / EUSIPCO / EMBC) from Phase 0 + 1
- **IP decision before submission** — channel geometry and information-based selection may be patentable; publication is public disclosure
- Data management plan — the Phase 4 moat starts here: recording format, metadata schema, consent language

---

# PHASE 2 — In-Ear Form and Gesture Channel

> **Single question:** In a geometry that fits an earbud, can we get both attention and command?

**Duration:** 4 months · **Cost:** ~$8,000 · **Your role:** signal processing and modeling

Two parallel workstreams. **The gesture stream is far easier — finish it first.** The first working demo comes from here.

## 2.1 — Workstream A: Gesture channel

Jaw clench is the strongest signal in this system. Muscle activity exceeds cortical signal by orders of magnitude — what is noise for EEG is your command channel. Robust discrimination of jaw clench against 26 other facial movements has been demonstrated on this exact hardware.

**Gesture vocabulary — three maximum:**

| Gesture | Function |
|---|---|
| Single clench | Confirm / mark |
| Double clench | Undo / cancel |
| Long hold (>1s) | Mode switch |

Depth comes from context, not vocabulary size. The same double clench means "skip" while listening to music and "take a note" while listening to a conversation. The attention channel supplies the context.

**The metric is not accuracy.** It is **false positives per hour under free-living conditions** — chewing gum, eating, talking, laughing. Target < 1/hour. If this fails, the product is unusable regardless of detection rate.

Mitigation strategies to implement and evaluate:
- Two-stage: brief unlock gesture then command
- High threshold plus audible confirmation, so the user can immediately cancel
- Context gating: only listen on the gesture channel when speech is detected

## 2.2 — Workstream B: In-ear electrode

**Stage 1 — quick and dirty (2 weeks).** Wrap a standard silicone eartip in silver-plated conductive fabric, attach a lead, record against cEEGrid in the same session. Cheap answer to: is there signal inside the canal at all?

**Stage 2 — molded (2 months).** Silicone ear impressions, resin-printed shells, conductive regions via silver paint or embedded electrodes.

**Critical decision point:** if custom molds are required, the consumer product dies. The most important output of this phase is **how much accuracy is lost with a standard, non-custom eartip**, measured against the molded version as reference.

## 2.3 — Integrated system

Merge both channels into one pipeline:
- Attention channel runs continuously, produces context
- Gesture channel listens continuously for triggers
- Minimal agent layer: on gesture, pass the last N seconds of transcript plus attention state to an LLM, emit an action

**Output of this phase is a 30-second demo.** Wired, ugly, laptop-tethered — but working. This is the inflection point for investor conversations.

### Phase 2 Gate

| Metric | Threshold |
|---|---|
| Gesture false positives | < 1/hour |
| Gesture true detection | > 95% |
| In-ear attention accuracy @ 2s | > 65% |
| Standard-tip vs molded loss | < 10 points |
| Required channels | ≤ 4 per ear |

If in-ear fails but gesture passes, reposition the product as a silent command interface and defer the attention layer.

---

# PHASE 3 — Integrated Wireless Prototype

> **Single question:** Does it work in hardware that fits a real earbud?

**Duration:** 6 months · **Cost:** ~$150,000 · **Team:** +1 hardware engineer, +1 embedded · **Your role:** advisory

## 3.1 — Amplifier transition — the most underestimated step

The ADS1299 at the heart of OpenBCI **cannot go into an earbud** — 8 channels, physically large, power-hungry. The earbud requires a 2–4 channel biopotential front end at microamp draw. Candidate families: TI ADS1291/1292/1293, Maxim MAX30003 class, Analog Devices biopotential AFEs, or an ADC integrated into the BLE SoC.

**Different silicon means a different noise floor means different results.** Phase 0–2 accuracy figures do not transfer unchanged.

Sequence: manufacturer evaluation board first (cheap, no PCB design) → verify equivalent signal → then custom board.

## 3.2 — Board revisions

- **Rev A** — correct silicon, wrong size. In an enclosure, not an earbud. Validates architecture. Generous debug and test points.
- **Rev B** — miniaturization. Rigid-flex, multilayer, microvolt analog traces millimeters from radio and antenna. Serious RF plus analog design problem.
- **Rev C** — earbud form. Requires an ODM or experienced consultant.

Expect 3–4 revisions. Each is 6–10 weeks including design, fabrication, assembly, and debug.

## 3.3 — Latency budget

End-to-end target **< 200 ms** (gesture to feedback).

| Stage | Budget |
|---|---|
| Sensor → AFE → SoC | ~10 ms |
| On-device preprocessing | ~20 ms |
| BLE transport | ~50–100 ms |
| Model inference | ~30 ms |
| Audio feedback | ~30 ms |

Architecture decision: on-device or on-phone inference. Likely answer — gesture on device (must be fast), attention on phone (already slow).

## 3.4 — Power budget

- Target ≥ 5 hours per charge, ≥ 24 hours with case
- Duty cycling: gesture channel always on, attention channel only when speech is detected

### Phase 3 Gate
- Wireless battery-powered device retains **90%** of Phase 2 metrics
- End-to-end latency < 200 ms
- > 4 hours per charge
- Fits 10 different ears without custom molding

---

# PHASE 4 — Alpha Devices and Field Data

> **Single question:** Does it work outside the lab?

**Duration:** 8 months · **Cost:** ~$800,000 · **Team:** 8–12 · **Your role:** advisory

## 4.1 — Alpha build
50–200 low-volume units. Purpose is data and durability, not revenue. Every unit numbered, every failure logged.

## 4.2 — The real asset: real-world dataset

**The output of this phase is not the device. It is the data.**

The entire literature is lab-based: seated, two talkers, controlled. Nobody has long-duration ear-form recordings during real conversation. This is the defensible position — models get copied, this dataset does not.

Collect: long-duration ear EEG (hours daily, over weeks); synchronized audio, attention label, user verification; failure modes including sweat, motion, noise, ear anatomy variation; the real-world context of every gesture false positive.

## 4.3 — Data law — cannot be deferred

You are recording audio inside homes and offices. The user consents; **other people in the room do not** — and they are data subjects too.

- UK DPA / GDPR compliance, with counsel, **before the first alpha unit ships**
- On-device audio processing architecture so raw audio never leaves the device
- Deletion rights, retention periods, anonymization — documented
- A dataset built on invalid consent can be ordered deleted; three years of moat evaporates in a day

## 4.4 — Regulatory positioning

**Decision: not a medical device.** This is a design constraint, not an escape hatch.

| Permitted | Prohibited |
|---|---|
| "Enhances the voice you're listening to" | "Compensates for hearing loss" |
| "Helps you follow conversation" | "Your hearing threshold is X dB" |
| "Supports focus" | "Detects attention disorders" |

The Whoop blood-pressure episode established that once a signal becomes clinically meaningful, a wellness label alone does not protect you — warning letter, then class action, and the matter closed only after product and labeling changes a year later. Draw the line on day one, not in year three with counsel.

### Phase 4 Gate
- 30-day retention > 60%
- Daily active use > 2 hours
- Field false positives < 2/hour
- Device failure rate < 5%
- > 50% of users report they would not go back

If retention fails, this is a feature and not a company. Do not proceed to Phase 5.

---

# PHASE 5 — Manufacturing and Certification

> **Single question:** Can this be built reliably and legally at scale?

**Duration:** 12 months · **Cost:** ~$3M+ including tooling · **Your role:** advisory

## 5.1 — ODM partnership

Earbud acoustics, antenna performance next to metal, battery management, sweat ingress — separate professions, and not where this company creates value.

- **You provide:** electrode geometry, AFE selection, algorithms, UX
- **ODM provides:** mechanical, acoustic, radio, battery, tooling, assembly, QA

Selection criterion: biopotential sensor integration experience (rare) or genuine willingness to learn.

## 5.2 — Certification

| Certification | Scope |
|---|---|
| CE / UKCA | EU / UK market access |
| FCC | US radio |
| RED (2014/53/EU) | Radio equipment directive |
| Bluetooth SIG | Brand and compliance |
| IEC 62368-1 | Electrical safety |
| **ISO 10993** | **Biocompatibility — mandatory for skin-contact electrodes** |
| IP rating | Sweat/water ingress |
| UN 38.3 | Battery shipping |

Certification alone runs 4–8 months. Run it in parallel with Phase 5, not after.

## 5.3 — BOM target

| Item | Estimate @ 100K units |
|---|---|
| Base TWS BOM | $30–60 |
| Biopotential AFE | +$2–5 |
| Electrode / conductive tip | +$1–3 (if no custom mold) |
| Additional compute/memory | +$3–8 |
| Increased battery | +$2–5 |
| **Total** | **~$45–85** |

Viable under a subscription model. If custom molds are required, this table is void.

---

# PHASE 6 — Launch and Module Transition

**Stage 1 — Own device.** Start with a narrow, obsessive population: all-day meeting workers, language learners, people working in noise. Whoop pattern — subscription, hardware included, screenless, sell the interpretation rather than the raw data.

**Stage 2 — Partnership.** Co-branded product with an earbud manufacturer. Their distribution, your layer.

**Stage 3 — Module.** License the sensor plus algorithm block to the industry. Hundreds of millions of earbuds annually; a few dollars per unit makes the arithmetic work.

**Where is the moat?** Not the model. Three things around it: the real-world dataset (Phase 4), the patent portfolio (from Phase 2), and proven integration.

---

# 8. Cross-Cutting Tracks

**Publication**
| Phase | Target |
|---|---|
| 0–1 | Conference paper (ICASSP / EUSIPCO / EMBC) |
| 2 | Journal (J Neural Eng / IEEE TBME) |
| 3–4 | Methodological contribution — dSTRF plus information-based channel selection |

**Rule: patent filing precedes publication.** This is the most expensive sequencing error available in this project.

**Funding**
| Phase | Round | Evidence required |
|---|---|---|
| 0–1 | Grant / self-funded | — |
| End of 2 | Pre-seed ~$500K | Working demo plus three curves |
| End of 3 | Seed ~$3M | Wireless prototype |
| End of 4 | Series A ~$15M | Retention data |
| 5 | Series B | Manufacturing-ready |

**Team**
| Phase | Added |
|---|---|
| 0–1 | PI |
| 2 | +1 signal processing / ML |
| 3 | +1 hardware, +1 embedded |
| 4 | +product, +data counsel, +user research |
| 5 | +manufacturing ops, +quality |

---

# 9. Reporting Protocol

At the end of each numbered sub-task, produce:

```markdown
## [Sub-task ID] — [Name]

**Status:** complete / blocked / failed
**Duration:** actual vs planned

### What was done
[Concrete actions. Code paths. Commands to reproduce.]

### Results
[Numbers, with uncertainty. Figures referenced by path.]

### Against threshold
| Metric | Threshold | Measured | Pass/Fail |

### What surprised me
[Anything that did not match expectation. This section is mandatory
and must not be left empty — if nothing surprised you, you probably
did not look closely enough.]

### Blockers / decisions needed from PI
[Specific questions, not general status.]

### Next
[The single next sub-task.]
```

---

# 10. Anti-Patterns

1. **Moving a threshold after seeing a result.** The single most common and most expensive failure. Thresholds are written before the phase, not after.
2. **Skipping a phase.** Reaching Phase 3 without a demo, or Phase 5 without retention data, is the standard death of hardware startups.
3. **Reporting accuracy alone.** Accuracy percentage lies. False positives per hour and retention tell the truth.
4. **Treating the render as the product.** The existing product visualization is a Phase 5 artifact. The project is at Phase 0.
5. **Calling it mind reading.** Untrue, sets expectations the product cannot meet, and the first wave of regulation will land exactly there.
6. **Optimistic scheduling.** Multiply hardware estimates by 1.5. This is a baseline, not pessimism.
7. **Broad reading.** Four papers are specified for Phase 0. Reading fifty is procrastination that feels like work.

---

# 11. First 72 Hours

- [ ] Submit access requests for KU Leuven and DTU AAD datasets
- [ ] Initialize repository and Python environment
- [ ] Read Geirnaert et al. 2021 (IEEE SPM)
- [ ] Draft the supervisor email (methodological framing, no commercial mention)
- [ ] Query institutional labs for existing ear-EEG hardware
- [ ] Download and draft the ethics application

Nothing else. In particular, order no hardware until the institutional query is answered.
