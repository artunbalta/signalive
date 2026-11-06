#!/usr/bin/env python3
"""
What the earbud's electronics must deliver, measured on brains rather than
guessed from datasheets.

Each experiment takes the raw recordings (500 Hz, microvolts, every
electrode), does to them what a cheaper or harsher piece of hardware would,
and reruns the whole chain an earbud runs: causal band pass at the electrode
rate, 64 Hz, each ear referenced to itself, scaled by the first two minutes,
then the learned decoder that never saw the person (the fold models saved by
deep3.py with "save": true). The bar for each spec is where the one minute
accuracy starts to fall.

  noise       white noise added at every electrode, by its density (nV/sqrt(Hz))
  pink        1/f noise, by its rms in the decoder's 1 to 9 Hz band
  lsb         quantisation, by the size of one ADC step (uV)
  rate        sampling rate of the front end (Hz)
  skew        the right earbud's clock offset from the left's (ms)
  loss        Bluetooth frames lost (20 ms each, the last sample held), by rate
  burst       the same, lost in bursts of 200 ms
  artifacts   movement artifacts of 200 uV, by how many per minute
  mains       50 Hz common to every electrode with 1% imbalance, by amplitude (uV)
  envlag      the speech envelopes late (positive) or early against the EEG (ms)
  crosstalk   each talker's envelope with this share of the other's mixed in,
              as imperfect separation of the microphones' sound would leave it
  gated       movement artifacts again, with a simple gate: any 64 Hz sample
              over 5 times a channel's spread blanks every channel for 0.25 s
              either side, so a jolt cannot drive the decision

    python3 research/aad/hardware_bars.py [tag] [seed] [kinds]

The curves are differences against the same model on clean input, so the
first HW_NETS networks of each fold (default 2) are enough.

Writes research/aad/hardware.json.
"""
import json
import os
import sys
import time
import zlib

import numpy as np
import scipy.io as sio
import torch
from scipy.signal import butter, sosfilt

import analyze as A
import deep3 as D
from deep import running_norm
from pipeline import BAND, FS, ORDER, montage_matrix
from preprocess import TAIL, TASK, WARMUP_S
from preprocess_all import OUT as PREP_ALL, RAW

ROOT = os.path.dirname(os.path.abspath(__file__))
FS_RAW = 500

EXPERIMENTS = {
    "noise": [0, 50, 100, 200, 400, 800, 1600, 3200],
    "pink": [0, 0.5, 1, 2, 4, 8, 16],
    "lsb": [0, 0.1, 0.5, 1, 2, 5, 10, 20],
    "rate": [500, 250, 125, 100],
    "skew": [0, 5, 10, 20, 40, 80, 160],
    "loss": [0, 0.01, 0.05, 0.1, 0.2, 0.4],
    "burst": [0, 0.01, 0.05, 0.1, 0.2],
    "artifacts": [0, 1, 2, 5, 10, 20],
    "mains": [0, 100, 1000, 10000, 50000],
    "envlag": [-200, -100, -50, -25, 0, 25, 50, 100, 200],
    "crosstalk": [0, 0.1, 0.2, 0.3, 0.5, 0.7],
    "gated": [0, 1, 2, 5, 10, 20],
}


def raw_blocks(pid):
    """The selected blocks' raw segments (18 x samples, uV) with the warm up before each, and their envelopes."""
    z = np.load(os.path.join(PREP_ALL, f"{pid}.npz"))
    eeg = sio.loadmat(os.path.join(RAW, f"{pid}_eeg.set"), squeeze_me=True, struct_as_record=False)["EEG"]
    x = np.fromfile(os.path.join(RAW, f"{pid}_eeg.fdt"), dtype="<f4").reshape(eeg.pnts, eeg.nbchan).T
    names = [str(n) for n in z["channels"]]
    side = str(z["attended"])
    valid = dict(zip([int(b) for b in z["blocks"]], [int(v) for v in z["valid"]]))
    out = []
    for b in sorted(int(s) for s in z["selected"]):
        start = int(z[f"onset{b}"])
        n = valid[b]
        lead = WARMUP_S * FS_RAW
        need = int(np.ceil((n + TAIL) * FS_RAW / FS)) + 2
        seg = x[:, start - lead : start + need].astype(np.float64)
        e1, e2 = z[f"env1_{b}"].astype(np.float64)[:n], z[f"env2_{b}"].astype(np.float64)[:n]
        att, una = (e1, e2) if side == "left" else (e2, e1)
        out.append((seg, lead, n, att, una))
    return names, out


def resample_linear(x, n, fs_in, fs_out):
    pos = np.arange(n) * (fs_in / fs_out)
    i = np.floor(pos).astype(np.int64)
    frac = pos - i
    return x[..., i] * (1.0 - frac) + x[..., i + 1] * frac


def chain(seg, lead, n, fs):
    """Electrode rate segment to 64 Hz decoder input, causal, as the phone does it."""
    sos = butter(ORDER, BAND, btype="bandpass", fs=fs, output="sos")
    filtered = sosfilt(sos, seg, axis=-1)
    lead_s = lead * fs // FS_RAW
    return resample_linear(filtered[:, lead_s:], n + TAIL, fs, FS)


def degrade(seg, kind, level, rng, names):
    if kind == "noise" and level:
        # Density in nV/sqrt(Hz): white over the 250 Hz Nyquist band of a 500 Hz front end.
        return seg + rng.normal(0.0, level * 1e-3 * np.sqrt(FS_RAW / 2), seg.shape)
    if kind == "pink" and level:
        return seg + pink(seg.shape, level, rng)
    if kind == "lsb" and level:
        return np.round(seg / level) * level
    if kind == "skew" and level:
        shift = int(round(level * FS_RAW / 1000))
        out = seg.copy()
        right = [i for i, c in enumerate(names) if c.startswith("R")]
        out[right] = np.roll(seg[right], shift, axis=1)
        return out
    if kind in ("loss", "burst") and level:
        frame = 10 if kind == "loss" else 100
        frames = seg.shape[1] // frame
        lost = rng.random(frames) < (level if kind == "loss" else level)
        out = seg.copy()
        for f in np.nonzero(lost)[0]:
            a = f * frame
            if a == 0:
                continue
            out[:, a : a + frame] = out[:, a - 1 : a]
        return out
    if kind in ("artifacts", "gated") and level:
        out = seg.copy()
        minutes = seg.shape[1] / FS_RAW / 60
        count = rng.poisson(level * minutes)
        for _ in range(count):
            dur = int(rng.uniform(0.2, 1.0) * FS_RAW)
            a = rng.integers(0, seg.shape[1] - dur)
            shape = np.hanning(dur)
            # A movement moves both ears' contacts, unequally.
            gains = rng.normal(1.0, 0.5, (seg.shape[0], 1)) * 200.0 * rng.choice([-1, 1])
            out[:, a : a + dur] += gains * shape
        return out
    if kind == "mains" and level:
        t = np.arange(seg.shape[1]) / FS_RAW
        hum = level * np.sin(2 * np.pi * 50 * t + rng.uniform(0, 2 * np.pi))
        imbalance = 1.0 + 0.01 * rng.normal(size=(seg.shape[0], 1))
        return seg + imbalance * hum
    return seg


def pink(shape, rms_band, rng):
    """1/f noise with the given rms (uV) between 1 and 9 Hz."""
    n = shape[1]
    f = np.fft.rfftfreq(n, 1.0 / FS_RAW)
    spec = rng.normal(size=(shape[0], len(f))) + 1j * rng.normal(size=(shape[0], len(f)))
    amp = np.zeros_like(f)
    amp[1:] = 1.0 / np.sqrt(f[1:])
    x = np.fft.irfft(spec * amp, n=n, axis=1)
    band = (f >= 1) & (f <= 9)
    # Scale so the 1 to 9 Hz part has the requested rms.
    xb = np.fft.irfft(np.fft.rfft(x, axis=1) * band, n=n, axis=1)
    return x * (rms_band / (np.sqrt((xb**2).mean()) + 1e-12))


def person_inputs(names, blocks, chans, kind, level, rng):
    M = montage_matrix(names, chans, "wireless")
    fs = level if kind == "rate" else FS_RAW
    sos_env = butter(ORDER, BAND, btype="bandpass", fs=FS, output="sos")
    derived = []
    for seg, lead, n, att, una in blocks:
        s = degrade(seg, kind, level, rng, names)
        if kind == "rate" and fs != FS_RAW:
            # The front end's own anti alias filter, then its rate.
            s = sosfilt(butter(8, 0.45 * fs, fs=FS_RAW, output="sos"), s, axis=-1)
            s = resample_linear(s, int((s.shape[1] - 2) * fs / FS_RAW), FS_RAW, fs)
        x = chain(s, lead, n, fs)
        derived.append((M @ x[:, :n], att, una))
    warm = derived[0][0][:, : A.WARMUP_S * FS]
    W = np.diag(1.0 / (np.sqrt((warm**2).mean(axis=1)) + 1e-9))
    out = []
    for d, att, una in derived:
        if kind == "crosstalk" and level:
            att, una = att + level * una, una + level * att
        e1 = sosfilt(sos_env, att)
        e2 = sosfilt(sos_env, una)
        if kind == "envlag" and level:
            # Envelopes that arrive late are the speech of `level` ms ago.
            k = int(round(level * FS / 1000))
            e1, e2 = np.roll(e1, k), np.roll(e2, k)
        x = W @ d
        if kind == "gated":
            bad = (np.abs(x) > 5).any(axis=0)
            pad = int(0.25 * FS)
            kernel = np.ones(2 * pad + 1)
            bad = np.convolve(bad.astype(float), kernel, mode="same") > 0
            x = np.where(bad[None, :], 0.0, x)
        out.append((x.astype(np.float32), running_norm(e1).astype(np.float32), running_norm(e2).astype(np.float32)))
    return out


def load_models(tag, seed, cfg):
    d = os.path.join(D.RUNS, "models", f"{tag}.seed{seed}")
    with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.json")) as f:
        run = json.load(f)
    folds = []
    use = min(cfg["ensemble"], int(os.environ.get("HW_NETS", "2")))
    for g, fold in enumerate(run["folds"]):
        nets = []
        for k in range(use):
            m = D.Decoder(8, cfg).to(D.DEVICE)
            m.load_state_dict(torch.load(os.path.join(d, f"fold{g}_net{k}.pt"), map_location=D.DEVICE))
            m.eval()
            nets.append(m)
        folds.append((fold["test"], nets))
    return folds


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "v2"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    with open(os.path.join(D.RUNS, f"{tag}.seed{seed}.json")) as f:
        cfg = json.load(f)["config"]
    folds = load_models(tag, seed, cfg)
    chans = D.electrodes()
    only = sys.argv[3].split(",") if len(sys.argv) > 3 else list(EXPERIMENTS)
    path = os.path.join(ROOT, "hardware.json")
    results = json.load(open(path)) if os.path.exists(path) else {}
    results["model"] = f"{tag}.seed{seed}"
    results["networks"] = min(cfg["ensemble"], int(os.environ.get("HW_NETS", "2")))
    t0 = time.time()
    for kind in only:
        levels = EXPERIMENTS[kind]
        acc = {str(l): {W: [] for W in (10, 60)} for l in levels}
        for test, nets in folds:
            for pid in test:
                names, blocks = raw_blocks(pid)
                for li, level in enumerate(levels):
                    rng = np.random.default_rng(zlib.crc32(f"{pid}/{kind}/{li}".encode()))
                    inputs = person_inputs(names, blocks, chans, kind, level, rng)
                    per, _ = D.evaluate(nets, inputs, cfg["pre"])
                    for W in (10, 60):
                        acc[str(level)][W].append(per[W])
            print(f"[hardware] {kind}: fold done ({time.time() - t0:.0f}s)", flush=True)
        results[kind] = {
            "levels": levels,
            "mean10": [float(np.mean(acc[str(l)][10])) for l in levels],
            "mean60": [float(np.mean(acc[str(l)][60])) for l in levels],
            "sem60": [float(np.std(acc[str(l)][60], ddof=1) / np.sqrt(len(acc[str(l)][60]))) for l in levels],
            "people": len(acc[str(levels[0])][60]),
        }
        line = " ".join(f"{l}:{m:.3f}" for l, m in zip(levels, results[kind]["mean60"]))
        print(f"[hardware] {kind} 60s  {line}", flush=True)
        with open(path, "w") as f:
            json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
