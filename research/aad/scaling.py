#!/usr/bin/env python3
"""
How accuracy grows with the number of people a generic decoder is trained on.

The linear decoder of analyze.py (4 electrodes per ear, each ear referenced
to itself, no calibration) is trained on N people drawn from the other 35 and
tested on the held out person, for N from 2 to 35, many draws each. The
learned decoder's points come from deep3.py runs with "ntrain" set
(variants/scale.jsonl) and are added by this script when they exist.

    python3 research/aad/scaling.py

Writes research/aad/scaling.json.
"""
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze as A  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
SIZES = [2, 5, 10, 15, 20, 25, 30, 35]
DRAWS = 8
LEFT4 = ["L01", "L04b", "L06", "L04"]
RIGHT4 = ["R02", "R05", "R08", "R04"]


def linear(subjects):
    cfg = A.Config("wireless_4", subjects[0].names, LEFT4 + RIGHT4, "wireless")
    for s in subjects:
        for b in s.blocks:
            A.block_stats(b)
    stats = A.generic_stats(cfg, subjects)
    n = len(subjects)
    # One ridge strength for every size: the one chosen most often with all 35.
    chosen = [A.choose_alpha_generic(stats, [i for i in range(n) if i != t]) for t in range(n)]
    alpha = max(set(chosen), key=chosen.count)
    out = {}
    for N in SIZES:
        per = []
        for t in range(n):
            others = [i for i in range(n) if i != t]
            draws = 1 if N >= len(others) else DRAWS
            accs = []
            for r in range(draws):
                rng = np.random.default_rng(1000 * N + 37 * t + r)
                idx = others if N >= len(others) else list(rng.choice(others, N, replace=False))
                w = A.ridge(sum(stats[i][0] for i in idx), sum(stats[i][1] for i in idx), alpha)
                s = subjects[t]
                W = cfg.full_weights(w, A.subject_scale(cfg, s, warm=True))
                recs = [(A.reconstruct(W, b), b.att, b.una) for b in s.blocks]
                accs.append(A.accuracies(recs))
            per.append({W: float(np.mean([a[W] for a in accs])) for W in A.WINDOWS})
        out[str(N)] = {
            "mean": {str(W): float(np.mean([p[W] for p in per])) for W in A.WINDOWS},
            "sem": {str(W): float(np.std([p[W] for p in per], ddof=1) / np.sqrt(n)) for W in A.WINDOWS},
        }
        print(f"[scaling] linear N={N:2d} 10s {out[str(N)]['mean']['10']:.3f} 60s {out[str(N)]['mean']['60']:.3f} 300s {out[str(N)]['mean']['300']:.3f}", flush=True)
    return {"alpha": alpha, "draws": DRAWS, "sizes": out}


def learned():
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "runs", "n.*.seed*.json"))) + sorted(glob.glob(os.path.join(ROOT, "runs", "b.lr1e3.seed*.json"))):
        r = json.load(open(path))
        N = r["config"].get("ntrain") or 25
        seed = r["config"]["seed"]
        out.setdefault(str(N), {})[str(seed)] = {"mean": {str(k): v for k, v in r["mean"].items()}, "sem": {str(k): v for k, v in r["sem"].items()}}
    return out


def main():
    subjects = A.load()
    res = {"people": len(subjects), "electrodes": {"left": LEFT4, "right": RIGHT4}, "montage": "wireless", "linear": linear(subjects), "learned": learned()}
    with open(os.path.join(ROOT, "scaling.json"), "w") as f:
        json.dump(res, f, indent=1)
    print("[scaling] wrote scaling.json", flush=True)


if __name__ == "__main__":
    main()
