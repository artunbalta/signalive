#!/usr/bin/env python3
"""
In the ear, around it, or on the scalp: the same people at the same moment.

Ear-SAAD (Geirnaert, Kappel and Kidmose; Zenodo 16536441; Scientific Reports
2025): 15 people, each six 10 minute trials of two competing Danish lectures
at plus and minus 60 degrees through insert earphones, attending the left in
some trials and the right in others. Recorded at once: 29 scalp channels, 9
or 10 wet electrodes around each ear, and 6 dry electrodes in each ear canal
and concha, at 1000 Hz. The dataset's own description file gives its license
as CC BY-NC-SA 4.0: it is used here for research and only results are kept.

Each trial goes through exactly the chain the earbuds run (research/aad
/pipeline.py), at this recording's rate: causal Butterworth band pass 1 to 9
Hz of order 2, then 64 Hz by linear interpolation. The lectures' envelopes
are made the way ds004015's were (each file divided by its standard
deviation, the absolute Hilbert transform, a 3rd order 8 Hz low pass, 64 Hz),
from the 5th second of each file on, which is where the trials begin
(the authors' preprocessFromBIDS.m). In stim_file the first file is the
left one: every trial's attended_ear agrees.

    python3 research/ext/earsaad_prep.py

Writes data/earsaad/prep/sub-XX.npz.
"""
import csv
import glob
import os
import sys

import numpy as np
import scipy.io as sio
import scipy.io.wavfile as wavfile
from scipy.signal import butter, hilbert, resample_poly, sosfilt, sosfiltfilt

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "..", "aad"))
from pipeline import BAND, FS, ORDER, decimate  # noqa: E402

DATA = os.path.join(ROOT, "data", "earsaad")
BIDS = os.path.join(DATA, "bids_dataset")
OUT = os.path.join(DATA, "prep")
FS_RAW = 1000
AUDIO_START_S = 5
TAIL = 48


def envelope(path):
    """ds004015's envelope: std normalised, absolute Hilbert, 8 Hz low pass, 64 Hz."""
    rate, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    x = x[AUDIO_START_S * rate :]
    x /= x.std() + 1e-12
    # Hilbert at 8 kHz is the same envelope for speech and far cheaper than at 48 kHz.
    x = resample_poly(x, 1, rate // 8000)
    env = np.abs(hilbert(x))
    env = sosfiltfilt(butter(3, 8, fs=8000, output="sos"), env)
    return resample_poly(env, FS, 8000)


def load_set(sub):
    stem = os.path.join(BIDS, sub, "ses-01", "eeg", f"{sub}_ses-01_task-selectiveAttention")
    m = sio.loadmat(stem + "_eeg.set", squeeze_me=True, struct_as_record=False)
    # These files keep EEGLAB's fields at the top level rather than inside an EEG struct.
    eeg = m["EEG"] if "EEG" in m else m
    get = (lambda k: getattr(eeg, k)) if not isinstance(eeg, dict) else (lambda k: eeg[k])
    assert int(get("srate")) == FS_RAW, get("srate")
    trials = int(get("trials"))
    pnts = int(get("pnts"))
    # Epoched EEGLAB data: channel fastest, then sample, then trial.
    x = np.fromfile(stem + "_eeg.fdt", dtype="<f4").reshape(pnts * trials, int(get("nbchan"))).T
    names = [c.labels for c in np.atleast_1d(get("chanlocs"))]
    with open(stem + "_events.tsv") as f:
        events = list(csv.DictReader(f, delimiter="\t"))
    return x, names, pnts, trials, events


def main():
    os.makedirs(OUT, exist_ok=True)
    envs = {}
    for path in sorted(glob.glob(os.path.join(BIDS, "stimuli", "*.wav"))):
        envs[os.path.basename(path)] = envelope(path)
        print(f"[earsaad_prep] envelope {os.path.basename(path)}: {len(envs[os.path.basename(path)]) / FS:.0f} s", flush=True)
    sos = butter(ORDER, BAND, btype="bandpass", fs=FS_RAW, output="sos")
    subs = sorted(d for d in os.listdir(BIDS) if d.startswith("sub-"))
    for sub in subs:
        out = os.path.join(OUT, f"{sub}.npz")
        if os.path.exists(out):
            continue
        x, names, pnts, trials, events = load_set(sub)
        arrays = {}
        sides = []
        # The six trials are stored back to back as one stretch; the events say where each lies.
        for t, ev in enumerate(events):
            a = int(round(float(ev["onset"]) * FS_RAW))
            length = int(round(float(ev["duration"]) * FS_RAW))
            seg = x[:, a : a + length].astype(np.float64)
            filtered = sosfilt(sos, seg, axis=-1)
            n = int((seg.shape[1] - 2) * FS / FS_RAW) - TAIL
            arrays[f"eeg{t}"] = decimate(filtered, n + TAIL, fs_in=FS_RAW).astype(np.float32)
            assert seg.shape[1] == length, (sub, t, seg.shape)
            left, right = ev["stim_file"].split(";")
            for k, name in ((1, left), (2, right)):
                e = envs[name][:n]
                if len(e) < n:
                    e = np.pad(e, (0, n - len(e)))
                arrays[f"env{k}_{t}"] = e.astype(np.float32)
            sides.append(ev["attended_ear"])
            arrays[f"video{t}"] = np.array(ev["video_condition"] == "yes")
        np.savez(out, channels=np.array(names), sides=np.array(sides), **arrays)
        print(f"[earsaad_prep] {sub}: {len(sides)} trials, attended {''.join(s[0] for s in sides)}", flush=True)


if __name__ == "__main__":
    main()
