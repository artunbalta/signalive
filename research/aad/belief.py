#!/usr/bin/env python3
"""
From single decisions to a belief that holds.

A ten second decision is weak evidence: right about 58% of the time with the
linear decoder, 61% with the learned one. So the phone acts on none of them
alone. It keeps a belief about which of two talkers is being listened to and
updates it with each decision by exactly what that decision is worth (the
weight calibrate.py fits), while allowing that attention may have moved since
the last one: a two state hidden Markov model, filtered forward, with a chance
h per decision that the listener switched.

h trades steadiness against speed, as the number of gain steps does for the
switch durations in analyze.py. For each h this measures, on people the
decoders never saw:

  steady   the share of decisions after which the belief favours the followed
           story, from the second minute of each block on (attention never
           moved in these recordings)
  switch   after a switch simulated halfway through each block (the decisions
           after it count for the other story: the same decoder, now facing
           the other way), the median time until the belief favours the new
           story, and the share of blocks where it does not within five
           minutes

    python3 research/aad/belief.py

Reads calibration.json (calibrate.py) and the learned decoder's splits
(deep.py with AAD_ENSEMBLE=3); writes belief.json.
"""
import glob
import json
import os

import numpy as np

import calibrate as C

ROOT = os.path.dirname(os.path.abspath(__file__))
STEP_S = C.SECONDS
HAZARDS = [0.0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5]
# What the phone uses (lib/sense/fusion.ts DEFAULT_HAZARD): steadier than 80% with the
# linear decoder while still coming over to a new talker in about a minute.
CHOSEN = 0.02
SETTLE = 6  # decisions before steadiness counts: the first minute
WITHIN = 30  # decisions a switch may take before it counts as missed: five minutes


def follow(m, w, h):
    """The belief that the first story is followed, after each decision; m is signed toward that story."""
    lo = 0.0
    out = np.empty(len(m))
    for i, x in enumerate(m):
        # Attention may have moved since the last decision: pull the belief toward even by h.
        p = 1.0 / (1.0 + np.exp(-lo))
        p = (1.0 - h) * p + h * (1.0 - p)
        lo = np.log(p / (1.0 - p)) + w * x
        out[i] = 1.0 / (1.0 + np.exp(-lo))
    return out


def measure(people, w, h):
    """Steady share and switch times over every person's blocks."""
    steady = []
    times = []
    missed = 0
    blocks = 0
    for person in people:
        right = []
        for blk in person:
            m = np.asarray(blk, dtype=np.float64)
            if len(m) <= SETTLE:
                continue
            right.extend((follow(m, w, h)[SETTLE:] > 0.5).tolist())
            k = len(m) // 2
            flipped = np.concatenate([m[:k], -m[k:]])
            b = follow(flipped, w, h)[k:]
            over = np.nonzero(b < 0.5)[0]
            blocks += 1
            if len(over) and over[0] < WITHIN:
                times.append((over[0] + 1) * STEP_S)
            else:
                missed += 1
        steady.append(np.mean(right))
    median = float(np.median(times + [np.inf] * missed)) if blocks else np.inf
    return {
        "hazard": h,
        "steady": round(float(np.mean(steady)), 4),
        # None when most switches are not followed within five minutes.
        "switchMedian": median if np.isfinite(median) else None,
        "switchMissed": round(missed / blocks, 4) if blocks else None,
        "decisionAccuracy": None,
    }


def table(people, w):
    flat_m = np.asarray(C.flat(people))
    rows = [measure(people, w, h) for h in HAZARDS]
    for r in rows:
        r["decisionAccuracy"] = round(float(np.mean(flat_m > 0)), 4)
    return rows


def learned_runs():
    """
    Per person and block margins of each learned split that kept them in
    order: deep.py's ensembles, or the runs AAD_BELIEF_RUNS names (a glob
    relative to this folder, such as runs/final.seed*.json from deep3.py).
    """
    runs = []
    pattern = os.environ.get("AAD_BELIEF_RUNS", "deep*.ens3.json")
    for path in sorted(glob.glob(os.path.join(ROOT, pattern))):
        with open(path) as f:
            d = json.load(f)
        m = d.get("margins10")
        if m and isinstance(m[0], list):
            runs.append(m)
    return runs


def main():
    with open(os.path.join(ROOT, "calibration.json")) as f:
        cal = json.load(f)
    out = {"stepSeconds": STEP_S, "settleDecisions": SETTLE, "withinDecisions": WITHIN, "chosenHazard": CHOSEN}
    lin = cal["margins10"]
    out["linear"] = {"weight": cal["linear"]["weight"], "rows": table(lin, cal["linear"]["weight"])}

    runs = learned_runs()
    if runs:
        w = C.fit_weight(C.flat(runs))
        # Each split is a full set of 36 held out people; pooled, every person counts once per split.
        people = [p for run in runs for p in run]
        out["learned"] = {"weight": round(w, 3), "splits": len(runs), "rows": table(people, w)}

    with open(os.path.join(ROOT, "belief.json"), "w") as f:
        json.dump(out, f, indent=1)
    for name in ("linear", "learned"):
        if name not in out:
            continue
        print(f"[belief] {name}, weight {out[name]['weight']}:")
        for r in out[name]["rows"]:
            sm = r["switchMedian"]
            print(
                f"  h {r['hazard']:<6} steady {r['steady']:.3f}  switch {('%.0f s' % sm) if sm is not None and np.isfinite(sm) else 'never'}"
                f"  missed {r['switchMissed']:.2f}   (single decisions {r['decisionAccuracy']:.3f})"
            )


if __name__ == "__main__":
    main()
