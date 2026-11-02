#!/usr/bin/env python3
"""
The learned decoder (deep.py), packed for the phone:

  public/research/neural.json          the model lib/sense runs: three networks
                                       trained on 31 of the 36 people with five
                                       held back to stop training, every weight
                                       as float32, the chain around them, and
                                       how much a ten second decision may move
                                       the fusion, as measured on people the
                                       networks never saw
  public/research/results.json         gains a "neural" block (deep.py's three
                                       splits, pooled per person), a "fusion"
                                       block (calibrate.py and deep.py's fits)
                                       and a "belief" block (belief.py)
  lib/sense/__fixtures__/neural.json   eight seconds of one recording through
                                       this reference chain, for the
                                       TypeScript port to match

The reference chain is the streaming one: every layer sees zeros before the
first sample, as a decoder that has just started does, and an output is final
once the input it reaches (28 samples ahead, 0.44 s) has arrived.

Run after export.py (which writes results.json from scratch), calibrate.py
deep.py with AAD_ENSEMBLE=3 for the seeds in SPLITS, and belief.py.

    python3 research/aad/deep_export.py
"""
import base64
import json
import os

import numpy as np
import torch
from scipy.special import erf

import analyze as A
import calibrate as C
import deep as D
from pipeline import FS, FS_RAW, bandpass_sos, causal_filter, decimate, montage_matrix

ROOT = D.ROOT
REPO = os.path.normpath(os.path.join(ROOT, "..", ".."))
OUT = os.path.join(REPO, "public", "research", "neural.json")
FIXTURE = os.path.join(REPO, "lib", "sense", "__fixtures__", "neural.json")
FIXTURE_S = 8
TAU_S = 30
ENSEMBLE = 3
SPLITS = [7, 11, 23]


def layers_of(enc):
    """The encoder's convolutions in order, each with whether a GELU follows it."""
    mods = list(enc.net)
    out = []
    for i, m in enumerate(mods):
        if isinstance(m, torch.nn.Conv1d):
            act = i + 1 < len(mods) and isinstance(mods[i + 1], torch.nn.GELU)
            out.append((m, act))
    return out


def pack(model):
    """Layer shapes as JSON, every weight and bias of one network as one little endian float32 blob, in layer order."""
    blobs = []
    spec = {}
    for name, enc in (("eeg", model.eeg), ("env", model.env)):
        rows = []
        for conv, act in layers_of(enc):
            w = conv.weight.detach().cpu().numpy().astype("<f4")
            b = conv.bias.detach().cpu().numpy().astype("<f4")
            blobs += [w.ravel(), b]
            rows.append(
                {
                    "in": conv.in_channels,
                    "out": conv.out_channels,
                    "kernel": conv.kernel_size[0],
                    "dilation": conv.dilation[0],
                    "padding": conv.padding[0],
                    "gelu": act,
                }
            )
        spec[name] = rows
    blob = np.concatenate(blobs).astype("<f4")
    return spec, base64.b64encode(blob.tobytes()).decode("ascii"), blob


def unpack(spec, blob):
    """Back to float64 arrays, the way the TypeScript port reads them."""
    out = {}
    i = 0
    for name in ("eeg", "env"):
        layers = []
        for L in spec[name]:
            n = L["out"] * L["in"] * L["kernel"]
            W = blob[i : i + n].astype(np.float64).reshape(L["out"], L["in"], L["kernel"])
            i += n
            b = blob[i : i + L["out"]].astype(np.float64)
            i += L["out"]
            layers.append((L, W, b))
        out[name] = layers
    assert i == len(blob)
    return out


def gelu(x):
    return 0.5 * x * (1.0 + erf(x / np.sqrt(2.0)))


def encode(layers, x):
    """
    One encoder over a whole stream (channels x samples), float64, as the
    streaming port computes it: a layer with padding p (or, for the first
    stimulus layer, a kernel reaching k - 1 samples back) sees zeros before
    sample 0, and the right edge is cut where the input runs out.
    """
    T = x.shape[1]
    h = x
    for L, W, b in layers:
        k, d, p = L["kernel"], L["dilation"], L["padding"]
        if p:
            # Centred: output t reads t - p ... t + p; past the end is not final, so mark it NaN.
            hp = np.concatenate([np.zeros((h.shape[0], p)), h, np.full((h.shape[0], p), np.nan)], axis=1)
        else:
            # Reaching back: output t reads t - (k - 1) d ... t.
            back = (k - 1) * d
            hp = np.concatenate([np.zeros((h.shape[0], back)), h], axis=1)
        y = np.tile(b[:, None], (1, T))
        for j in range(k):
            y = y + W[:, :, j] @ hp[:, j * d : j * d + T]
        h = gelu(y) if L["gelu"] else y
    return h


def running_norm_stream(e, tau_s=TAU_S):
    """Each story's loudness over its own recent spread: the plain mean square for the first second, then an exponential average."""
    a = 1.0 / (tau_s * FS)
    out = np.empty_like(e)
    r2 = 0.0
    for t, v in enumerate(e):
        r2 = r2 + (v * v - r2) / (t + 1) if t < FS else r2 + a * (v * v - r2)
        out[t] = v / np.sqrt(max(r2, 1e-12))
    return out


def window_score(ze, zs, start, length):
    """deep.window_scores for one window: centred, each story scaled by its own mean norm."""
    a = ze[:, start : start + length]
    a = a - a.mean(axis=1, keepdims=True)
    na = np.linalg.norm(a, axis=0).mean()
    out = []
    for z in zs:
        b = z[:, start : start + length]
        b = b - b.mean(axis=1, keepdims=True)
        nb = np.linalg.norm(b, axis=0).mean()
        out.append(float((a * b).sum(axis=0).mean() / (na * nb + 1e-6)))
    return out


def check_against_torch(model, weights, x, env):
    """The float64 reference must be the network PyTorch trained, evaluated the streaming way."""
    m64 = D.Decoder(x.shape[0])
    m64.load_state_dict({k: v.detach().cpu() for k, v in model.state_dict().items()})
    m64 = m64.double().eval()
    with torch.no_grad():
        ze_t = m64.eeg(torch.from_numpy(x[None]))[0].numpy()
        e = np.concatenate([np.zeros(D.PRE), env])
        zs_t = m64.env(torch.from_numpy(e[None, None]))[0].numpy()
    ze = encode(weights["eeg"], x)
    zs = encode(weights["env"], env[None])
    edge = ze.shape[1] - 28
    # PyTorch pads the right edge with zeros; the stream simply waits, so compare where both are final.
    de = np.abs(ze[:, :edge] - ze_t[:, :edge]).max()
    ds = np.abs(zs[:, :edge] - zs_t[:, :edge]).max()
    # The weights went through float32 once in both, so only float64 rounding remains.
    assert de < 1e-9 and ds < 1e-9, (de, ds)
    return de, ds


def split_file(seed):
    return os.path.join(ROOT, "deep" + ("" if seed == 7 else f".seed{seed}") + f".ens{ENSEMBLE}.json")


def page_numbers():
    """The learned decoder over the three splits: each person's accuracy averaged over the three models that never saw them."""
    runs = []
    for seed in SPLITS:
        with open(split_file(seed)) as f:
            runs.append(json.load(f))
    windows = [str(W) for W in A.WINDOWS]
    n = len(runs[0]["perSubject"][windows[0]])
    per = [{int(W): float(np.mean([r["perSubject"][W][i] for r in runs])) for W in windows} for i in range(n)]
    mesd = [A.mesd(p) for p in per]
    with open(os.path.join(ROOT, "results.json")) as f:
        bar = json.load(f)["chance"]["60"]
    neural = {
        "mean": {W: float(np.mean([p[int(W)] for p in per])) for W in windows},
        "sem": {W: float(np.std([p[int(W)] for p in per], ddof=1) / np.sqrt(n)) for W in windows},
        "control": {W: float(np.mean([r["control"][W] for r in runs])) for W in windows},
        "mesdMedian": float(np.median(mesd)) if np.isfinite(np.median(mesd)) else None,
        "perSubject60": [round(p[60], 4) for p in per],
        "above60": int(sum(p[60] >= bar - 1e-9 for p in per)),
        "splits": [{"seed": r["seed"], "mean60": r["mean"]["60"], "mean300": r["mean"]["300"], "mesdMedian": r["mesdMedian"]} for r in runs],
        "folds": runs[0]["folds"],
        "ensemble": ENSEMBLE,
    }
    margins = C.flat([r.get("margins10", []) for r in runs])
    with open(os.path.join(ROOT, "calibration.json")) as f:
        linear = {k: v for k, v in json.load(f)["linear"].items() if k != "margins10"}
    fusion = {"seconds": C.SECONDS, "handSet": C.HAND_SET, "linear": linear, "neural": C.summary(margins)}
    with open(os.path.join(ROOT, "belief.json")) as f:
        belief = json.load(f)
    return neural, fusion, belief


def main():
    torch.set_num_threads(4)
    neural, fusion, belief = page_numbers()
    page_path = os.path.join(REPO, "public", "research", "results.json")
    with open(page_path) as f:
        page = json.load(f)
    page["neural"] = neural
    page["fusion"] = fusion
    page["belief"] = belief
    with open(page_path, "w") as f:
        json.dump(page, f, separators=(",", ":"))
    print(
        f"[deep_export] page: 60s {neural['mean']['60']:.3f}, 300s {neural['mean']['300']:.3f}, MESD {neural['mesdMedian']:.0f} s, "
        f"control 60s {neural['control']['60']:.3f}, fusion weight {fusion['neural']['weight']} (linear {fusion['linear']['weight']})",
        flush=True,
    )

    data = D.load()
    subjects = A.load()
    with open(os.path.join(ROOT, "results.json")) as f:
        chans = json.load(f)["configs"]["wireless_4"]["electrodes"]
    cfg = A.Config("wireless_4", subjects[0].names, chans, "wireless")
    scales = []
    for s in subjects:
        warm = (cfg.M @ s.blocks[0].eeg[:, : s.blocks[0].T])[:, : A.WARMUP_S * FS]
        scales.append(1.0 / np.sqrt((warm**2).mean(axis=1)))
    default_scale = np.median(np.array(scales), axis=0)

    rng = np.random.default_rng(D.SEED)
    order = [int(p) for p in rng.permutation(len(data))]
    val, train_people = order[:5], order[5:]
    models = [
        D.train(train_people, val, data, np.random.default_rng(D.SEED + 100 + 1000 * k), seed=D.SEED + 1000 * k).to("cpu")
        for k in range(ENSEMBLE)
    ]
    packed = [pack(m) for m in models]
    spec = packed[0][0]
    assert all(p[0] == spec for p in packed)
    nets = [unpack(spec, p[2]) for p in packed]

    out = {
        "version": 2,
        "kind": "neural",
        "fsRaw": FS_RAW,
        "fs": FS,
        "inputs": chans,
        "sosRaw": np.round(bandpass_sos(FS_RAW), 15).tolist(),
        "sosEnv": np.round(bandpass_sos(FS), 15).tolist(),
        "montage": montage_matrix(chans, chans, "wireless").tolist(),
        # Where a wearer's scale starts; the decoder replaces it with their own over their first minutes.
        "scale": [float(v) for v in default_scale],
        "warmupSeconds": A.WARMUP_S,
        "envTauSeconds": TAU_S,
        "eeg": spec["eeg"],
        "env": spec["env"],
        # One blob per network; a window's scores are the networks' average.
        "weights": [p[1] for p in packed],
        # Log odds per unit of margin for a ten second decision, fitted on held out people.
        "eegWeight": fusion["neural"]["weight"],
        "decisionSeconds": C.SECONDS,
        "trainedOn": {"people": len(train_people), "stoppedOn": len(val), "seed": D.SEED, "epochs": D.EPOCHS, "networks": ENSEMBLE},
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"[deep_export] model: {ENSEMBLE} x {len(packed[0][2])} weights, {os.path.getsize(OUT) / 1024:.0f} kB", flush=True)

    # The fixture: the typical demo recording from its block onset, the earbud chain from a cold start.
    with open(os.path.join(REPO, "public", "research", "people", "typical.json")) as f:
        meta = json.load(f)
    codes = np.fromfile(os.path.join(REPO, "public", "research", "people", "typical.bin"), dtype="<i2").reshape(-1, len(chans)).T
    lead = meta["leadSamples"]
    n_raw = FIXTURE_S * FS_RAW
    seg = codes[:, lead : lead + n_raw]
    raw = seg.astype(np.float64) * meta["lsbUv"] + np.array(meta["offsetsUv"])[:, None]
    filt = causal_filter(np.array(out["sosRaw"]), raw)
    n = int(np.floor((raw.shape[1] - 2) * FS / FS_RAW))
    feat = decimate(filt, n)
    scale = np.array(meta["model"]["scale"])  # this person's own two minute scale, fixed for the test
    derived = (np.array(out["montage"]) @ feat) * scale[:, None]
    sos_env = np.array(out["sosEnv"])
    envs_raw = [np.array(meta["envelopes"][k][:n], dtype=np.float64) for k in range(2)]
    envs = [running_norm_stream(causal_filter(sos_env, e[None])[0]) for e in envs_raw]

    worst = max(max(check_against_torch(m, w, derived, envs[0])) for m, w in zip(models, nets))
    emb = [(encode(w["eeg"], derived), [encode(w["env"], e[None]) for e in envs]) for w in nets]
    final = n - 28
    every = 4
    windows = [(0, 64), (100, 128), (final - 320, 320), (final - 64, 64)]
    fixture = {
        "scale": [float(v) for v in scale],
        "lsbUv": meta["lsbUv"],
        "offsetsUv": meta["offsetsUv"],
        "codes": seg.T.tolist(),
        "envelopes": [[float(v) for v in e] for e in envs_raw],
        # The model this was computed with, so a retrained neural.json without a new fixture fails loudly.
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
    print(f"[deep_export] fixture: {n} samples, {final} final, torch match {worst:.1e}, {os.path.getsize(FIXTURE) / 1024:.0f} kB", flush=True)


if __name__ == "__main__":
    main()
