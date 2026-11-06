#!/usr/bin/env python3
"""
What sets the clench detector off, movement by movement.

PhysioMotion Artifact (OpenNeuro ds006386, CC0; Yu and He, Scientific Data
2026): 59 scalp channels at 1000 Hz while people blink, raise their
eyebrows, turn and nod their head, swallow, move their tongue as in
speech ("la-la-la"), and clench their molars on cue, each event marked by two
annotators channel by channel. The channels nearest the ears stand in for an
earbud's: FT7, T7, TP7, P7 on the left and FT8, T8, TP8, P8 on the right.

For each person and run this writes the 8 channels in microvolts and the
annotated events, merged across channels into one interval per event:

  data/physiomotion/export/<sub>_<run>.f32   (8 channels, little endian float32)
  data/physiomotion/export/index.json

    python3 research/ext/physiomotion_export.py   # after downloading sub-1 to sub-12 and the annotations
"""
import csv
import glob
import json
import os
import re

import numpy as np

from edf import read_edf

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "data", "physiomotion", "ds006386")
OUT = os.path.join(ROOT, "data", "physiomotion", "export")
LEFT = ["FT7", "T7", "TP7", "P7"]
RIGHT = ["FT8", "T8", "TP8", "P8"]


def events(path):
    """Annotated intervals, merged across the channels each was marked on."""
    by_label = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            a, b = float(row["start_time"]), float(row["stop_time"])
            by_label.setdefault(row["label"], []).append((a, b))
    out = []
    for label, spans in by_label.items():
        spans.sort()
        merged = []
        for a, b in spans:
            if merged and a <= merged[-1][1] + 0.05:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        out.extend({"label": label, "start": round(a, 3), "stop": round(b, 3)} for a, b in merged)
    return sorted(out, key=lambda e: e["start"])


def main():
    os.makedirs(OUT, exist_ok=True)
    index = {"channels": LEFT + RIGHT, "runs": []}
    for edf_path in sorted(glob.glob(os.path.join(SRC, "sub-*", "eeg", "*_eeg.edf"))):
        m = re.search(r"sub-(\d+)_task-artifact_run-(\d+)_eeg\.edf", os.path.basename(edf_path))
        sub, run = m.group(1), m.group(2)
        ann = os.path.join(SRC, "derivatives", "Manual_Annotations", f"sub{sub}_run{run}.csv")
        if not os.path.exists(ann) or os.path.getsize(edf_path) < 1_000_000:
            continue
        labels, rates, signals, _ = read_edf(edf_path)
        names = [l.replace("EEG ", "").strip() for l in labels]
        try:
            rows = [names.index(c) for c in LEFT + RIGHT]
        except ValueError:
            print(f"[physiomotion_export] sub-{sub} run {run}: channels missing, skipped", flush=True)
            continue
        fs = rates[rows[0]]
        x = np.stack([signals[r] for r in rows])
        # The EDF stores volts; the detector works in microvolts.
        if np.nanmedian(np.abs(x)) < 1e-2:
            x = x * 1e6
        name = f"sub-{sub}_run-{run}"
        x.astype("<f4").tofile(os.path.join(OUT, f"{name}.f32"))
        index["runs"].append({"name": name, "fs": fs, "samples": int(x.shape[1]), "events": events(ann)})
        print(f"[physiomotion_export] {name}: {x.shape[1] / fs / 60:.1f} min, {len(index['runs'][-1]['events'])} events", flush=True)
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f)


if __name__ == "__main__":
    main()
