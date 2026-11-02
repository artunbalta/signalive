#!/usr/bin/env python3
"""
A small neural decoder for the same question, judged the same way.

The linear decoders compare the EEG with each story through one fixed
filter. This learns both sides: a spatio temporal filter on the four
electrodes per ear (each ear referenced to itself, as two earbuds would be)
and a temporal response on each story's envelope, so that the EEG's
embedding moves with the followed story's. A window's verdict is the story
whose embedding correlates best with the EEG's over that window, the same
rule as before, so any window length can be judged from one trained model.

People are split into six groups; each group is tested by a model trained on
the other thirty (five of them held back to stop training), so no tested
person ever shaped the model.

    python3 research/aad/deep.py

Writes research/aad/deep.json.
"""
import json
import os
import time

import numpy as np
import torch
import torch.nn as nn
from scipy.signal import lfilter

import analyze as A
import calibrate as C
from pipeline import FS, bandpass_sos, causal_filter

ROOT = os.path.dirname(os.path.abspath(__file__))
WINDOWS = A.WINDOWS
TRAIN_S = 5
PRE = 32  # half a second of stimulus before each EEG sample, the response's reach
EPOCHS = 14
SEED = int(os.environ.get("AAD_SEED", "7"))
# Networks trained per fold, from different starting points; a window's scores are their average.
ENSEMBLE = int(os.environ.get("AAD_ENSEMBLE", "1"))
DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")


def running_norm(e, tau_s=30):
    """Each story's loudness scaled by its own recent spread, causally, as a device would."""
    a = 1.0 / (tau_s * FS)
    r2 = lfilter([a], [1.0, -(1.0 - a)], e * e, zi=[(1.0 - a) * np.mean(e[:FS] ** 2)])[0]
    return e / np.sqrt(np.maximum(r2, 1e-12))


def load():
    subjects = A.load()
    with open(os.path.join(ROOT, "results.json")) as f:
        chans = json.load(f)["configs"]["wireless_4"]["electrodes"]
    cfg = A.Config("wireless_4", subjects[0].names, chans, "wireless")
    sos = bandpass_sos(FS)
    data = []
    for s in subjects:
        z = np.load(os.path.join(A.PREP, f"{s.id}.npz"))
        blocks = []
        derived = [cfg.M @ b.eeg[:, : b.T] for b in s.blocks]
        # Each person scaled by the spread of their first two minutes, unlabelled,
        # as the linear decoders scale a person they never saw.
        warm = derived[0][:, : A.WARMUP_S * FS]
        sd = np.sqrt((warm**2).mean(axis=1, keepdims=True)) + 1e-9
        for i, b in enumerate(s.blocks):
            e1 = causal_filter(sos, z[f"raw_env1_{i}"].astype(np.float64))[: b.T]
            e2 = causal_filter(sos, z[f"raw_env2_{i}"].astype(np.float64))[: b.T]
            att, una = (e1, e2) if s.attended == "left" else (e2, e1)
            blocks.append((derived[i] / sd, running_norm(att), running_norm(una)))
        data.append(blocks)
    return data


class Encoder(nn.Module):
    def __init__(self, cin, hidden=24, out=12, k=9, pre=0):
        super().__init__()
        self.pre = pre
        layers = []
        if pre:
            # The stimulus side sees half a second back: a learned response kernel.
            layers += [nn.Conv1d(cin, hidden, pre + 1), nn.GELU()]
        else:
            layers += [nn.Conv1d(cin, hidden, 1), nn.GELU()]
        for d in (1, 2, 4):
            layers += [nn.Conv1d(hidden, hidden, k, dilation=d, padding=d * (k - 1) // 2), nn.GELU(), nn.Dropout(0.15)]
        layers += [nn.Conv1d(hidden, out, 1)]
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


class Decoder(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.eeg = Encoder(channels)
        self.env = Encoder(1, pre=PRE)

    def scores(self, eeg, envs):
        """Per sample products, so any window can be scored: (batch, stories, time)."""
        ze = self.eeg(eeg)
        ze = ze - ze.mean(dim=2, keepdim=True)
        out = []
        for j in range(envs.shape[1]):
            zs = self.env(envs[:, j : j + 1])
            zs = zs - zs.mean(dim=2, keepdim=True)
            num = (ze * zs).sum(dim=1)
            out.append(num / (ze.norm(dim=1).mean(dim=1, keepdim=True) * zs.norm(dim=1).mean(dim=1, keepdim=True) + 1e-6))
        return torch.stack(out, dim=1)

    def forward(self, eeg, envs):
        return self.scores(eeg, envs).mean(dim=2) * 10.0


def windows(blocks, n, rng):
    """Random training crops: EEG of n samples and both envelopes of PRE + n, in random order."""
    X, E, Y = [], [], []
    for eeg, att, una in blocks:
        T = eeg.shape[1]
        for start in rng.integers(PRE, T - n, size=max(1, (T - n) // (FS * 2))):
            X.append(eeg[:, start : start + n])
            a = att[start - PRE : start + n]
            u = una[start - PRE : start + n]
            if rng.random() < 0.5:
                E.append(np.stack([a, u]))
                Y.append(0)
            else:
                E.append(np.stack([u, a]))
                Y.append(1)
    return np.array(X, np.float32), np.array(E, np.float32), np.array(Y, np.int64)


def train(train_people, val_people, data, rng, seed=SEED):
    torch.manual_seed(seed)
    model = Decoder(data[0][0][0].shape[0]).to(DEVICE)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-3)
    loss_fn = nn.CrossEntropyLoss()
    n = TRAIN_S * FS
    best = (np.inf, None)
    vX, vE, vY = windows([b for p in val_people for b in data[p]], n, np.random.default_rng(1))
    for epoch in range(EPOCHS):
        X, E, Y = windows([b for p in train_people for b in data[p]], n, rng)
        order = rng.permutation(len(X))
        model.train()
        for i in range(0, len(order), 128):
            idx = order[i : i + 128]
            x = torch.from_numpy(X[idx]).to(DEVICE)
            e = torch.from_numpy(E[idx]).to(DEVICE)
            y = torch.from_numpy(Y[idx]).to(DEVICE)
            opt.zero_grad()
            loss = loss_fn(model(x, e), y)
            loss.backward()
            opt.step()
        model.eval()
        with torch.no_grad():
            vl = 0.0
            for i in range(0, len(vX), 256):
                x = torch.from_numpy(vX[i : i + 256]).to(DEVICE)
                e = torch.from_numpy(vE[i : i + 256]).to(DEVICE)
                y = torch.from_numpy(vY[i : i + 256]).to(DEVICE)
                vl += loss_fn(model(x, e), y).item() * len(y)
            vl /= len(vX)
        if vl < best[0]:
            best = (vl, {k: v.detach().clone() for k, v in model.state_dict().items()})
    model.load_state_dict(best[1])
    model.eval()
    return model


def window_scores(ze, zs, win):
    """The training objective, per window: each story's embedding against the EEG's, centred and scaled within the window."""
    m = (ze.shape[1] // win) * win
    if m == 0:
        return None
    a = ze[:, :m].reshape(ze.shape[0], -1, win)
    a = a - a.mean(axis=2, keepdims=True)
    na = np.linalg.norm(a, axis=0).mean(axis=1)
    out = []
    for z in zs:
        b = z[:, :m].reshape(z.shape[0], -1, win)
        b = b - b.mean(axis=2, keepdims=True)
        nb = np.linalg.norm(b, axis=0).mean(axis=1)
        out.append((a * b).sum(axis=0).mean(axis=1) / (na * nb + 1e-6))
    return np.stack(out)


def evaluate(models, blocks, shift_s=0):
    """
    Per window length, the share of windows where the followed story scores
    higher, each window judged on its own samples only; with several models,
    on their scores averaged. With shift_s, both stories' envelopes are
    rotated in time by that much: the same voices, out of step with the EEG.
    A decoder that follows the speech falls to chance there; one that
    recognised the voices and read something else in the EEG (where the head
    or eyes were turned) would not.
    """
    hits = {W: [] for W in WINDOWS}
    margins = []
    with torch.no_grad():
        for eeg, att, una in blocks:
            if shift_s:
                att = np.roll(att, shift_s * FS)
                una = np.roll(una, shift_s * FS)
            x = torch.from_numpy(eeg[None, :, PRE:].astype(np.float32)).to(DEVICE)
            emb = []
            for model in models:
                ze = model.eeg(x)[0].cpu().numpy()
                zs = [model.env(torch.from_numpy(e[None, None].astype(np.float32)).to(DEVICE))[0].cpu().numpy() for e in (att, una)]
                emb.append((ze, zs))
            for W in WINDOWS:
                scores = [window_scores(ze, zs, W * FS) for ze, zs in emb]
                if scores[0] is None:
                    continue
                s = np.mean(scores, axis=0)
                hits[W].extend((s[0] > s[1]).tolist())
                if W == C.SECONDS:
                    margins.append((s[0] - s[1]).tolist())
    return {W: float(np.mean(v)) for W, v in hits.items()}, margins


def main():
    t0 = time.time()
    data = load()
    n = len(data)
    rng = np.random.default_rng(SEED)
    order = rng.permutation(n)
    groups = np.array_split(order, 6)
    per = [None] * n
    control = [None] * n
    margins = [None] * n
    for g, test in enumerate(groups):
        rest = [p for p in order if p not in test]
        val, train_people = rest[:5], rest[5:]
        # Model 0 is the single model; the others start elsewhere and see the crops in another order.
        models = [
            train(train_people, val, data, np.random.default_rng(SEED + g + 1000 * k), seed=SEED + 1000 * k)
            for k in range(ENSEMBLE)
        ]
        for p in test:
            # Ten second margins per block, in order, for calibrate.py and the belief over time.
            per[p], margins[p] = evaluate(models, data[p])
            control[p], _ = evaluate(models, data[p], shift_s=97)
        done = [x for x in per if x is not None]
        print(f"[deep] group {g + 1}/6 done ({time.time() - t0:.0f}s): so far 60s {np.mean([d[60] for d in done]):.3f}", flush=True)
    m = [A.mesd(p) for p in per]
    out = {
        "mean": {W: float(np.mean([p[W] for p in per])) for W in WINDOWS},
        "sem": {W: float(np.std([p[W] for p in per], ddof=1) / np.sqrt(n)) for W in WINDOWS},
        "perSubject": {W: [round(p[W], 4) for p in per] for W in WINDOWS},
        "mesdMedian": float(np.median(m)) if np.isfinite(np.median(m)) else None,
        "folds": 6,
        "epochs": EPOCHS,
        # The same models on envelopes rotated 97 s out of step with the EEG: should be chance.
        "control": {W: float(np.mean([c[W] for c in control])) for W in WINDOWS},
    }
    # How far a ten second decision may move the fusion, fitted on these held out people (see calibrate.py).
    out["calibration"] = C.summary([v for blocks in margins for blk in blocks for v in blk])
    out["margins10"] = [[[round(float(v), 4) for v in blk] for blk in blocks] for blocks in margins]
    out["seed"] = SEED
    out["ensemble"] = ENSEMBLE
    name = "deep" + ("" if SEED == 7 else f".seed{SEED}") + ("" if ENSEMBLE == 1 else f".ens{ENSEMBLE}") + ".json"
    with open(os.path.join(ROOT, name), "w") as f:
        json.dump(out, f, indent=1)
    mm = out["mean"]
    cc = out["control"]
    print(f"[deep] 2s {mm[2]:.3f} 10s {mm[10]:.3f} 60s {mm[60]:.3f} 300s {mm[300]:.3f} MESD {out['mesdMedian']}  ({time.time() - t0:.0f}s)", flush=True)
    print(f"[deep] control (envelopes out of step): 2s {cc[2]:.3f} 10s {cc[10]:.3f} 60s {cc[60]:.3f} 300s {cc[300]:.3f}", flush=True)
    cal = out["calibration"]
    print(f"[deep] fusion weight at {cal['seconds']} s: {cal['weight']} (log loss {cal['logLoss']}, hand set {cal['logLossHandSet']})", flush=True)


if __name__ == "__main__":
    main()
