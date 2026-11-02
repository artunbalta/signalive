#!/usr/bin/env python3
"""
How much one ten second decision should move the phone's belief about who
is being listened to.

lib/sense/fusion.ts turns a decision into evidence: the decoded talker's odds
are multiplied by exp(weight * margin), the margin being how far that
talker's score beat the other's. The weight was set by hand (10). Here it is
fitted, by maximum likelihood, to the ten second decisions of generic
decoders on people they never saw: with two talkers and nothing else known,
the decoded talker is right with probability 1 / (1 + exp(-weight * margin)).

    python3 research/aad/calibrate.py

Writes research/aad/calibration.json (the linear decoder; deep.py adds the
learned decoder's own fit to deep.json).
"""
import json
import os
import warnings

import numpy as np

import analyze as A
from pipeline import FS, ridge, window_correlations

warnings.filterwarnings("ignore", message=".*encountered in matmul")

ROOT = os.path.dirname(os.path.abspath(__file__))
SECONDS = 10
HAND_SET = 10.0


def fit_weight(m):
    """The weight maximising sum log sigmoid(weight * m), m signed so that positive means the followed story won."""
    m = np.asarray(m, dtype=np.float64)
    w = 1.0
    for _ in range(100):
        p = 1.0 / (1.0 + np.exp(-w * m))
        g = float((m * (1.0 - p)).sum())
        h = float((m * m * p * (1.0 - p)).sum())
        step = g / max(h, 1e-12)
        w += step
        if abs(step) < 1e-10:
            break
    return w


def log_loss(w, m):
    """Mean surprise, in nats, of the decoded talker being right or wrong at this weight."""
    return float(np.mean(np.logaddexp(0.0, -w * np.asarray(m))))


def summary(m):
    """The fitted weight, how it compares with the hand set one, and a reliability table in five bins of margin."""
    m = np.asarray(m, dtype=np.float64)
    w = fit_weight(m)
    a = np.abs(m)
    edges = np.quantile(a, np.linspace(0, 1, 6))
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (a >= lo) & (a <= hi)
        bins.append(
            {
                "margin": round(float(a[sel].mean()), 4),
                "predicted": round(float(np.mean(1.0 / (1.0 + np.exp(-w * a[sel])))), 4),
                "predictedHandSet": round(float(np.mean(1.0 / (1.0 + np.exp(-HAND_SET * a[sel])))), 4),
                "observed": round(float(np.mean(m[sel] > 0)), 4),
                "n": int(sel.sum()),
            }
        )
    return {
        "seconds": SECONDS,
        "weight": round(w, 3),
        "decisions": int(len(m)),
        "accuracy": round(float(np.mean(m > 0)), 4),
        "logLoss": round(log_loss(w, m), 4),
        "logLossHandSet": round(log_loss(HAND_SET, m), 4),
        "handSet": HAND_SET,
        "bins": bins,
    }


def linear_margins():
    """Ten second margins of the generic linear decoder (4 per ear, wireless) for every person, held out, per person and block in order."""
    subjects = A.load()
    for s in subjects:
        for b in s.blocks:
            A.block_stats(b)
    with open(os.path.join(ROOT, "results.json")) as f:
        chans = json.load(f)["configs"]["wireless_4"]["electrodes"]
    cfg = A.Config("wireless_4", subjects[0].names, chans, "wireless")
    stats = A.generic_stats(cfg, subjects)
    out = []
    for t, s in enumerate(subjects):
        idx = [i for i in range(len(subjects)) if i != t]
        alpha = A.choose_alpha_generic(stats, idx)
        w = ridge(sum(stats[i][0] for i in idx), sum(stats[i][1] for i in idx), alpha)
        W_full = cfg.full_weights(w, A.subject_scale(cfg, s, warm=True))
        blocks = []
        for b in s.blocks:
            r = window_correlations(A.reconstruct(W_full, b), b.att, b.una, SECONDS * FS)
            blocks.append([round(float(v), 4) for v in r[:, 0] - r[:, 1]])
        out.append(blocks)
    return out


def flat(nested):
    """Margins from any nesting of lists, in order."""
    return [v for x in nested for v in (flat(x) if isinstance(x, list) else [x])]


def main():
    margins = linear_margins()
    lin = summary(flat(margins))
    with open(os.path.join(ROOT, "calibration.json"), "w") as f:
        json.dump({"linear": lin, "margins10": margins}, f, indent=1)
    print(
        f"[calibrate] linear, {SECONDS} s: weight {lin['weight']} (hand set {HAND_SET}), "
        f"log loss {lin['logLoss']} vs {lin['logLossHandSet']}, accuracy {lin['accuracy']}",
        flush=True,
    )
    for b in lin["bins"]:
        print(f"  margin {b['margin']:.3f}: predicted {b['predicted']:.3f}, observed {b['observed']:.3f} ({b['n']})")


if __name__ == "__main__":
    main()
