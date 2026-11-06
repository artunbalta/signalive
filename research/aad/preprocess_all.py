#!/usr/bin/env python3
"""
Every block of every person, not just the three the published analysis uses.

preprocess.py keeps each person's three "selected" blocks, the ones where both
stories were equally loud, and deletes the raw recording. Each person has
five blocks with an envelope for both stories:

- Jaeger et al. 2020 (sub-001 to sub-015): all five equally loud; three
  selected to match the other study's design, two left over.
- Holtze et al. 2021 (sub-016 to sub-036): blocks 1 and every other one after
  equally loud (omnidirectional), the other two with the followed story louder
  (beamforming), in the order participants.tsv gives (OBOB or BOBO).

The extra blocks may only ever train a model. Every number on the page is
still measured on the selected blocks of people the model never saw, so the
two are comparable.

The raw recordings stay in data/raw_full (about 6.5 GB), because the hardware
experiments in hardware_bars.py rerun the whole chain from the electrode rate
with noise, quantisation and lost samples added.

    python3 research/aad/preprocess_all.py         # all 36, four downloads at a time
    python3 research/aad/preprocess_all.py 1 2 3

Output: research/aad/data/prep_all/sub-XXX.npz
"""
import csv
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import scipy.io as sio

from pipeline import FS, FS_RAW, bandpass_sos, causal_filter, decimate
from preprocess import DATA, TAIL, TASK, WARMUP_S, fetch, participants, stimuli

RAW = os.path.join(DATA, "raw_full")
OUT = os.path.join(DATA, "prep_all")
BLOCKS = 5


def files(sub):
    stem = f"{sub}/eeg/{sub}_{TASK}"
    return [
        (f"{stem}_eeg.set", os.path.join(RAW, f"{sub}_eeg.set")),
        (f"{stem}_eeg.fdt", os.path.join(RAW, f"{sub}_eeg.fdt")),
        (f"{stem}_events.tsv", os.path.join(RAW, f"{sub}_events.tsv")),
    ]


def download(sub):
    for rel, dest in files(sub):
        fetch(rel, dest)
    return sub


def load_raw(sub):
    """Channels x samples in microvolts, names, block onsets (samples), boundary samples, selected blocks."""
    (_, set_path), (_, fdt_path), (_, ev_path) = files(sub)
    eeg = sio.loadmat(set_path, squeeze_me=True, struct_as_record=False)["EEG"]
    assert eeg.srate == FS_RAW, eeg.srate
    x = np.fromfile(fdt_path, dtype="<f4").reshape(eeg.pnts, eeg.nbchan).T
    names = [c.labels for c in eeg.chanlocs]
    onsets, bounds = [], []
    with open(ev_path) as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r["value"] == "StartTrigger":
                onsets.append(int(round(float(r["onset"]) * FS_RAW)))
            elif r["value"] == "boundary":
                bounds.append(int(round(float(r["onset"]) * FS_RAW)))
    selected = [int(b) for b in np.atleast_1d(eeg.selected_bl)]
    return x, names, onsets, bounds, selected


def conditions(meta):
    """'O' (equally loud) or 'B' (followed story louder) for blocks 1 to 5."""
    if meta["orig_study"] == "jaeger2020":
        return ["O"] * BLOCKS
    return ["O"] + list(meta["con_order"])


def prepare(sub, meta, env):
    out = os.path.join(OUT, f"{sub}.npz")
    if os.path.exists(out):
        return out, None
    x, names, onsets, bounds, selected = load_raw(sub)
    cond = conditions(meta)
    sos_raw = bandpass_sos(FS_RAW)
    arrays, kept, valid = {}, [], []
    for block in range(1, BLOCKS + 1):
        if block > len(onsets):
            continue
        n = len(env[1][block])
        start = onsets[block - 1]
        lead = WARMUP_S * FS_RAW
        need = int(np.ceil((n + TAIL) * FS_RAW / FS)) + 2
        if start - lead < 0 or start + need > x.shape[1]:
            continue
        # A boundary inside the block means samples were cut out there, so the
        # EEG no longer lines up with the story after it: keep what comes before.
        inside = [b for b in bounds if start < b < start + need]
        good = n if not inside else int((min(inside) - start) * FS / FS_RAW) - TAIL - 1
        if good < 120 * FS:
            continue
        seg = x[:, start - lead : start + need].astype(np.float64)
        filtered = causal_filter(sos_raw, seg)
        arrays[f"eeg{block}"] = decimate(filtered[:, lead:], n + TAIL).astype(np.float32)
        arrays[f"env1_{block}"] = env[1][block].astype(np.float32)
        arrays[f"env2_{block}"] = env[2][block].astype(np.float32)
        arrays[f"onset{block}"] = np.int64(start)
        kept.append(block)
        valid.append(good)
    os.makedirs(OUT, exist_ok=True)
    np.savez(
        out,
        channels=np.array(names),
        attended=meta["attended_ch"],
        study=meta["orig_study"],
        selected=np.array(selected),
        blocks=np.array(kept),
        valid=np.array(valid),
        cond=np.array([cond[b - 1] for b in kept]),
        **arrays,
    )
    return out, (kept, valid, [cond[b - 1] for b in kept], selected)


def main():
    people = participants()
    env = stimuli()
    wanted = [f"sub-{int(a):03d}" for a in sys.argv[1:]] or sorted(people)
    os.makedirs(RAW, exist_ok=True)
    with ThreadPoolExecutor(4) as pool:
        for sub in pool.map(download, wanted):
            path, info = prepare(sub, people[sub], env)
            if info:
                kept, valid, cond, sel = info
                desc = " ".join(f"{b}{c}{'*' if b in sel else ''}:{v // FS}s" for b, c, v in zip(kept, cond, valid))
            else:
                desc = "(already prepared)"
            print(f"[preprocess_all] {sub} {desc}", flush=True)


if __name__ == "__main__":
    main()
