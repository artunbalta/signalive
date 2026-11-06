#!/usr/bin/env python3
"""
Do the first seconds of a block carry the answer?

On Ear-SAAD a window that began at a trial's first sample heard the sound and
the filters start, and five minute decisions came out at 100%. Here the
filters run 20 s ahead of every block, but the stories still start at the
block's first sample. So the final models score every test block again with
its first seconds dropped from the EEG and both envelopes alike, and the
accuracies are compared window length by window length.

    python3 research/aad/onset_check.py final 7

Writes research/aad/runs/<tag>.seed<S>.onset.json.
"""
import json
import os
import sys

import numpy as np

import deep3 as D
import hardware_bars as H
from pipeline import FS

SKIPS_S = [0, 10, 30]
SHOW = [10, 60, 300]


def main():
    tag, seed = sys.argv[1], int(sys.argv[2])
    with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.json")) as f:
        cfg = json.load(f)["config"]
    os.environ.setdefault("HW_NETS", str(cfg["ensemble"]))
    people = {p["id"]: p for p in D.load(cfg)}
    folds = H.load_models(tag, seed, cfg)
    per = {s: {W: [] for W in D.WINDOWS} for s in SKIPS_S}
    for test, nets in folds:
        for pid in test:
            for s in SKIPS_S:
                k = s * FS
                blocks = [(eeg[:, k:], att[k:], una[k:]) for eeg, att, una in people[pid]["test"]]
                hits, _ = D.evaluate_hits(nets, blocks, cfg["pre"])
                for W in D.WINDOWS:
                    if hits[W]:
                        per[s][W].append(float(np.mean(hits[W])))
        print(f"[onset] fold done: {len(test)} people", flush=True)
    out = {"model": f"{tag}.seed{seed}", "nets": len(folds[0][1]), "skipsS": SKIPS_S, "mean": {}}
    for s in SKIPS_S:
        out["mean"][str(s)] = {str(W): float(np.mean(v)) for W, v in per[s].items() if v}
        print(f"[onset] skip {s:2d} s: " + "  ".join(f"{W}s {out['mean'][str(s)][str(W)]:.3f}" for W in SHOW), flush=True)
    with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.onset.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
