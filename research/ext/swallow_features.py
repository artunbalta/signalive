#!/usr/bin/env python3
"""
Can the earbud tell a swallow from a clench by what its electrodes see?

A single clench fires by itself on half of all swallows (clench_physiomotion
.test.ts), which is why keeping a moment belongs on the double clench. If a
swallow looks different from a clench in the same signals, the detector
could reject it without the canal microphone of HW-MIC-03. PhysioMotion
(ds006386) labels both: swallows, and blocks of cued molar clenching, on the
eight channels nearest the ears (physiomotion_export.py).

Every swallow, and every burst inside the clench blocks where both ears'
30 to 120 Hz power is over four times its run's median (the detector's own
rule), is described by features the detector could compute as it goes, all
with causal filters:

  peak    the weaker ear's peak power over its run's median
  dur     seconds the two ears' mean power stays over half its peak
  low     1 to 5 Hz peak to peak during the event, over the EMG's rms (a
          swallow moves the tongue and larynx, which shifts slow potentials)
  upper   power at FT7, T7, FT8, T8 over TP7, P7, TP8, P8 at the peak
  high    60 to 120 Hz over 30 to 60 Hz power at the peak
  sym     the weaker ear's peak over the stronger's

and each feature's separation is its AUC; then a logistic regression on all
of them, trained on 11 people and tested on the twelfth, says how many
swallows a rule could reject while keeping 95% of clenches.

    python3 research/ext/swallow_features.py

Writes research/ext/swallow_features.json.
"""
import json
import os

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "data", "physiomotion", "export")
FEATURES = ["peak", "dur", "low", "upper", "high", "sym"]
K = 4.0
SMOOTH_S = 0.05
UPPER = [0, 1, 4, 5]  # FT7 T7 FT8 T8
LOWER = [2, 3, 6, 7]  # TP7 P7 TP8 P8


def smooth(p, n):
    c = np.cumsum(np.concatenate([np.zeros((p.shape[0], 1)), p], axis=1), axis=1)
    out = np.empty_like(p)
    out[:, n:] = (c[:, n + 1 :] - c[:, 1:-n]) / n
    out[:, :n] = out[:, n : n + 1]
    return out


def features(x, fs, lo_s, hi_s, med, emg, low, p_lo, p_hi):
    a, b = max(0, int(lo_s * fs)), min(x.shape[1], int(hi_s * fs))
    if b - a < int(0.05 * fs):
        return None
    left, right = emg[:4, a:b].mean(0), emg[4:, a:b].mean(0)
    pl, pr = left.max() / med[0], right.max() / med[1]
    both = (left / med[0] + right / med[1]) / 2
    i = int(np.argmax(both))
    over = both > both[i] / 2
    rms = np.sqrt(emg[:, a:b].mean())
    up = emg[UPPER, a + i].mean() / max(emg[LOWER, a + i].mean(), 1e-12)
    return {
        "peak": float(min(pl, pr)),
        "dur": float(over.sum() / fs),
        "low": float(np.mean(np.ptp(low[:, a:b], axis=1)) / max(rms, 1e-9)),
        "upper": float(up),
        "high": float(p_hi[:, a + i].mean() / max(p_lo[:, a + i].mean(), 1e-12)),
        "sym": float(min(pl, pr) / max(pl, pr)),
    }


def auc(pos, neg):
    pos, neg = np.asarray(pos), np.asarray(neg)
    allv = np.concatenate([pos, neg])
    ranks = allv.argsort().argsort() + 1.0
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def logistic(X, y, steps=3000, lr=0.1, l2=1e-2):
    w = np.zeros(X.shape[1])
    b = 0.0
    cw = np.where(y == 1, 0.5 / max(y.mean(), 1e-9), 0.5 / max(1 - y.mean(), 1e-9))
    for _ in range(steps):
        z = np.clip(X @ w + b, -30, 30)
        p = 1 / (1 + np.exp(-z))
        g = (p - y) * cw
        w -= lr * (X.T @ g / len(y) + l2 * w)
        b -= lr * g.mean()
    return w, b


def main():
    index = json.load(open(os.path.join(SRC, "index.json")))
    rows = []
    for run in index["runs"]:
        fs = run["fs"]
        x = np.fromfile(os.path.join(SRC, f"{run['name']}.f32"), dtype="<f4").reshape(8, -1).astype(np.float64)
        n = int(SMOOTH_S * fs)
        emg = smooth(sosfilt(butter(4, [30, 120], btype="band", fs=fs, output="sos"), x) ** 2, n)
        p_lo = smooth(sosfilt(butter(4, [30, 60], btype="band", fs=fs, output="sos"), x) ** 2, n)
        p_hi = smooth(sosfilt(butter(4, [60, 120], btype="band", fs=fs, output="sos"), x) ** 2, n)
        low = sosfilt(butter(2, [1, 5], btype="band", fs=fs, output="sos"), x)
        med = np.array([np.median(emg[:4].mean(0)), np.median(emg[4:].mean(0))])
        person = run["name"].split("_")[0]
        for e in run["events"]:
            if e["label"] == "swallow":
                f = features(x, fs, e["start"] - 0.3, e["stop"] + 0.3, med, emg, low, p_lo, p_hi)
                if f:
                    rows.append({"person": person, "kind": "swallow", **f})
            elif e["label"] == "chew":
                a, b = int(e["start"] * fs), int(e["stop"] * fs)
                both = np.minimum(emg[:4, a:b].mean(0) / med[0], emg[4:, a:b].mean(0) / med[1]) > K
                edges = np.flatnonzero(np.diff(np.concatenate([[0], both.astype(int), [0]])))
                for s0, s1 in zip(edges[::2], edges[1::2]):
                    if (s1 - s0) / fs < 0.04:
                        continue
                    f = features(x, fs, (a + s0) / fs - 0.3, (a + s1) / fs + 0.3, med, emg, low, p_lo, p_hi)
                    if f:
                        rows.append({"person": person, "kind": "clench", **f})
        print(f"[swallow] {run['name']}: {sum(r['kind'] == 'swallow' for r in rows)} swallows, {sum(r['kind'] == 'clench' for r in rows)} clench bursts so far", flush=True)

    sw = [r for r in rows if r["kind"] == "swallow"]
    cl = [r for r in rows if r["kind"] == "clench"]
    out = {"swallows": len(sw), "clenchBursts": len(cl), "people": len({r["person"] for r in rows}), "auc": {}, "medians": {}}
    for k in FEATURES:
        out["auc"][k] = round(auc([r[k] for r in sw], [r[k] for r in cl]), 3)
        out["medians"][k] = {"swallow": float(np.median([r[k] for r in sw])), "clench": float(np.median([r[k] for r in cl]))}
        print(f"[swallow] {k:6s} AUC {out['auc'][k]:.3f}  median swallow {out['medians'][k]['swallow']:.3g}  clench {out['medians'][k]['clench']:.3g}", flush=True)

    # Only the swallows the detector would report matter: those over its threshold on both ears.
    rows = [r for r in rows if r["kind"] == "clench" or r["peak"] > K]
    rows = [r for r in rows if all(np.isfinite(r[k]) for k in FEATURES)]
    out["swallowsReported"] = sum(r["kind"] == "swallow" for r in rows)
    sw = [r for r in rows if r["kind"] == "swallow"]
    cl = [r for r in rows if r["kind"] == "clench"]
    out["aucReported"] = {k: round(auc([r[k] for r in sw], [r[k] for r in cl]), 3) for k in FEATURES}
    print(f"[swallow] reported swallows only ({len(sw)}): " + "  ".join(f"{k} {v:.3f}" for k, v in out["aucReported"].items()), flush=True)
    # Person held out: train on the others, score the held out person's events.
    people = sorted({r["person"] for r in rows})
    X = np.clip(np.log(np.array([[max(r[k], 1e-6) for k in FEATURES] for r in rows])), -20, 20)
    y = np.array([1.0 if r["kind"] == "swallow" else 0.0 for r in rows])
    who = np.array([r["person"] for r in rows])
    scores = np.empty(len(rows))
    for p in people:
        tr, te = who != p, who == p
        mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-9
        # Swallows are few against the bursts: weigh them up so the fit sees both.
        w, b = logistic((X[tr] - mu) / sd, y[tr])
        scores[te] = ((X[te] - mu) / sd) @ w + b
    out["heldOutAuc"] = round(auc(scores[y == 1], scores[y == 0]), 3)
    # The threshold that keeps 95% of clench bursts (5% rejected), and what it does to swallows.
    t = np.quantile(scores[y == 0], 0.95)
    out["keep95"] = {"swallowsRejected": round(float(np.mean(scores[y == 1] > t)), 3)}
    t99 = np.quantile(scores[y == 0], 0.99)
    out["keep99"] = {"swallowsRejected": round(float(np.mean(scores[y == 1] > t99)), 3)}
    print(f"[swallow] all features, person held out: AUC {out['heldOutAuc']}; keeping 95% of clenches rejects {out['keep95']['swallowsRejected']:.0%} of swallows, keeping 99% rejects {out['keep99']['swallowsRejected']:.0%}", flush=True)
    with open(os.path.join(ROOT, "swallow_features.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
