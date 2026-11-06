#!/usr/bin/env python3
"""
Which electrodes an earbud can decode attention from: in the ear, around
it, or both, against the scalp, on the same 15 people at the same moments
(earsaad_prep.py), with no calibration: every person is decoded by models
trained on other people.

Montages, each ear always referenced to itself as two separate earbuds
must be (the scalp to its common average):

  inear        6 dry electrodes in each ear canal and concha
  aroundear    9 (left) and 10 (right) wet electrodes around each ear
  both         the two together, per ear
  scalp        29 scalp channels, for reference

Two decoders: the linear backward model of research/aad (ridge, 32 lags,
strength chosen on validation people) and the learned one (research/aad
/deep3.py, its default settings, one network per fold). Five folds of 3
people; 3 more held back to stop training and to choose the ridge strength.
Every montage also gets the 97 s out of step control.

    python3 research/ext/earsaad_decode.py [montage ...]

Writes research/ext/earsaad.json.
"""
import glob
import json
import os
import sys
import time

import numpy as np
import torch

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "..", "aad"))
import analyze as A  # noqa: E402
import deep3 as D  # noqa: E402
from deep import running_norm  # noqa: E402
from pipeline import FS, LAGS, bandpass_sos, causal_filter, lagged, ridge, window_correlations  # noqa: E402

PREP = os.path.join(ROOT, "data", "earsaad", "prep")
# Each trial was recorded on its own, so its filters start cold and the sound
# starts with it: a decision window that begins at the trial's first sample
# hears that onset, not attention. Every trial is used from this second on.
SKIP_S = 10
OUT = os.path.join(ROOT, "earsaad.json")
WINDOWS = A.WINDOWS
ALPHAS = [1e-2, 1e-1, 1.0, 10.0, 100.0]

INEAR = {"left": ["ELA", "ELB", "ELC", "ELE", "ELI", "ELT"], "right": ["ERA", "ERB", "ERC", "ERE", "ERI", "ERT"]}
AROUND = {"left": [f"cEL{i}" for i in range(1, 10)], "right": [f"cER{i}" for i in range(1, 11)]}
SCALP = ["O1", "Pz", "P3", "P7", "CP1", "CP5", "M1", "Cz", "C3", "T7", "FC1", "FC5", "F3", "F7", "Fp1", "O2", "P4", "P8", "CP2", "CP6", "M2", "C4", "T8", "FC2", "FC6", "Fz", "F4", "F8", "Fp2"]
MONTAGES = {
    "inear": [INEAR["left"], INEAR["right"]],
    "aroundear": [AROUND["left"], AROUND["right"]],
    "both": [INEAR["left"] + AROUND["left"], INEAR["right"] + AROUND["right"]],
    "scalp": [SCALP],
}


def derive(eeg, names, groups):
    """
    Each group against its own average. A contact that is missing or flat
    stays in its place as zeros and out of the average, so every person's
    channels line up for the learned decoder.
    """
    idx = {n: i for i, n in enumerate(names)}
    rows = []
    for group in groups:
        x = np.stack([eeg[idx[c]] if c in idx else np.full(eeg.shape[1], np.nan) for c in group]).astype(np.float64)
        ok = np.isfinite(x).all(axis=1) & (np.nan_to_num(x).std(axis=1) > 1e-9)
        ref = x[ok].mean(axis=0, keepdims=True) if ok.any() else 0.0
        y = np.where(ok[:, None], x - ref, 0.0)
        rows.append(y)
    return np.concatenate(rows)


def load(montage):
    sos = bandpass_sos(FS)
    people = []
    for path in sorted(glob.glob(os.path.join(PREP, "sub-*.npz"))):
        z = np.load(path)
        names = [str(n) for n in z["channels"]]
        sides = [str(s) for s in z["sides"]]
        trials = []
        skip = SKIP_S * FS
        for t, side in enumerate(sides):
            x = derive(z[f"eeg{t}"], names, MONTAGES[montage])[:, skip:]
            e1 = causal_filter(sos, z[f"env1_{t}"].astype(np.float64))[skip:]
            e2 = causal_filter(sos, z[f"env2_{t}"].astype(np.float64))[skip:]
            att, una = (e1, e2) if side == "left" else (e2, e1)
            trials.append((x, att, una))
        # The person's scale from the first two minutes of their first trial, unlabelled.
        warm = trials[0][0][:, : A.WARMUP_S * FS]
        W = 1.0 / (np.sqrt((warm**2).mean(axis=1, keepdims=True)) + 1e-9)
        W = np.where(np.isfinite(W) & (W < 1e6), W, 0.0)
        items = []
        for x, att, una in trials:
            n = len(att)
            xs = W * x
            items.append((xs[:, :n].astype(np.float32), running_norm(att).astype(np.float32), running_norm(una).astype(np.float32), att, una, xs))
        good = int((W[:, 0] > 0).sum())
        people.append({"id": os.path.basename(path)[:-4], "items": items, "channels": good, "sides": sides})
    return people


def linear_stats(items):
    """Lagged covariances of each item, summed: the backward model's normal equations."""
    C = items[0][5].shape[0] * LAGS
    cxx = np.zeros((C, C))
    cxs = np.zeros(C)
    for _, _, _, att, _, x in items:
        X = lagged(x, len(att))
        cxx += X.T @ X
        cxs += X.T @ att
    return cxx, cxs


def linear_hits(w, items, shift_s=0):
    hits = {W: [] for W in WINDOWS}
    for _, _, _, att, una, x in items:
        if shift_s:
            att = np.roll(att, shift_s * FS)
            una = np.roll(una, shift_s * FS)
        n = len(att)
        rec = lagged(x, n) @ w
        for W in WINDOWS:
            r = window_correlations(rec, att, una, W * FS)
            hits[W].extend((r[:, 0] > r[:, 1]).tolist())
    return hits


def deep_items(items):
    return [(eeg, a, u) for eeg, a, u, *_ in items]


def mesd(acc):
    """MESD over the windows a 10 minute trial holds (no 600 s window fits in one)."""
    ws = [W for W in WINDOWS if np.isfinite(acc[W])]
    grid = np.arange(ws[0], ws[-1] + 0.01, 0.25)
    pg = np.interp(grid, ws, [acc[W] for W in ws])
    return min(A.emtt(p, tau) for tau, p in zip(grid, pg))


def summarize(per, control):
    n = len(per)
    m = [mesd({W: p[W] for W in WINDOWS}) for p in per]
    ok = [W for W in WINDOWS if all(np.isfinite(p[W]) for p in per)]
    return {
        "mean": {W: float(np.mean([p[W] for p in per])) for W in ok},
        "sem": {W: float(np.std([p[W] for p in per], ddof=1) / np.sqrt(n)) for W in ok},
        "perSubject60": [round(p[60], 4) for p in per],
        "mesdMedian": float(np.median(m)) if np.isfinite(np.median(m)) else None,
        "control": {W: float(np.mean([c[W] for c in control])) for W in ok},
    }


def main():
    wanted = sys.argv[1:] or list(MONTAGES)
    results = json.load(open(OUT)) if os.path.exists(OUT) else {}
    results["source"] = "Ear-SAAD, Geirnaert, Kappel and Kidmose, Zenodo 16536441 (license in its BIDS files: CC BY-NC-SA 4.0); results only"
    cfg = dict(D.DEFAULTS)
    t0 = time.time()
    for montage in wanted:
        people = load(montage)
        n = len(people)
        rng = np.random.default_rng(7)
        order = rng.permutation(n)
        groups = np.array_split(order, 5)
        lin_per, lin_ctl, deep_per, deep_ctl = [None] * n, [None] * n, [None] * n, [None] * n
        for g, test in enumerate(groups):
            rest = [p for p in order if p not in test]
            val, trn = rest[:3], rest[3:]
            train_items = [it for p in trn for it in people[p]["items"]]
            val_items = [it for p in val for it in people[p]["items"]]
            # Linear: the ridge strength that rebuilds the validation people's followed envelope best.
            best = None
            cxx, cxs = linear_stats(train_items)
            for alpha in ALPHAS:
                w = ridge(cxx, cxs, alpha)
                acc = np.mean(linear_hits(w, val_items)[60])
                if best is None or acc > best[0]:
                    best = (acc, w)
            w = best[1]
            for p in test:
                h = linear_hits(w, people[p]["items"])
                hc = linear_hits(w, people[p]["items"], shift_s=97)
                lin_per[p] = {W: float(np.mean(v)) if v else float("nan") for W, v in h.items()}
                lin_ctl[p] = {W: float(np.mean(v)) if v else float("nan") for W, v in hc.items()}
            model, _, _ = D.train(deep_items(train_items), deep_items(val_items), cfg, 7 + g)
            for p in test:
                deep_per[p], _ = D.evaluate([model], deep_items(people[p]["items"]), cfg["pre"])
                deep_ctl[p], _ = D.evaluate([model], deep_items(people[p]["items"]), cfg["pre"], shift_s=97)
            print(f"[earsaad {montage}] fold {g + 1}/5 ({time.time() - t0:.0f}s)", flush=True)
        results[montage] = {
            "channelsPerPerson": [pp["channels"] for pp in people],
            "linear": summarize(lin_per, lin_ctl),
            "learned": summarize(deep_per, deep_ctl),
        }
        with open(OUT, "w") as f:
            json.dump(results, f, indent=1)
        L, Dp = results[montage]["linear"], results[montage]["learned"]
        print(
            f"[earsaad {montage}] linear 10s {L['mean'][10]:.3f} 60s {L['mean'][60]:.3f} 300s {L['mean'][300]:.3f} | "
            f"learned 10s {Dp['mean'][10]:.3f} 60s {Dp['mean'][60]:.3f} 300s {Dp['mean'][300]:.3f} | control 60s {L['control'][60]:.3f} {Dp['control'][60]:.3f}",
            flush=True,
        )


if __name__ == "__main__":
    main()
