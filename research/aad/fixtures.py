#!/usr/bin/env python3
"""
Reference numbers for lib/sense's tests: filter designs, filtered signals,
resampling and the decoder's reconstruction and window correlations, all
computed here with the reference chain in pipeline.py, so the TypeScript port
is checked against it rather than against itself.

    python3 research/aad/fixtures.py

Writes lib/sense/__fixtures__/dsp.json and decoder.json.
"""
import json
import os

import numpy as np
from scipy.signal import butter, sosfilt

from pipeline import decimate, lagged, window_correlations

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "..", "..", "lib", "sense", "__fixtures__")


def r(x, digits=12):
    return np.round(np.asarray(x, dtype=np.float64), digits).tolist()


def main():
    rng = np.random.default_rng(7)
    designs = []
    for order, band, fs in [(2, (1, 9), 500), (2, (1, 9), 64), (2, (1, 9), 250), (4, (30, 120), 500), (2, (20, 110), 250), (1, (2, 8), 128)]:
        sos = butter(order, band, btype="bandpass", fs=fs, output="sos")
        designs.append({"order": order, "band": list(band), "fs": fs, "sos": r(sos, 15)})

    sos = butter(2, (1, 9), btype="bandpass", fs=500, output="sos")
    x = rng.standard_normal((2, 600)) * 20 + np.array([[5.0], [-3.0]])
    filtered = sosfilt(sos, x, axis=-1)

    raw = np.cumsum(rng.standard_normal(2000)) * 0.5
    n = int(np.floor((len(raw) - 2) * 64 / 500))
    dec = decimate(raw[None, :], n)[0]

    dsp = {
        "designs": designs,
        "sosfilt": {"sos": r(sos, 15), "input": r(x), "output": r(filtered)},
        "decimate": {"fsIn": 500, "fsOut": 64, "input": r(raw), "output": r(dec)},
    }

    lags, ch, n_out, win = 32, 4, 640, 128
    eeg = rng.standard_normal((ch, n_out + lags))
    w = rng.standard_normal(ch * lags) * 0.1
    recon = lagged(eeg, n_out, lags) @ w
    s1 = recon + rng.standard_normal(n_out) * 2.0
    s2 = rng.standard_normal(n_out)
    corr = window_correlations(recon, s1, s2, win)
    decoder = {
        "lags": lags,
        "channels": ch,
        # weights[c][k]: channel c at lag k, the layout lib/sense reads.
        "weights": r(w.reshape(ch, lags)),
        "eeg": r(eeg),
        "recon": r(recon),
        "envelopes": [r(s1), r(s2)],
        "window": win,
        "correlations": r(corr),
    }

    os.makedirs(OUT, exist_ok=True)
    for name, obj in (("dsp.json", dsp), ("decoder.json", decoder)):
        with open(os.path.join(OUT, name), "w") as f:
            json.dump(obj, f, separators=(",", ":"))
        print(f"[fixtures] {name}")


if __name__ == "__main__":
    main()
