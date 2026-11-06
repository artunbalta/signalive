#!/usr/bin/env python3
"""
Real jaw clenches, and real things that are not clenches, recorded around the
ear, for the phone's clench detector (lib/sense/clench.ts) to be judged on.

Source: Park, Kim, Choi and Hwang, "Systematic investigation of optimal
electrode positions and re-referencing strategies on ear biosignals",
Figshare 10.6084/m9.figshare.23523588 (version 3), CC BY 4.0. Fifteen people,
18 electrodes around the ears (L1 to L9, R1 to R9), 250 Hz:

  clench     10 cued clenches of 3 s, each followed by 3 s of rest
  blink      10 cued bouts of 3 s of blinking, each followed by 3 s of rest
  eyes       eye movements up, down, right and left, 10 of each
  alpha      eyes closed and open, 3 trials of 30 s each
  ecg        3 trials of 60 s at rest, recorded for the heartbeat

Everything except the clench task is a stretch where any reported gesture is
false. Trials that were recorded separately are joined with 50 ms cross
fades, so a join is never a step the detector could mistake for a burst.

Writes data/park/export/<task>.f32 (float32, people x channels x samples,
little endian) and data/park/export/index.json; clench_real.test.ts reads
them and writes clench_real.json.

    curl -L -o research/ext/data/park/Clench.mat https://ndownloader.figshare.com/files/41253999
    (likewise Blink 70871604, EyeMovement 41254005, AlphaModulation 41253990, ECG 41254002)
    python3 research/ext/clench_export.py
"""
import json
import os

import numpy as np
import scipy.io as sio

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "data", "park")
OUT = os.path.join(SRC, "export")
FS = 250
FADE = int(0.05 * FS)


def load(name):
    m = sio.loadmat(os.path.join(SRC, f"{name}.mat"), squeeze_me=True, struct_as_record=False)
    return m[name]


def join(segments):
    """Trials one after another, each join a 50 ms cross fade."""
    out = segments[0].astype(np.float64)
    ramp = np.linspace(0.0, 1.0, FADE)
    for s in segments[1:]:
        s = s.astype(np.float64)
        head = out[..., -FADE:] * (1 - ramp) + s[..., :FADE] * ramp
        out = np.concatenate([out[..., :-FADE], head, s[..., FADE:]], axis=-1)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    tasks = {}
    c = load("Clench")
    tasks["clench"] = c.Ear.astype(np.float64)
    cues = [int(x) - 1 for x in np.atleast_1d(c.latency)]
    tasks["blink"] = load("Blink").Ear.astype(np.float64)
    eyes = load("EyeMovement").Ear  # people x direction x trial x channel x samples
    tasks["eyes"] = np.stack([join([eyes[p, d, t] for d in range(eyes.shape[1]) for t in range(eyes.shape[2])]) for p in range(eyes.shape[0])])
    alpha = load("AlphaModulation").Ear  # people x condition x trial x channel x samples
    tasks["alpha"] = np.stack([join([alpha[p, k, t] for k in range(alpha.shape[1]) for t in range(alpha.shape[2])]) for p in range(alpha.shape[0])])
    ecg = load("ECG").Ear  # people x trial x channel x samples
    tasks["ecg"] = np.stack([join([ecg[p, t] for t in range(ecg.shape[1])]) for p in range(ecg.shape[0])])

    index = {"fs": FS, "channels": [f"L{i}" for i in range(1, 10)] + [f"R{i}" for i in range(1, 10)], "clenchCues": cues, "clenchSeconds": 3, "tasks": {}}
    for name, x in tasks.items():
        x = x.astype("<f4")
        x.tofile(os.path.join(OUT, f"{name}.f32"))
        index["tasks"][name] = {"people": int(x.shape[0]), "channels": int(x.shape[1]), "samples": int(x.shape[2])}
        print(f"[clench_export] {name}: {x.shape[0]} people, {x.shape[2] / FS:.0f} s each", flush=True)
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f, indent=1)


if __name__ == "__main__":
    main()
