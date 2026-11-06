#!/usr/bin/env python3
"""
Half an hour of sitting and listening per person, for the phone's clench
detector to stay quiet on.

The attention recordings research/aad uses (OpenNeuro ds004015, CC0) are 36
people sitting still and following one of two audiobooks: three 10 minute
blocks each, 18 hours in all, at 500 Hz, the earbud's own rate. Nobody was
asked to clench, so every clench the detector reports there is a false
alarm or a jaw movement nobody asked for: either way, something a wearer
listening quietly would not want to trigger a command.

Writes data/listening/<person>_<block>.f32: the selected blocks' raw
microvolts at the 8 electrodes of the wireless montage (4 per ear, in
results.json's order), little endian float32, channel after channel; and
index.json. clench_listening.test.ts runs the detector on them.

    python3 research/aad/preprocess_all.py   # keeps the raw recordings in research/aad/data/raw_full
    python3 research/ext/clench_listening_export.py
"""
import glob
import json
import os
import sys

import numpy as np
import scipy.io as sio

ROOT = os.path.dirname(os.path.abspath(__file__))
AAD = os.path.join(ROOT, "..", "aad")
sys.path.insert(0, AAD)
from preprocess_all import OUT as PREP_ALL, RAW  # noqa: E402

OUT = os.path.join(ROOT, "data", "listening")
FS = 500


def main():
    with open(os.path.join(AAD, "results.json")) as f:
        chans = json.load(f)["configs"]["wireless_4"]["electrodes"]
    os.makedirs(OUT, exist_ok=True)
    index = {"fs": FS, "channels": chans, "blocks": []}
    for path in sorted(glob.glob(os.path.join(PREP_ALL, "sub-*.npz"))):
        pid = os.path.basename(path)[:-4]
        z = np.load(path)
        eeg = sio.loadmat(os.path.join(RAW, f"{pid}_eeg.set"), squeeze_me=True, struct_as_record=False)["EEG"]
        x = np.fromfile(os.path.join(RAW, f"{pid}_eeg.fdt"), dtype="<f4").reshape(eeg.pnts, eeg.nbchan).T
        names = [str(n) for n in z["channels"]]
        rows = [names.index(c) for c in chans]
        valid = dict(zip([int(b) for b in z["blocks"]], [int(v) for v in z["valid"]]))
        for b in sorted(int(s) for s in z["selected"]):
            start = int(z[f"onset{b}"])
            n = int(valid[b] * FS / 64)
            seg = x[rows, start : start + n].astype("<f4")
            seg.tofile(os.path.join(OUT, f"{pid}_{b}.f32"))
            index["blocks"].append({"person": pid, "block": b, "samples": int(n)})
        print(f"[clench_listening_export] {pid}", flush=True)
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f, indent=1)


if __name__ == "__main__":
    main()
