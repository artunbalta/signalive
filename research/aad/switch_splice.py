#!/usr/bin/env python3
"""
How fast the belief follows a switch, on EEG that really switches.

belief.py simulates a switch by flipping the decisions after it, as if the
decoder were exactly as good the moment attention moved. Here the EEG itself
switches: every person heard the same two stories in the same blocks, so a
person who followed the left story and one who followed the right, decoded by
the same fold's models (which saw neither), can be cut together at any moment
into one listener whose attended story changes there. Their EEG is scaled by
each person's own first two minutes, as each earbud would scale it.

For each such pair and each block both have, the spliced listener follows
one story for a random 60 to 180 s, then the other, and so on. The 10 s
decisions on the spliced EEG (each window judged on its own samples, so a
window across a cut hears both people) go through the belief of
lib/sense/fusion.ts (belief.py's follow), with the decision weight fitted
on the same held out decisions. A switch is timed from the cut to the first
decision after which the belief favours the new story; it counts only when
the belief favoured the old story just before.

    python3 research/aad/switch_splice.py <tag> <seed>   # needs deep3 run saved with "save": true

Writes research/aad/runs/<tag>.seed<S>.splice.json.
"""
import json
import os
import sys

import numpy as np
import torch

import belief as B
import calibrate as C
import deep3 as D
from pipeline import FS

DECIDE = C.SECONDS * FS
HAZARDS = [0.01, 0.02, 0.05]


def margins_of(models, eeg, att, una, pre):
    """Ten second margins (followed minus other) of one stretch, judged window by window."""
    emb = D.embed(models, eeg, att, una, pre)
    s = np.mean([D.window_scores(ze, zs, DECIDE) for ze, zs in emb], axis=0)
    return s[0] - s[1]


def main():
    tag, seed = sys.argv[1], int(sys.argv[2])
    with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.json")) as f:
        run = json.load(f)
    cfg = run["config"]
    people = {p["id"]: p for p in D.load(cfg)}
    mdir = os.path.join(D.RUNS, "models", f"{tag}.seed{seed}")
    weight = run["calibration"]["weight"]
    rng = np.random.default_rng(seed)
    results = {h: {"took": [], "missed": 0, "settledSwitches": 0, "steady": []} for h in HAZARDS}
    pairs = 0
    for g, fold in enumerate(run["folds"]):
        nets = []
        for k in range(cfg["ensemble"]):
            m = D.Decoder(8, cfg).to(D.DEVICE)
            m.load_state_dict(torch.load(os.path.join(mdir, f"fold{g}_net{k}.pt"), map_location=D.DEVICE))
            m.eval()
            nets.append(m)
        test = fold["test"]
        left = [p for p in test if people[p]["side"] == "left"]
        right = [p for p in test if people[p]["side"] == "right"]
        for a in left:
            for b in right:
                pa, pb = people[a], people[b]
                for blk in sorted(set(pa["testParts"]) & set(pb["testParts"])):
                    ia, ib = pa["testParts"].index(blk), pb["testParts"].index(blk)
                    ea, att_a, una_a = pa["test"][ia]
                    eb, _, _ = pb["test"][ib]
                    T = min(ea.shape[1], eb.shape[1])
                    # att_a is the left story (a followed it); b followed the right one.
                    left_env, right_env = att_a[:T], una_a[:T]
                    # Cuts every 60 to 180 s; who is heard (0 = a, left story followed) alternates.
                    cuts, t, who = [], 0, int(rng.integers(2))
                    owner = np.zeros(T, dtype=np.int64)
                    while t < T:
                        span = int(rng.uniform(60, 180) * FS)
                        owner[t : t + span] = who
                        t += span
                        if t < T:
                            cuts.append((t, 1 - who))
                        who = 1 - who
                    eeg = np.where(owner[None, :] == 0, ea[:, :T], eb[:, :T]).astype(np.float32)
                    # The margin for the left story; the followed one is the owner's.
                    mg = margins_of(nets, eeg, left_env, right_env, cfg["pre"])
                    n = len(mg)
                    truth = np.array([owner[min(T - 1, i * DECIDE + DECIDE // 2)] for i in range(n)])
                    for h in HAZARDS:
                        # belief.follow takes margins for "the story that was followed"; feed the left story's
                        # margin and read the belief for the left story.
                        p_left = B.follow(mg, weight, h)
                        for c, new in cuts:
                            i0 = c // DECIDE
                            if i0 < 1 or i0 >= n:
                                continue
                            old_left = new == 1
                            settled = (p_left[i0 - 1] > 0.5) == old_left
                            if not settled:
                                continue
                            results[h]["settledSwitches"] += 1
                            nxt = next((cc for cc, _ in cuts if cc > c), T)
                            got = None
                            for i in range(i0, min(n, nxt // DECIDE)):
                                if (p_left[i] > 0.5) == (new == 0):
                                    got = (i + 1) * DECIDE - c
                                    break
                            if got is None:
                                results[h]["missed"] += 1
                            else:
                                results[h]["took"].append(got / FS)
                        # Steadiness: decisions more than 60 s after a cut on which the belief names the owner.
                        ok = []
                        for i in range(n):
                            mid = i * DECIDE + DECIDE // 2
                            last = max([cc for cc, _ in cuts if cc <= mid], default=0)
                            if mid - last > 60 * FS:
                                ok.append((p_left[i] > 0.5) == (truth[i] == 0))
                        results[h]["steady"].extend(ok)
                    pairs += 1
        print(f"[splice] fold {g + 1}/{len(run['folds'])}: {pairs} pair blocks", flush=True)
    out = {"model": f"{tag}.seed{seed}", "weight": weight, "pairBlocks": pairs, "byHazard": {}}
    for h, r in results.items():
        took = np.array(r["took"])
        out["byHazard"][str(h)] = {
            "settledSwitches": r["settledSwitches"],
            "followed": int(len(took)),
            "missed": r["missed"],
            "switchMedianS": float(np.median(took)) if len(took) else None,
            "switchP75S": float(np.percentile(took, 75)) if len(took) else None,
            "steadyShare": float(np.mean(r["steady"])) if r["steady"] else None,
        }
        o = out["byHazard"][str(h)]
        print(f"[splice] h {h}: followed {o['followed']}/{o['settledSwitches']} median {o['switchMedianS']} s, steady {o['steadyShare']}", flush=True)
    with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.splice.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
