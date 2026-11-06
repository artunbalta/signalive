#!/usr/bin/env python3
"""
Decoder v3 with the movement gate, on every held out person.

hardware_bars.py found that a gate which blanks every channel for half a
second after any 64 Hz sample over five times its channel's spread wins back
most of what movement jolts cost, and raised one minute accuracy on the clean
recordings too: they carry jolts of their own. Its two settings were fixed
before it was run and are not tuned here. This scores the final models of
each split (all five networks per fold) on their test people with and
without it.

    python3 research/aad/gate_check.py final 7 [11 23]

Writes research/aad/runs/<tag>.gate.<seeds>.json; with "merge" in place of the
seeds, joins every such file into research/aad/gate.json.
"""
import json
import os
import sys

import numpy as np

import deep3 as D
import hardware_bars as H

SHOW = [10, 60, 300]


def merge(tag):
    import glob

    files = sorted(glob.glob(os.path.join(D.RUNS, f"{tag}.gate.*.json")))
    splits = {}
    for p in files:
        splits.update(json.load(open(p))["splits"])
    out = {"model": tag, "seeds": sorted(int(s) for s in splits), "threshold": 5.0, "holdSeconds": 0.5, "splits": splits}
    out["mean"] = {g: {W: float(np.mean([s[g][W] for s in splits.values()])) for W in splits[next(iter(splits))][g]} for g in ("off", "on")}
    out["blankedShare"] = float(np.mean([s["blankedShare"] for s in splits.values()]))
    with open(os.path.join(D.ROOT, "gate.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("[gate] merged: " + "  ".join(f"{W}s {out['mean']['off'][str(W)]:.3f} -> {out['mean']['on'][str(W)]:.3f}" for W in SHOW), flush=True)


def main():
    if sys.argv[2] == "merge":
        return merge(sys.argv[1])
    tag, seeds = sys.argv[1], [int(s) for s in sys.argv[2:]]
    out = {"model": tag, "seeds": seeds, "threshold": 5.0, "holdSeconds": 0.5, "splits": {}}
    per_all = {g: {W: [] for W in D.WINDOWS} for g in ("off", "on")}
    for seed in seeds:
        with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.json")) as f:
            cfg = json.load(f)["config"]
        os.environ["HW_NETS"] = str(cfg["ensemble"])
        people = {p["id"]: p for p in D.load(cfg)}
        folds = H.load_models(tag, seed, cfg)
        per = {g: {W: [] for W in D.WINDOWS} for g in ("off", "on")}
        blanked = []
        for test, nets in folds:
            for pid in test:
                for g in ("off", "on"):
                    blocks = people[pid]["test"]
                    if g == "on":
                        gated = []
                        for eeg, att, una in blocks:
                            x = H.causal_gate(np.asarray(eeg, dtype=np.float64)).astype(np.float32)
                            blanked.append(float(np.mean(np.all(x == 0, axis=0))))
                            gated.append((x, att, una))
                        blocks = gated
                    hits, _ = D.evaluate_hits(nets, blocks, cfg["pre"])
                    for W in D.WINDOWS:
                        if hits[W]:
                            per[g][W].append(float(np.mean(hits[W])))
            print(f"[gate] split {seed}: fold done", flush=True)
        out["splits"][str(seed)] = {g: {str(W): float(np.mean(v)) for W, v in per[g].items() if v} for g in per}
        out["splits"][str(seed)]["blankedShare"] = float(np.mean(blanked))
        for g in per:
            for W in D.WINDOWS:
                per_all[g][W].append(out["splits"][str(seed)][g].get(str(W), float("nan")))
        s = out["splits"][str(seed)]
        print(f"[gate] split {seed}: " + "  ".join(f"{W}s {s['off'][str(W)]:.3f} -> {s['on'][str(W)]:.3f}" for W in SHOW) + f"  (blanked {s['blankedShare']:.1%})", flush=True)
    out["mean"] = {g: {str(W): float(np.nanmean(v)) for W, v in per_all[g].items()} for g in per_all}
    print("[gate] mean: " + "  ".join(f"{W}s {out['mean']['off'][str(W)]:.3f} -> {out['mean']['on'][str(W)]:.3f}" for W in SHOW), flush=True)
    with open(os.path.join(D.RUNS, f"{tag}.gate.{'-'.join(map(str, seeds))}.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
