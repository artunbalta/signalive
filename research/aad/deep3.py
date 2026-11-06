#!/usr/bin/env python3
"""
The learned decoder, version 3: the same question and the same test, more
data and a search over how it is trained.

deep.py trains on each training person's three selected blocks. This can also
train on their two other blocks (preprocess_all.py), and it exposes every
choice of the network and its training as a setting, so variants can be
compared. The test never changes: the selected blocks of people the model
never saw, scaled by their own first two minutes, causal, with the 97 s
out of step control.

Variants are chosen on validation people only. Each fold holds 6 people out
for the test and 5 more for validation (training stops on them); a variant's
"val" numbers are measured on those 5, and the choice between variants is
made on val alone. The test numbers of every run are written too, but the
rule is fixed before any run: the variant with the best validation log loss
at ten seconds wins, and its test numbers are the ones reported.

    AAD_V3='{"data": "all"}' python3 research/aad/deep3.py
    AAD_V3=@variants/name.json python3 research/aad/deep3.py

Writes research/aad/runs/<tag>.seed<S>.json.
"""
import glob
import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

import analyze as A
import calibrate as C
from deep import running_norm, window_scores
from pipeline import FS, bandpass_sos, causal_filter, montage_matrix

ROOT = os.path.dirname(os.path.abspath(__file__))
PREP_ALL = os.path.join(ROOT, "data", "prep_all")
RUNS = os.path.join(ROOT, "runs")
WINDOWS = A.WINDOWS
DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

DEFAULTS = {
    "tag": "v2",
    # "selected": the three blocks deep.py uses; "omni": every equally loud
    # block; "all": also the blocks where the followed story was louder.
    "data": "selected",
    "crop_s": 5,
    "pre": 32,
    "hidden": 24,
    "emb": 12,
    "kernel": 9,
    "dilations": [1, 2, 4],
    "dropout": 0.15,
    "epochs": 14,
    "lr": 2e-3,
    "wd": 1e-3,
    "batch": 128,
    # "pair": cross entropy over the two stories at the same moment;
    # "nce": also against every other crop's stories in the batch.
    "loss": "pair",
    "temp": 10.0,
    # Augmentation of the EEG crops (unit variance channels).
    "noise": 0.0,
    "chscale": 0.0,
    "chdrop": 0.0,
    # "scale": each channel by its spread in the first two minutes;
    # "ea": the channels whitened by their covariance over those minutes.
    "align": "scale",
    "ensemble": 1,
    "seed": 7,
    # Crops per block per epoch: one per this many seconds.
    "every_s": 2,
    "cosine": False,
    # Keep each fold's networks (runs/models/<tag>.seed<S>/) for hardware_bars.py.
    "save": False,
    # What else is held out besides the test people. None: nothing. "part":
    # also the story content, every test block scored by models trained
    # without any block of that part of the two stories, from anyone.
    # "study": the other source study (train on Jaeger, test Holtze, and back).
    "holdout": None,
    # Train on only this many of each fold's training people (a seeded draw),
    # to ask how accuracy grows with the number of people trained on.
    "ntrain": None,
}


def settings():
    raw = os.environ.get("AAD_V3", "{}")
    if raw.startswith("@"):
        with open(os.path.join(ROOT, raw[1:])) as f:
            raw = f.read()
    cfg = dict(DEFAULTS)
    cfg.update(json.loads(raw))
    if "AAD_SEED" in os.environ:
        cfg["seed"] = int(os.environ["AAD_SEED"])
    return cfg


def electrodes():
    with open(os.path.join(ROOT, "results.json")) as f:
        return json.load(f)["configs"]["wireless_4"]["electrodes"]


def inv_sqrt(R):
    w, V = np.linalg.eigh(R)
    return V @ np.diag(1.0 / np.sqrt(np.maximum(w, 1e-12))) @ V.T


def load(cfg):
    """Per person: their test blocks (selected) and their training blocks (by cfg['data'])."""
    paths = sorted(glob.glob(os.path.join(PREP_ALL, "sub-*.npz")))
    if os.environ.get("AAD_V3_PARTIAL") != "1":
        assert len(paths) == 36, f"run preprocess_all.py first ({len(paths)} people prepared)"
    sos = bandpass_sos(FS)
    chans = electrodes()
    people = []
    for path in paths:
        z = np.load(path)
        names = [str(n) for n in z["channels"]]
        M = montage_matrix(names, chans, "wireless")
        side = str(z["attended"])
        blocks = [int(b) for b in z["blocks"]]
        valid = dict(zip(blocks, [int(v) for v in z["valid"]]))
        cond = dict(zip(blocks, [str(c) for c in z["cond"]]))
        selected = set(int(b) for b in z["selected"])
        first = min(blocks)
        assert first == 1 and 1 in selected
        derived = {b: M @ z[f"eeg{b}"].astype(np.float64) for b in blocks}
        warm = derived[first][:, : A.WARMUP_S * FS]
        if cfg["align"] == "ea":
            W = inv_sqrt(warm @ warm.T / warm.shape[1])
        else:
            W = np.diag(1.0 / (np.sqrt((warm**2).mean(axis=1)) + 1e-9))
        test, trainb, test_parts, train_parts = [], [], [], []
        for b in blocks:
            T = valid[b]
            e1 = causal_filter(sos, z[f"env1_{b}"].astype(np.float64))[:T]
            e2 = causal_filter(sos, z[f"env2_{b}"].astype(np.float64))[:T]
            att, una = (e1, e2) if side == "left" else (e2, e1)
            item = ((W @ derived[b][:, :T]).astype(np.float32), running_norm(att).astype(np.float32), running_norm(una).astype(np.float32))
            if b in selected:
                test.append(item)
                test_parts.append(b)
            use = cfg["data"] == "all" or b in selected or (cfg["data"] == "omni" and cond[b] == "O")
            if use:
                trainb.append(item)
                train_parts.append(b)
        people.append({
            "id": os.path.basename(path)[:-4],
            "test": test,
            "train": trainb,
            "testParts": test_parts,
            "trainParts": train_parts,
            "study": str(z["study"]),
            "side": side,
        })
    return people


class Encoder(nn.Module):
    def __init__(self, cin, cfg, pre=0):
        super().__init__()
        h, k = cfg["hidden"], cfg["kernel"]
        layers = [nn.Conv1d(cin, h, pre + 1 if pre else 1), nn.GELU()]
        for d in cfg["dilations"]:
            layers += [nn.Conv1d(h, h, k, dilation=d, padding=d * (k - 1) // 2), nn.GELU(), nn.Dropout(cfg["dropout"])]
        layers += [nn.Conv1d(h, cfg["emb"], 1)]
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


def unit(z):
    """Centred over time, scaled by the mean norm over time: (batch, dims, time)."""
    z = z - z.mean(dim=2, keepdim=True)
    return z / (z.norm(dim=1).mean(dim=1, keepdim=True)[:, :, None] + 1e-6)


class Decoder(nn.Module):
    def __init__(self, channels, cfg):
        super().__init__()
        self.cfg = cfg
        self.eeg = Encoder(channels, cfg)
        self.env = Encoder(1, cfg, pre=cfg["pre"])

    def pair_logits(self, eeg, envs):
        ze = unit(self.eeg(eeg))
        out = []
        for j in range(envs.shape[1]):
            zs = unit(self.env(envs[:, j : j + 1]))
            out.append((ze * zs).sum(dim=1).mean(dim=1))
        return torch.stack(out, dim=1) * self.cfg["temp"]

    def nce_logits(self, eeg, envs):
        """Each crop's EEG against both stories of every crop in the batch; the right answer is its own followed story."""
        B = eeg.shape[0]
        ze = unit(self.eeg(eeg))
        zs = unit(self.env(envs.reshape(B * envs.shape[1], 1, -1)))
        T = ze.shape[2]
        return torch.einsum("bdt,cdt->bc", ze, zs) / T * self.cfg["temp"]


def crops(blocks, n, pre, rng, every_s):
    X, E = [], []
    for eeg, att, una in blocks:
        T = eeg.shape[1]
        if T - n <= pre:
            continue
        for start in rng.integers(pre, T - n, size=max(1, (T - n) // (FS * every_s))):
            X.append(eeg[:, start : start + n])
            E.append(np.stack([att[start - pre : start + n], una[start - pre : start + n]]))
    return np.array(X, np.float32), np.array(E, np.float32)


def augment(x, cfg, gen):
    if cfg["chscale"]:
        x = x * torch.exp(cfg["chscale"] * torch.randn(x.shape[0], x.shape[1], 1, device=x.device, generator=gen))
    if cfg["chdrop"]:
        keep = (torch.rand(x.shape[0], x.shape[1], 1, device=x.device, generator=gen) > cfg["chdrop"]).float()
        x = x * keep / (1.0 - cfg["chdrop"])
    if cfg["noise"]:
        x = x + cfg["noise"] * torch.randn(x.shape, device=x.device, generator=gen)
    return x


def pair_loss(model, x, e, swap):
    """Cross entropy over the two stories, with their order randomised by swap."""
    e = torch.where(swap[:, None, None], e.flip(1), e)
    return F.cross_entropy(model.pair_logits(x, e), swap.long())


def train(train_blocks, val_blocks, cfg, seed):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    gen = torch.Generator(device="cpu").manual_seed(seed)
    model = Decoder(train_blocks[0][0].shape[0], cfg).to(DEVICE)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=cfg["wd"])
    n = cfg["crop_s"] * FS
    vX, vE = crops(val_blocks, n, cfg["pre"], np.random.default_rng(1), 2)
    vswap = np.random.default_rng(2).random(len(vX)) < 0.5
    steps = cfg["epochs"] * int(np.ceil(sum(max(1, (b[0].shape[1] - n) // (FS * cfg["every_s"])) for b in train_blocks) / cfg["batch"]))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=cfg["lr"], total_steps=steps, pct_start=0.1) if cfg["cosine"] else None
    best = (np.inf, None, -1)
    for epoch in range(cfg["epochs"]):
        X, E = crops(train_blocks, n, cfg["pre"], rng, cfg["every_s"])
        order = rng.permutation(len(X))
        model.train()
        for i in range(0, len(order), cfg["batch"]):
            idx = order[i : i + cfg["batch"]]
            x = augment(torch.from_numpy(X[idx]).to(DEVICE), cfg, None)
            e = torch.from_numpy(E[idx]).to(DEVICE)
            if cfg["loss"] == "nce":
                logits = model.nce_logits(x, e)
                target = torch.arange(len(idx), device=DEVICE) * 2
                loss = F.cross_entropy(logits, target)
            else:
                swap = torch.from_numpy(rng.random(len(idx)) < 0.5).to(DEVICE)
                loss = pair_loss(model, x, e, swap)
            opt.zero_grad()
            loss.backward()
            opt.step()
            if sched is not None and sched.last_epoch + 1 < steps:
                sched.step()
        vl = val_loss(model, vX, vE, vswap)
        if vl < best[0]:
            best = (vl, {k: v.detach().clone() for k, v in model.state_dict().items()}, epoch)
    model.load_state_dict(best[1])
    model.eval()
    return model, best[0], best[2]


def val_loss(model, vX, vE, vswap):
    model.eval()
    total = 0.0
    with torch.no_grad():
        for i in range(0, len(vX), 256):
            x = torch.from_numpy(vX[i : i + 256]).to(DEVICE)
            e = torch.from_numpy(vE[i : i + 256]).to(DEVICE)
            s = torch.from_numpy(vswap[i : i + 256]).to(DEVICE)
            total += pair_loss(model, x, e, s).item() * len(x)
    return total / len(vX)


def embed(models, eeg, att, una, pre, shift_s=0):
    if shift_s:
        att = np.roll(att, shift_s * FS)
        una = np.roll(una, shift_s * FS)
    x = torch.from_numpy(eeg[None, :, pre:]).to(DEVICE)
    out = []
    with torch.no_grad():
        for m in models:
            ze = m.eeg(x)[0].cpu().numpy()
            zs = [m.env(torch.from_numpy(e[None, None].astype(np.float32)).to(DEVICE))[0].cpu().numpy() for e in (att, una)]
            out.append((ze, zs))
    return out


def evaluate(models, blocks, pre, shift_s=0):
    """Share of windows won by the followed story, per window length; ten second margins per block."""
    hits, margins = evaluate_hits(models, blocks, pre, shift_s)
    return {W: float(np.mean(v)) if v else float("nan") for W, v in hits.items()}, margins


def evaluate_hits(models, blocks, pre, shift_s=0):
    """Every window's verdict (True: the followed story won), per window length, and ten second margins per block."""
    hits = {W: [] for W in WINDOWS}
    margins = []
    for eeg, att, una in blocks:
        emb = embed(models, eeg, att, una, pre, shift_s)
        for W in WINDOWS:
            scores = [window_scores(ze, zs, W * FS) for ze, zs in emb]
            if scores[0] is None:
                continue
            s = np.mean(scores, axis=0)
            hits[W].extend((s[0] > s[1]).tolist())
            if W == C.SECONDS:
                margins.append((s[0] - s[1]).tolist())
    return hits, margins


def tag_of(cfg):
    return cfg["tag"]


def main():
    cfg = settings()
    t0 = time.time()
    people = load(cfg)
    n = len(people)
    seed = cfg["seed"]
    rng = np.random.default_rng(seed)
    order = rng.permutation(n)
    groups = np.array_split(order, 6)
    per, control, margins = [None] * n, [None] * n, [None] * n
    val_per, val_margins, folds = {}, [], []
    if cfg["holdout"] == "study":
        studies = sorted({pp["study"] for pp in people})
        groups = [np.array([i for i in order if people[i]["study"] == st]) for st in studies]
    for g, test in enumerate(groups):
        rest = [p for p in order if p not in test]
        val, trn = rest[:5], rest[5:]
        if cfg["ntrain"]:
            trn = [trn[i] for i in np.random.default_rng(seed + 500 + g).permutation(len(trn))[: cfg["ntrain"]]]
        if cfg["holdout"] == "part":
            # One model set per part of the stories the test people were scored on, trained without that part.
            parts = sorted({b for p in test for b in people[p]["testParts"]})
        else:
            parts = [None]
        hits = {int(p): {W: [] for W in WINDOWS} for p in test}
        ctl = {int(p): {W: [] for W in WINDOWS} for p in test}
        mg_all = {int(p): [] for p in test}
        losses, epochs = [], []
        for part in parts:
            keep = (lambda b: True) if part is None else (lambda b, part=part: b != part)
            train_blocks = [blk for p in trn for blk, b in zip(people[p]["train"], people[p]["trainParts"]) if keep(b)]
            val_blocks = [blk for p in val for blk, b in zip(people[p]["test"], people[p]["testParts"]) if keep(b)]
            models = []
            for k in range(cfg["ensemble"]):
                m, vl, ep = train(train_blocks, val_blocks, cfg, seed + g + 1000 * k + (0 if part is None else 100 * part))
                models.append(m)
                losses.append(vl)
                epochs.append(ep)
            if part is None:
                for p in val:
                    acc, mg = evaluate(models, people[p]["test"], cfg["pre"])
                    val_per.setdefault(int(p), []).append(acc)
                    val_margins.extend(v for blk in mg for v in blk)
            for p in test:
                blocks = [blk for blk, b in zip(people[p]["test"], people[p]["testParts"]) if part is None or b == part]
                if not blocks:
                    continue
                h, mg = evaluate_hits(models, blocks, cfg["pre"])
                hc, _ = evaluate_hits(models, blocks, cfg["pre"], shift_s=97)
                for W in WINDOWS:
                    hits[int(p)][W].extend(h[W])
                    ctl[int(p)][W].extend(hc[W])
                mg_all[int(p)].extend(mg)
            if cfg["save"] and part is None:
                d = os.path.join(RUNS, "models", f"{tag_of(cfg)}.seed{seed}")
                os.makedirs(d, exist_ok=True)
                for k, m in enumerate(models):
                    torch.save(m.state_dict(), os.path.join(d, f"fold{g}_net{k}.pt"))
        for p in test:
            per[p] = {W: float(np.mean(v)) if v else float("nan") for W, v in hits[int(p)].items()}
            control[p] = {W: float(np.mean(v)) if v else float("nan") for W, v in ctl[int(p)].items()}
            margins[p] = mg_all[int(p)]
        folds.append({"valLoss": [round(v, 5) for v in losses], "bestEpoch": epochs, "parts": [x for x in parts if x is not None], "test": [people[p]["id"] for p in test], "val": [people[p]["id"] for p in val]})
        print(f"[deep3 {cfg['tag']} s{seed}] fold {g + 1}/{len(groups)} ({time.time() - t0:.0f}s) val loss {np.mean(losses):.4f}", flush=True)
    valcal = C.summary(val_margins) if val_margins else {"logLoss": float("nan"), "weight": float("nan")}
    vmean = {W: float(np.mean([a[W] for accs in val_per.values() for a in accs])) if val_per else float("nan") for W in WINDOWS}
    m = [A.mesd(p) for p in per]
    out = {
        "config": cfg,
        "val": {"loss": float(np.mean([v for f in folds for v in f["valLoss"]])), "logLoss10": valcal["logLoss"], "weight10": valcal["weight"], "mean": vmean},
        "folds": folds,
        "mean": {W: float(np.mean([p[W] for p in per])) for W in WINDOWS},
        "sem": {W: float(np.std([p[W] for p in per], ddof=1) / np.sqrt(n)) for W in WINDOWS},
        "perSubject": {W: [round(p[W], 4) for p in per] for W in WINDOWS},
        "mesdMedian": float(np.median(m)) if np.isfinite(np.median(m)) else None,
        "control": {W: float(np.mean([c[W] for c in control])) for W in WINDOWS},
        "people": [pp["id"] for pp in people],
        "sides": [pp["side"] for pp in people],
        "studies": [pp["study"] for pp in people],
        "calibration": C.summary([v for blocks in margins for blk in blocks for v in blk]),
        "margins10": [[[round(float(v), 4) for v in blk] for blk in blocks] for blocks in margins],
        "seconds": round(time.time() - t0),
    }
    os.makedirs(RUNS, exist_ok=True)
    path = os.path.join(RUNS, f"{tag_of(cfg)}.seed{seed}.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    v, mm, cc = out["val"], out["mean"], out["control"]
    print(
        f"[deep3 {cfg['tag']} s{seed}] VAL loss {v['loss']:.4f} ll10 {v['logLoss10']:.4f} 10s {v['mean'][10]:.3f} 60s {v['mean'][60]:.3f} | "
        f"TEST 10s {mm[10]:.3f} 60s {mm[60]:.3f} 300s {mm[300]:.3f} MESD {out['mesdMedian']} | control 60s {cc[60]:.3f} ({out['seconds']}s)",
        flush=True,
    )


if __name__ == "__main__":
    sys.exit(main())
