#!/usr/bin/env python3
"""
What holding the talker is worth, on real EEG decisions.

Face forward features bring forward the voice in front of you. A listener who
follows one person also looks at their plate, their phone and the other
people at the table. Here every held out person's real ten second decisions
(the learned decoder's, on blocks where they followed one story for ten
minutes) are replayed under a head that looks away: in each ten second step
the head faces the followed talker, faces nobody (down at a plate or a
phone), or faces the other talker, by a Markov chain with set shares and a
mean look of 20 s. Four policies choose the voice brought forward:

  face        the talker the head points at, within 30 degrees; nobody when
              it points at nobody
  face, hold  the same, but when the head points at nobody, the last talker
              it pointed at
  EEG         the belief alone (lib/sense/fusion.ts AttentionBelief)
  fused       the phone's fusion: the head prior times the belief
              (fuseAttention, kappa 2), the talker it favours
  face, dwell the talker the head has stayed on for 20 s, held otherwise: a
              head only rule as patient as the dwell fusion
  fused, dwell the same, with the head prior's weight growing from nothing
              to kappa over the first 40 s the head stays on one talker, so
              a glance moves it less than a turn that stays

The measure is the share of steps from the second minute on in which the
followed voice is the one brought forward; and, on blocks where attention
switches once (between the 3rd and 7th minute, the head turning with it and
the decisions flipping, as in belief.py), the same share outside the minute
after the switch, and the median time until the new talker comes forward;
and on blocks where attention moves but the head does not (it goes on facing
the first talker as before), the share of the last two minutes in which the
new talker is forward: what only the EEG can see. Talkers stand at -60 and +60
degrees, as in the recordings. How much a listener looks away is an
assumption, so it is swept; how it splits between nobody and the other
talker is reported three ways.

    python3 research/aad/hold_value.py [runs glob]   # default runs/final.seed*.json

Writes research/aad/hold_value.json.
"""
import glob
import json
import re
import os
import sys

import numpy as np

import belief as B

ROOT = os.path.dirname(os.path.abspath(__file__))
AZ = np.array([-60.0, 60.0])  # followed, other
KAPPA = 2.0
HAZARD = B.CHOSEN
STEP_S = 10
LOOK_S = 20.0
SETTLE = 6
DRAWS = 20
AWAY = [0.0, 0.1, 0.25, 0.4]
SPLITS = {"half at the other talker": 0.5, "all at nobody": 0.0, "all at the other talker": 1.0}


def heads(n, away, to_other, rng):
    """Yaw per step: 0 faces the followed talker, 1 nobody, 2 the other talker."""
    shares = np.array([1.0 - away, away * (1.0 - to_other), away * to_other])
    q = 1.0 - np.exp(-STEP_S / LOOK_S)
    s = np.empty(n, int)
    s[0] = rng.choice(3, p=shares)
    for i in range(1, n):
        s[i] = rng.choice(3, p=shares) if rng.random() < q else s[i - 1]
    yaw = np.where(s == 0, AZ[0], np.where(s == 1, 0.0, AZ[1])) + rng.normal(0, np.where(s == 1, 20.0, 10.0))
    return yaw


def dwell_kappa(yaw, ramp_s):
    """The head prior's weight per step: it grows with how long the head has pointed at the same talker."""
    d = np.abs(yaw[:, None] - AZ[None, :])
    near = np.argmin(d, axis=1)
    within = d[np.arange(len(yaw)), near] <= 30.0
    k = np.empty(len(yaw))
    run, prev = 0.0, -1
    for i in range(len(yaw)):
        cur = near[i] if within[i] else -1
        run = run + STEP_S if cur == prev and cur >= 0 else (STEP_S if cur >= 0 else 0.0)
        prev = cur
        k[i] = KAPPA * min(1.0, run / ramp_s)
    return k


def policies(yaw, p_first):
    """The talker each policy brings forward per step: 0, 1, or -1 for nobody."""
    d = np.abs(yaw[:, None] - AZ[None, :])
    near = np.argmin(d, axis=1)
    within = d[np.arange(len(yaw)), near] <= 30.0
    face = np.where(within, near, -1)
    last, hold = -1, np.empty(len(yaw), int)
    for i in range(len(yaw)):
        if within[i]:
            last = near[i]
        hold[i] = last
    cur, run, prev, dwell = -1, 0.0, -1, np.empty(len(yaw), int)
    for i in range(len(yaw)):
        c = near[i] if within[i] else -1
        run = run + STEP_S if c == prev else STEP_S
        prev = c
        if c >= 0 and (cur < 0 or run >= DWELL_S):
            cur = c
        dwell[i] = cur
    eeg = np.where(p_first > 0.5, 0, 1)
    logb = np.log(np.stack([p_first, 1.0 - p_first], axis=1).clip(1e-300))
    cosd = np.cos(np.radians(yaw[:, None] - AZ[None, :]))
    out = {"face": face, "face, hold": hold, "face, dwell": dwell, "EEG": eeg}
    ramp = dwell_kappa(yaw, 40.0) / KAPPA
    for name, kap in (("fused", np.full(len(yaw), KAPPA)), ("fused, dwell", KAPPA * ramp)):
        lp = kap[:, None] * cosd + logb
        out[name] = np.where(lp[:, 0] > lp[:, 1], 0, 1)
    for kmax in KAPPA_SWEEP:
        for name, kap in ((f"fused k{kmax:g}", np.full(len(yaw), kmax)), (f"fused, dwell k{kmax:g}", kmax * ramp)):
            lp = kap[:, None] * cosd + logb
            out[name] = np.where(lp[:, 0] > lp[:, 1], 0, 1)
    return out


KAPPA_SWEEP = (1.0, 0.5)
NAMES = ("face", "face, hold", "face, dwell", "EEG", "fused", "fused, dwell") + tuple(
    n for k in KAPPA_SWEEP for n in (f"fused k{k:g}", f"fused, dwell k{k:g}")
)
DWELL_S = 20.0


def covert_case(m, w, away, to_other, rng):
    """Attention moves to talker 1 while the head keeps facing talker 0 as before: who follows, and how fast."""
    n = len(m)
    at = int(rng.integers(18, n - 18))
    truth = np.where(np.arange(n) < at, 0, 1)
    p0 = B.follow(np.where(truth == 0, m, -m), w, HAZARD)
    pol = policies(heads(n, away, to_other, rng), p0)
    res = {}
    for k in NAMES:
        after = np.nonzero(pol[k][at:] == 1)[0]
        # followed: the new talker forward for most of the last two minutes of the block
        tail = pol[k][max(at, n - 12):] == 1
        res[k] = (float(after[0] * STEP_S) if len(after) else float("inf"), float(np.mean(tail)))
    return res


def switch_case(m, w, away, to_other, rng):
    """One block with a switch: talker 0 before, 1 after; the head turns with attention; decisions flip at the switch."""
    n = len(m)
    at = int(rng.integers(18, n - 18))
    truth = np.where(np.arange(n) < at, 0, 1)
    signed = np.where(truth == 0, m, -m)  # toward talker 0
    p0 = B.follow(signed, w, HAZARD)
    yaw = heads(n, away, to_other, rng)
    yaw[at:] = -yaw[at:]  # the head now favours talker 1 in the same way
    pol = policies(yaw, p0)
    res = {}
    for k in NAMES:
        v = pol[k]
        ok = v == truth
        keep = (np.arange(n) >= SETTLE) & ((np.arange(n) < at) | (np.arange(n) >= at + 6))
        after = np.nonzero(v[at:] == 1)[0]
        res[k] = (float(np.mean(ok[keep])), float(after[0] * STEP_S) if len(after) else float("inf"))
    return res


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else "runs/final.seed*.json"
    # Only the runs themselves, not the .splice or .onset files written beside them.
    runs = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(ROOT, pattern))) if re.search(r"\.seed\d+\.json$", p)]
    if not runs:
        raise SystemExit(f"no runs match {pattern}")
    rng = np.random.default_rng(7)
    out = {"runs": len(runs), "stepSeconds": STEP_S, "meanLookSeconds": LOOK_S, "kappa": KAPPA, "hazard": HAZARD, "draws": DRAWS, "splits": {}}
    for name, to_other in SPLITS.items():
        rows = []
        for away in AWAY:
            tot = {}
            for run in runs:
                w = run["calibration"]["weight"]
                for person in run["margins10"]:
                    for m in person:
                        m = np.asarray(m, float)
                        p = B.follow(m, w, HAZARD)
                        for _ in range(DRAWS):
                            r = policies(heads(len(m), away, to_other, rng), p)
                            for k, v in r.items():
                                tot.setdefault(k, []).append(float(np.mean(v[SETTLE:] == 0)))
                            sw = switch_case(m, w, away, to_other, rng)
                            for k, (acc, took) in sw.items():
                                tot.setdefault("switch " + k, []).append(acc)
                                tot.setdefault("took " + k, []).append(took)
                            cv = covert_case(m, w, away, to_other, rng)
                            for k, (took, tail) in cv.items():
                                tot.setdefault("covert " + k, []).append(tail)
            row = {"away": away}
            for k in NAMES:
                row[k] = round(float(np.mean(tot[k])), 4)
                row["switch " + k] = round(float(np.mean(tot["switch " + k])), 4)
                took = np.array(tot["took " + k])
                row["took " + k] = float(np.median(took)) if np.isfinite(np.median(took)) else None
                row["covert " + k] = round(float(np.mean(tot["covert " + k])), 4)
            rows.append(row)
            print(f"[hold] {name:26s} away {away:.2f}: " + "  ".join(f"{k} {row[k]:.3f}/{row['switch ' + k]:.3f}/{row['took ' + k]}s/{row['covert ' + k]:.2f}" for k in NAMES), flush=True)
        out["splits"][name] = rows
    with open(os.path.join(ROOT, "hold_value.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
