#!/usr/bin/env python3
"""
Prepares the public cEEGrid attended speaker data set for attention decoding.

The data set (OpenNeuro ds004015, CC0, Holtze et al. 2022) holds EEG from 36
people wearing cEEGrids, flexible electrode arrays that sit around the ear,
while two audiobooks played at once, one on the left and one on the right.
Each person was told to follow one side for the whole session.

For every participant this keeps the three 10 minute blocks in which both
stories were equally loud (the data set's own "selected blocks"), filters and
resamples them exactly the way the earbud pipeline does (causal: no step uses
a sample from the future), and stores them at 64 Hz next to the two stories'
speech envelopes.

    python3 research/aad/preprocess.py           # all 36 participants
    python3 research/aad/preprocess.py 1 2 3     # some of them

Raw recordings are fetched one at a time and deleted after use, so the disk
holds at most one (about 200 MB). Output: research/aad/data/prep/sub-XXX.npz
"""
import csv
import os
import sys
import urllib.request

import numpy as np
import scipy.io as sio

from pipeline import FS, FS_RAW, bandpass_sos, causal_filter, decimate

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
RAW = os.path.join(DATA, "raw")
PREP = os.path.join(DATA, "prep")
BASE = "https://s3.amazonaws.com/openneuro.org/ds004015"
TASK = "task-AttendedSpeakerParadigmcEEGridAttention"
# Lags reach half a second past the end of a block, so keep a little more EEG.
TAIL = 48
# The causal filters start this long before a block so they have settled.
WARMUP_S = 20


def fetch(rel, dest):
    if os.path.exists(dest):
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    with urllib.request.urlopen(f"{BASE}/{rel}", timeout=120) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)
    return dest


def participants():
    path = fetch("participants.tsv", os.path.join(DATA, "participants.tsv"))
    with open(path) as f:
        return {row["participant_id"]: row for row in csv.DictReader(f, delimiter="\t")}


def stimuli():
    """Speech envelope of each story part at 64 Hz: env[story][part], both 1 based."""
    env = {1: {}, 2: {}}
    for story in (1, 2):
        for part in range(1, 6):
            p = fetch(f"stimuli/Mirkovic2016_{story}_{part}.mat", os.path.join(DATA, "stimuli", f"Mirkovic2016_{story}_{part}.mat"))
            env[story][part] = sio.loadmat(p, squeeze_me=True)["env_resampled"].astype(np.float64)
    return env


def load_eeg(sub):
    """Channels x samples in microvolts, channel names, block onsets in samples."""
    stem = f"{sub}/eeg/{sub}_{TASK}"
    set_path = fetch(f"{stem}_eeg.set", os.path.join(RAW, f"{sub}_eeg.set"))
    fdt_path = fetch(f"{stem}_eeg.fdt", os.path.join(RAW, f"{sub}_eeg.fdt"))
    ev_path = fetch(f"{stem}_events.tsv", os.path.join(RAW, f"{sub}_events.tsv"))
    eeg = sio.loadmat(set_path, squeeze_me=True, struct_as_record=False)["EEG"]
    assert eeg.srate == FS_RAW, eeg.srate
    # EEGLAB writes [channels x samples] column major: every sample's channels together.
    x = np.fromfile(fdt_path, dtype="<f4").reshape(eeg.pnts, eeg.nbchan).T.astype(np.float64)
    names = [c.labels for c in eeg.chanlocs]
    with open(ev_path) as f:
        onsets = [float(r["onset"]) for r in csv.DictReader(f, delimiter="\t") if r["value"] == "StartTrigger"]
    selected = [int(b) for b in np.atleast_1d(eeg.selected_bl)]
    return x, names, [int(round(o * FS_RAW)) for o in onsets], selected, (set_path, fdt_path, ev_path)


def prepare(sub, meta, env):
    out = os.path.join(PREP, f"{sub}.npz")
    if os.path.exists(out):
        return out
    x, names, onsets, selected, files = load_eeg(sub)
    sos_raw = bandpass_sos(FS_RAW)
    sos_env = bandpass_sos(FS)
    arrays = {}
    for i, block in enumerate(selected):
        n = len(env[1][block])
        start = onsets[block - 1]
        lead = WARMUP_S * FS_RAW
        need = int(np.ceil((n + TAIL) * FS_RAW / FS)) + 2
        seg = x[:, start - lead : start + need]
        filtered = causal_filter(sos_raw, seg)
        arrays[f"eeg{i}"] = decimate(filtered[:, lead:], n + TAIL).astype(np.float32)
        arrays[f"s1_{i}"] = causal_filter(sos_env, env[1][block]).astype(np.float32)
        arrays[f"s2_{i}"] = causal_filter(sos_env, env[2][block]).astype(np.float32)
        arrays[f"raw_env1_{i}"] = env[1][block].astype(np.float32)
        arrays[f"raw_env2_{i}"] = env[2][block].astype(np.float32)
    os.makedirs(PREP, exist_ok=True)
    np.savez(
        out,
        channels=np.array(names),
        attended=meta["attended_ch"],
        study=meta["orig_study"],
        blocks=np.array(selected),
        **arrays,
    )
    for f in files[:2]:
        os.remove(f)
    return out


def main():
    people = participants()
    env = stimuli()
    wanted = [f"sub-{int(a):03d}" for a in sys.argv[1:]] or sorted(people)
    for sub in wanted:
        path = prepare(sub, people[sub], env)
        print(f"[preprocess] {sub} {people[sub]['attended_ch']:>5}  -> {os.path.relpath(path, ROOT)}", flush=True)


if __name__ == "__main__":
    main()
