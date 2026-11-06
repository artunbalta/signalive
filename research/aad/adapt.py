#!/usr/bin/env python3
"""
Does the decoder get better the longer someone wears it?

Each held out person's three test blocks are in the order they were
recorded. The generic model (a fold model saved by deep3.py that never saw
the person) is fine tuned on the first block, ten minutes, and judged on the
two blocks after it; then on the first two and judged on the third.

- generic: no fine tuning, the reference.
- labelled: fine tuned with the truth, the most any adaptation could reach.
- self: fine tuned with no labels at all. The model's own verdict over the
  whole adaptation period (one decision over ten or twenty minutes, right
  about nine times in ten) says which story the person followed, and the
  network is tuned as if that were true.

Only the EEG side is tuned: the envelope network stays as trained, so a
tuned model cannot learn to recognise a narrator's voice instead of reading
the EEG. The 97 s out of step control checks that anyway, for every arm.

    python3 research/aad/adapt.py <tag> <seed>

Writes research/aad/runs/<tag>.seed<S>.adapt.json.
"""
import copy
import json
import os
import sys
import time

import numpy as np
import torch

import deep3 as D
from pipeline import FS

STEPS_EPOCHS = 3
LR = 3e-4


def verdict(models, blocks, pre):
    """Which story the model believes was followed over all of these blocks: 0 the followed one, 1 the other."""
    totals = np.zeros(2)
    for eeg, att, una in blocks:
        for ze, zs in D.embed(models, eeg, att, una, pre):
            T = ze.shape[1] - ze.shape[1] % (60 * FS)
            s = D.window_scores(ze[:, :T], [z[:, :T] for z in zs], 60 * FS)
            totals += s.sum(axis=1)
    return 0 if totals[0] >= totals[1] else 1


def tune(models, blocks, cfg, label, seed):
    """A copy of each network with its EEG side tuned on these blocks, the story at label taken as followed."""
    rng = np.random.default_rng(seed)
    if label == 1:
        blocks = [(eeg, una, att) for eeg, att, una in blocks]
    n = cfg["crop_s"] * D.FS
    out = []
    for m in models:
        m = copy.deepcopy(m)
        opt = torch.optim.Adam(m.eeg.parameters(), lr=LR)
        for _ in range(STEPS_EPOCHS):
            X, E = D.crops(blocks, n, cfg["pre"], rng, 1)
            order = rng.permutation(len(X))
            m.train()
            m.env.eval()
            for i in range(0, len(order), 64):
                idx = order[i : i + 64]
                x = torch.from_numpy(X[idx]).to(D.DEVICE)
                e = torch.from_numpy(E[idx]).to(D.DEVICE)
                swap = torch.from_numpy(rng.random(len(idx)) < 0.5).to(D.DEVICE)
                loss = D.pair_loss(m, x, e, swap)
                opt.zero_grad()
                loss.backward()
                opt.step()
        m.eval()
        out.append(m)
    return out


def main():
    tag, seed = sys.argv[1], int(sys.argv[2])
    with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.json")) as f:
        run = json.load(f)
    cfg = run["config"]
    people = {p["id"]: p for p in D.load(cfg)}
    mdir = os.path.join(D.RUNS, "models", f"{tag}.seed{seed}")
    arms = ("generic", "labelled", "self")
    res = {after: {arm: {"acc": [], "control": []} for arm in arms} for after in ("10min", "20min")}
    right = {"10min": [], "20min": []}
    t0 = time.time()
    for g, fold in enumerate(run["folds"]):
        nets = []
        for k in range(cfg["ensemble"]):
            m = D.Decoder(8, cfg).to(D.DEVICE)
            m.load_state_dict(torch.load(os.path.join(mdir, f"fold{g}_net{k}.pt"), map_location=D.DEVICE))
            m.eval()
            nets.append(m)
        for pid in fold["test"]:
            blocks = people[pid]["test"]
            if len(blocks) < 3:
                continue
            for after, k in (("10min", 1), ("20min", 2)):
                fit, judge = blocks[:k], blocks[k:]
                own = verdict(nets, fit, cfg["pre"])
                right[after].append(own == 0)
                arms_models = {
                    "generic": nets,
                    "labelled": tune(nets, fit, cfg, 0, seed + g),
                    "self": tune(nets, fit, cfg, own, seed + g),
                }
                for arm, ms in arms_models.items():
                    acc, _ = D.evaluate(ms, judge, cfg["pre"])
                    ctl, _ = D.evaluate(ms, judge, cfg["pre"], shift_s=97)
                    res[after][arm]["acc"].append(acc)
                    res[after][arm]["control"].append(ctl)
        print(f"[adapt] fold {g + 1}/6 ({time.time() - t0:.0f}s)", flush=True)
    out = {"model": f"{tag}.seed{seed}", "epochs": STEPS_EPOCHS, "lr": LR, "verdictRight": {a: float(np.mean(v)) for a, v in right.items()}}
    for after in res:
        out[after] = {}
        for arm in arms:
            accs = res[after][arm]["acc"]
            ctls = res[after][arm]["control"]
            out[after][arm] = {
                "mean": {W: float(np.nanmean([a[W] for a in accs])) for W in (10, 60, 300)},
                "control": {W: float(np.nanmean([c[W] for c in ctls])) for W in (10, 60, 300)},
                "perSubject60": [round(a[60], 4) for a in accs],
            }
            m, c = out[after][arm]["mean"], out[after][arm]["control"]
            print(f"[adapt] after {after} {arm:>8}: 10s {m[10]:.3f} 60s {m[60]:.3f} 300s {m[300]:.3f} | control 60s {c[60]:.3f}", flush=True)
    with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.adapt.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
