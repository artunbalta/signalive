#!/usr/bin/env python3
"""
A consumer headband's two electrodes behind the ears, for the phone's clench
detector: the Muse 2 recordings of Lee and Ahn's consumer and research grade
EEG set (Figshare 10.6084/m9.figshare.30162868, CC BY 4.0). TP9 (left) and
TP10 (right) at 256 Hz, against the headband's forehead reference, for:

  BT   1 min of rest, 20 cued jaw clenches 3 s apart, 1 min of rest
  EB   the same with eye blinks
  MVO  the same with head movements, eyes open
  MVC  the same with head movements, eyes closed

Writes data/muse/export/<task>/<person>.f32 (TP9 then TP10, little endian
float32) and data/muse/export/index.json; clench_muse.test.ts reads them.

    curl -L -o research/ext/data/muse/sourcedata.zip https://ndownloader.figshare.com/files/58088461
    (cd research/ext/data/muse && unzip -q sourcedata.zip "sourcedata/*Muse2*")
    python3 research/ext/muse_export.py
"""
import glob
import json
import os

import numpy as np

from edf import read_edf

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "data", "muse", "sourcedata")
OUT = os.path.join(ROOT, "data", "muse", "export")
TASKS = ("BT", "EB", "MVO", "MVC")
# OpenViBE stimulation codes in the annotations: 00 start, 01 task start, 02 each cue, 03 task end, 04 end.
CUE = "OVTK_StimulationId_Number_02"


def main():
    index = {"fs": 256, "channels": ["TP9", "TP10"], "tasks": {}}
    for task in TASKS:
        os.makedirs(os.path.join(OUT, task), exist_ok=True)
        rows = []
        for path in sorted(glob.glob(os.path.join(SRC, "sub-*", f"*_task-{task}_acq-Muse2_eeg.edf"))):
            person = os.path.basename(path).split("_")[0]
            labels, rates, signals, notes = read_edf(path)
            fs = rates[labels.index("TP9")]
            x = np.stack([signals[labels.index("TP9")], signals[labels.index("TP10")]]).astype("<f4")
            x.tofile(os.path.join(OUT, task, f"{person}.f32"))
            cues = [t for t, _, text in notes if text == CUE]
            start = next((t for t, _, text in notes if text.endswith("_01")), None)
            end = next((t for t, _, text in notes if text.endswith("_03")), None)
            rows.append({"person": person, "fs": fs, "samples": int(x.shape[1]), "cues": cues, "taskStart": start, "taskEnd": end})
        index["tasks"][task] = rows
        print(f"[muse_export] {task}: {len(rows)} people", flush=True)
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f, indent=1)


if __name__ == "__main__":
    main()
