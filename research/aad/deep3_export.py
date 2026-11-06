#!/usr/bin/env python3
"""
The learned decoder version 3 (deep3.py's chosen settings), packed for the
phone, the way deep_export.py packs version 2:

  public/research/neural.json          the networks lib/sense runs, trained on
                                       31 people with every block their
                                       settings allow, five more held back to
                                       stop training
  public/research/results.json         its "neural", "fusion" and "belief"
                                       blocks, from the final runs' held out
                                       people
  lib/sense/__fixtures__/neural.json   eight seconds of one recording through
                                       this reference chain, for the
                                       TypeScript port to match

Run after the final splits (deep3.py with the chosen settings and tag
"final" for each seed in SPLITS) and belief.py with
AAD_BELIEF_RUNS="runs/final.seed*.json".

    python3 research/aad/deep3_export.py
"""
import json
import os

import numpy as np
import torch

import analyze as A
import calibrate as C
import deep3 as D
from deep_export import FIXTURE, OUT, REPO, TAU_S, encode, pack, running_norm_stream, unpack, window_score
from pipeline import FS, FS_RAW, bandpass_sos, causal_filter, decimate, montage_matrix

ROOT = D.ROOT
TAG = os.environ.get("AAD_FINAL_TAG", "final")
SPLITS = [7, 11, 23]
FIXTURE_S = 8


def runs():
    out = []
    for seed in SPLITS:
        with open(os.path.join(D.RUNS, f"{TAG}.seed{seed}.json")) as f:
            out.append(json.load(f))
    return out


def lag_of(spec):
    """Samples between an input and the output it completes: the centred layers' padding."""
    return sum(L["padding"] for L in spec)


def page_numbers(rs):
    """Each person's accuracy averaged over the splits' models that never saw them."""
    windows = [str(W) for W in A.WINDOWS]
    n = len(rs[0]["perSubject"][windows[0]])
    per = [{int(W): float(np.mean([r["perSubject"][W][i] for r in rs])) for W in windows} for i in range(n)]
    mesd = [A.mesd(p) for p in per]
    with open(os.path.join(ROOT, "results.json")) as f:
        bar = json.load(f)["chance"]["60"]
    neural = {
        "mean": {W: float(np.mean([p[int(W)] for p in per])) for W in windows},
        "sem": {W: float(np.std([p[int(W)] for p in per], ddof=1) / np.sqrt(n)) for W in windows},
        "control": {W: float(np.mean([r["control"][W] for r in rs])) for W in windows},
        "mesdMedian": float(np.median(mesd)) if np.isfinite(np.median(mesd)) else None,
        "perSubject60": [round(p[60], 4) for p in per],
        "above60": int(sum(p[60] >= bar - 1e-9 for p in per)),
        "splits": [{"seed": r["config"]["seed"], "mean60": r["mean"]["60"], "mean300": r["mean"]["300"], "mesdMedian": r["mesdMedian"]} for r in rs],
        "folds": [{"test": f["test"], "val": f["val"]} for f in rs[0]["folds"]],
        "ensemble": rs[0]["config"]["ensemble"],
        "version": 3,
        "settings": {k: rs[0]["config"][k] for k in ("data", "crop_s", "pre", "hidden", "emb", "kernel", "dilations", "dropout", "epochs", "loss", "align")},
    }
    margins = C.flat([r["margins10"] for r in rs])
    with open(os.path.join(ROOT, "calibration.json")) as f:
        linear = {k: v for k, v in json.load(f)["linear"].items() if k != "margins10"}
    fusion = {"seconds": C.SECONDS, "handSet": C.HAND_SET, "linear": linear, "neural": C.summary(margins)}
    with open(os.path.join(ROOT, "belief.json")) as f:
        belief = json.load(f)
    return neural, fusion, belief


def check_against_torch(model, cfg, weights, x, env, lag):
    """The float64 reference must be the network PyTorch trained, evaluated the streaming way."""
    m64 = D.Decoder(x.shape[0], cfg)
    m64.load_state_dict({k: v.detach().cpu() for k, v in model.state_dict().items()})
    m64 = m64.double().eval()
    with torch.no_grad():
        ze_t = m64.eeg(torch.from_numpy(x[None]))[0].numpy()
        e = np.concatenate([np.zeros(cfg["pre"]), env])
        zs_t = m64.env(torch.from_numpy(e[None, None]))[0].numpy()
    ze = encode(weights["eeg"], x)
    zs = encode(weights["env"], env[None])
    edge = ze.shape[1] - lag
    de = np.abs(ze[:, :edge] - ze_t[:, :edge]).max()
    ds = np.abs(zs[:, :edge] - zs_t[:, :edge]).max()
    assert de < 1e-9 and ds < 1e-9, (de, ds)
    return de, ds


def main():
    torch.set_num_threads(4)
    rs = runs()
    cfg = dict(rs[0]["config"])
    neural, fusion, belief = page_numbers(rs)
    page_path = os.path.join(REPO, "public", "research", "results.json")
    with open(page_path) as f:
        page = json.load(f)
    page["neural"] = neural
    page["fusion"] = fusion
    page["belief"] = belief
    with open(page_path, "w") as f:
        json.dump(page, f, separators=(",", ":"))
    print(
        f"[deep3_export] page: 60s {neural['mean']['60']:.3f}, 300s {neural['mean']['300']:.3f}, MESD {neural['mesdMedian']:.0f} s, "
        f"control 60s {neural['control']['60']:.3f}, fusion weight {fusion['neural']['weight']}",
        flush=True,
    )

    people = D.load(cfg)
    chans = D.electrodes()
    names = [str(n) for n in np.load(os.path.join(D.PREP_ALL, f"{people[0]['id']}.npz"))["channels"]]
    M = montage_matrix(names, chans, "wireless")
    scales = []
    for p in people:
        z = np.load(os.path.join(D.PREP_ALL, f"{p['id']}.npz"))
        warm = (M @ z["eeg1"].astype(np.float64))[:, : A.WARMUP_S * FS]
        scales.append(1.0 / np.sqrt((warm**2).mean(axis=1)))
    default_scale = np.median(np.array(scales), axis=0)

    rng = np.random.default_rng(cfg["seed"])
    order = [int(p) for p in rng.permutation(len(people))]
    val, trn = order[:5], order[5:]
    train_blocks = [b for p in trn for b in people[p]["train"]]
    val_blocks = [b for p in val for b in people[p]["test"]]
    models = []
    for k in range(cfg["ensemble"]):
        m, _, _ = D.train(train_blocks, val_blocks, cfg, cfg["seed"] + 100 + 1000 * k)
        models.append(m.to("cpu"))
    packed = [pack(m) for m in models]
    spec = packed[0][0]
    assert all(p[0] == spec for p in packed)
    nets = [unpack(spec, p[2]) for p in packed]
    lag = lag_of(spec["eeg"])
    assert lag == lag_of(spec["env"]), "both networks must reach equally far ahead"

    out = {
        "version": 2,
        "kind": "neural",
        "fsRaw": FS_RAW,
        "fs": FS,
        "inputs": chans,
        "sosRaw": np.round(bandpass_sos(FS_RAW), 15).tolist(),
        "sosEnv": np.round(bandpass_sos(FS), 15).tolist(),
        "montage": montage_matrix(chans, chans, "wireless").tolist(),
        "scale": [float(v) for v in default_scale],
        "warmupSeconds": A.WARMUP_S,
        "envTauSeconds": TAU_S,
        "eeg": spec["eeg"],
        "env": spec["env"],
        "weights": [p[1] for p in packed],
        "eegWeight": fusion["neural"]["weight"],
        "decisionSeconds": C.SECONDS,
        "trainedOn": {
            "people": len(trn),
            "stoppedOn": len(val),
            "seed": cfg["seed"],
            "epochs": cfg["epochs"],
            "networks": cfg["ensemble"],
            "data": cfg["data"],
            "decoder": 3,
        },
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"[deep3_export] model: {len(packed)} x {len(packed[0][2])} weights, lag {lag}, {os.path.getsize(OUT) / 1024:.0f} kB", flush=True)

    with open(os.path.join(REPO, "public", "research", "people", "typical.json")) as f:
        meta = json.load(f)
    codes = np.fromfile(os.path.join(REPO, "public", "research", "people", "typical.bin"), dtype="<i2").reshape(-1, len(chans)).T
    lead = meta["leadSamples"]
    seg = codes[:, lead : lead + FIXTURE_S * FS_RAW]
    raw = seg.astype(np.float64) * meta["lsbUv"] + np.array(meta["offsetsUv"])[:, None]
    filt = causal_filter(np.array(out["sosRaw"]), raw)
    n = int(np.floor((raw.shape[1] - 2) * FS / FS_RAW))
    feat = decimate(filt, n)
    scale = np.array(meta["model"]["scale"])
    derived = (np.array(out["montage"]) @ feat) * scale[:, None]
    sos_env = np.array(out["sosEnv"])
    envs_raw = [np.array(meta["envelopes"][k][:n], dtype=np.float64) for k in range(2)]
    envs = [running_norm_stream(causal_filter(sos_env, e[None])[0]) for e in envs_raw]
    worst = max(max(check_against_torch(m, cfg, w, derived, envs[0], lag)) for m, w in zip(models, nets))
    emb = [(encode(w["eeg"], derived), [encode(w["env"], e[None]) for e in envs]) for w in nets]
    final = n - lag
    every = 4
    windows = [(0, 64), (100, 128), (final - 320, 320), (final - 64, 64)]
    fixture = {
        "scale": [float(v) for v in scale],
        "lsbUv": meta["lsbUv"],
        "offsetsUv": meta["offsetsUv"],
        "codes": seg.T.tolist(),
        "envelopes": [[float(v) for v in e] for e in envs_raw],
        "weightsHead": [p[2][:4].astype(np.float64).tolist() for p in packed],
        "samples": n,
        "final": final,
        "every": every,
        "eeg": emb[0][0][:, :final:every].T.tolist(),
        "env": [z[:, :final:every].T.tolist() for z in emb[0][1]],
        "envNormalized": [[float(v) for v in e[:final:every]] for e in envs],
        "windows": [
            {"start": s0, "length": L, "scores": np.mean([window_score(ze, zs, s0, L) for ze, zs in emb], axis=0).tolist()}
            for s0, L in windows
        ],
    }
    with open(FIXTURE, "w") as f:
        json.dump(fixture, f, separators=(",", ":"))
    print(f"[deep3_export] fixture: {n} samples, {final} final, torch match {worst:.1e}, {os.path.getsize(FIXTURE) / 1024:.0f} kB", flush=True)


if __name__ == "__main__":
    main()
