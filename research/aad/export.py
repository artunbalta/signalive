#!/usr/bin/env python3
"""
Everything the site and lib/sense need from the analysis, written once:

  public/research/results.json         the numbers behind the research page
  public/research/people/<id>.json     per demo participant: the decoder that
                                       never saw them, the two stories'
                                       envelopes, and how every window of
                                       their 30 minutes came out
  public/research/people/<id>.bin      their raw ear EEG at 500 Hz (int16),
                                       the first block from 20 s before the
                                       stories start, so the browser runs the
                                       earbud pipeline on the real recording
  lib/sense/__fixtures__/e2e.json      the first seconds of one of them with
                                       the reconstruction this reference
                                       chain produces, for the TypeScript port

The decoder shipped for each participant is the generic one: trained on the
other 35 people, scaled with the participant's own first two minutes, which
needs no labels. The configuration is four electrodes per ear, each ear
referenced to itself, as two independent earbuds would be.

    python3 research/aad/export.py
"""
import json
import os
import urllib.request
import warnings

import numpy as np
import scipy.io as sio

import analyze as A
from pipeline import FS, FS_RAW, LAGS, bandpass_sos, causal_filter, decimate, montage_matrix, ridge

warnings.filterwarnings("ignore", message=".*encountered in matmul")

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(ROOT, "..", ".."))
OUT = os.path.join(REPO, "public", "research")
FIXTURES = os.path.join(REPO, "lib", "sense", "__fixtures__")
CONFIG = "wireless_4"
LEAD_S = 20
DEMO_S = 180
LSB_UV = 0.1
E2E_S = 6


def raw_segment(sub, chans, block):
    """The participant's raw recording for the chosen electrodes, LEAD_S before the block onset to DEMO_S after."""
    base = "https://s3.amazonaws.com/openneuro.org/ds004015"
    stem = f"{sub}/eeg/{sub}_task-AttendedSpeakerParadigmcEEGridAttention"
    tmp = os.path.join(ROOT, "data", "raw")
    os.makedirs(tmp, exist_ok=True)
    paths = {}
    for ext in ("eeg.set", "eeg.fdt", "events.tsv"):
        p = os.path.join(tmp, f"{sub}_{ext}")
        if not os.path.exists(p):
            urllib.request.urlretrieve(f"{base}/{stem}_{ext}", p)
        paths[ext] = p
    eeg = sio.loadmat(paths["eeg.set"], squeeze_me=True, struct_as_record=False)["EEG"]
    x = np.fromfile(paths["eeg.fdt"], dtype="<f4").reshape(eeg.pnts, eeg.nbchan).T
    names = [c.labels for c in eeg.chanlocs]
    import csv

    with open(paths["events.tsv"]) as f:
        onsets = [float(r["onset"]) for r in csv.DictReader(f, delimiter="\t") if r["value"] == "StartTrigger"]
    start = int(round(onsets[block - 1] * FS_RAW)) - LEAD_S * FS_RAW
    n = (LEAD_S + DEMO_S) * FS_RAW + int(np.ceil(LAGS * FS_RAW / FS)) + 16
    seg = x[[names.index(c) for c in chans], start : start + n].astype(np.float64)
    os.remove(paths["eeg.fdt"])
    return seg


def quantize(seg):
    """int16 at LSB_UV microvolts after removing each channel's median; returns codes, offsets and the clipped share."""
    off = np.median(seg, axis=1, keepdims=True)
    q = np.round((seg - off) / LSB_UV)
    clipped = float(np.mean(np.abs(q) > 32767))
    return np.clip(q, -32768, 32767).astype(np.int16), off[:, 0], clipped


def reference_chain(model, raw):
    """The reconstruction exactly as lib/sense computes it from raw microvolts, from a cold start."""
    sos = np.array(model["sosRaw"])
    filt = causal_filter(sos, raw)
    n = int(np.floor((raw.shape[1] - 2) * FS / FS_RAW))
    feat = decimate(filt, n)
    derived = (np.array(model["montage"]) @ feat) * np.array(model["scale"])[:, None]
    W = np.array(model["weights"])
    m = n - LAGS + 1
    rec = np.zeros(m)
    for k in range(LAGS):
        rec += W[:, k] @ derived[:, k : k + m]
    return rec


def main():
    with open(os.path.join(ROOT, "results.json")) as f:
        results = json.load(f)
    head = results["configs"][CONFIG]
    chans = head["electrodes"]
    per = np.array(head["generic"]["perSubject"]["60"])

    subjects = A.load()
    for s in subjects:
        for b in s.blocks:
            A.block_stats(b)
    names = subjects[0].names
    cfg = A.Config(CONFIG, names, chans, "wireless")
    stats = A.generic_stats(cfg, subjects)

    # The clearest, the median and the hardest person, so the page shows the spread, not a highlight.
    order = np.argsort(per, kind="stable")
    picks = {"clearest": int(order[-1]), "typical": int(order[len(order) // 2]), "hardest": int(order[0])}
    os.makedirs(os.path.join(OUT, "people"), exist_ok=True)
    people_out = []
    e2e = None
    for label, t in picks.items():
        s = subjects[t]
        idx = [i for i in range(len(subjects)) if i != t]
        alpha = A.choose_alpha_generic(stats, idx)
        w = ridge(sum(stats[i][0] for i in idx), sum(stats[i][1] for i in idx), alpha)
        sc = A.subject_scale(cfg, s, warm=True)
        W_full = cfg.full_weights(w, sc)

        # Every window of all 30 minutes, as the analysis scored them.
        timeline = {}
        for win in (10, 60):
            rows = []
            for b in s.blocks:
                rec = A.reconstruct(W_full, b)
                r = A.window_correlations(rec, b.att, b.una, win * FS)
                rows.extend([[round(float(a), 4), round(float(u), 4)] for a, u in r])
            timeline[str(win)] = rows

        block = int(np.load(os.path.join(A.PREP, f"{s.id}.npz"))["blocks"][0])
        seg = raw_segment(s.id, chans, block)
        codes, offsets, clipped = quantize(seg)
        offsets = np.round(offsets, 3)
        # Exactly what the browser reconstructs from the file: codes times the LSB plus the rounded offsets.
        dequant = codes.astype(np.float64) * LSB_UV + offsets[:, None]

        z = np.load(os.path.join(A.PREP, f"{s.id}.npz"))
        n_env = DEMO_S * FS
        env1, env2 = z["raw_env1_0"][:n_env], z["raw_env2_0"][:n_env]
        attended = 0 if s.attended == "left" else 1
        model = {
            "version": 1,
            "fsRaw": FS_RAW,
            "fs": FS,
            "inputs": chans,
            "sosRaw": np.round(bandpass_sos(FS_RAW), 15).tolist(),
            "sosEnv": np.round(bandpass_sos(FS), 15).tolist(),
            "montage": montage_matrix(chans, chans, "wireless").tolist(),
            "scale": [float(v) for v in sc],
            "lags": LAGS,
            "weights": [[float(v) for v in row] for row in w.reshape(len(chans), LAGS)],
        }
        meta = {
            "id": s.id,
            "label": label,
            "study": s.study,
            "attended": s.attended,
            "accuracy60": float(per[t]),
            "accuracy10": float(head["generic"]["perSubject"]["10"][t]),
            "fsRaw": FS_RAW,
            "channels": chans,
            "lsbUv": LSB_UV,
            "offsetsUv": [round(float(o), 3) for o in offsets],
            "samples": int(codes.shape[1]),
            "leadSamples": LEAD_S * FS_RAW,
            "clippedShare": clipped,
            # Story 1 played on the left, story 2 on the right.
            "envelopes": [np.round(env1, 5).tolist(), np.round(env2, 5).tolist()],
            "attendedStory": attended,
            "model": model,
            "timeline": timeline,
        }
        with open(os.path.join(OUT, "people", f"{label}.json"), "w") as f:
            json.dump(meta, f, separators=(",", ":"))
        # Interleaved by sample, little endian: every channel of sample 0, then sample 1.
        codes.T.astype("<i2").tofile(os.path.join(OUT, "people", f"{label}.bin"))
        people_out.append({"label": label, "id": s.id, "accuracy60": float(per[t]), "attended": s.attended})
        print(f"[export] {label:8s} {s.id} 60s {per[t]:.3f}  clipped {clipped:.5f}  alpha {alpha}", flush=True)

        if e2e is None:
            n_raw = E2E_S * FS_RAW
            rec = reference_chain(model, dequant[:, :n_raw])
            e2e = {
                "model": model,
                "lsbUv": LSB_UV,
                "offsetsUv": meta["offsetsUv"],
                "codes": codes[:, :n_raw].T.tolist(),
                "recon": [float(v) for v in rec],
            }

    with open(os.path.join(FIXTURES, "e2e.json"), "w") as f:
        json.dump(e2e, f, separators=(",", ":"))

    page = {
        "dataset": {
            "name": "Attended speaker paradigm (cEEGrid data)",
            "doi": "10.18112/openneuro.ds004015.v1.0.2",
            "license": "CC0",
            "paper": "https://doi.org/10.3389/fnins.2022.869426",
            "people": len(subjects),
            "minutesPerPerson": 30,
        },
        "windows": results["windows"],
        "chance": results["chance"],
        "configs": {
            name: {
                "mode": c["mode"],
                "ears": c["ears"],
                "electrodes": c["electrodes"],
                **{
                    kind: {
                        **{k: c[kind][k] for k in ("mean", "sem", "median", "mesdMedian", "reconR")},
                        # People whose own 30 minutes beat chance, at one minute decisions.
                        "above60": int(sum(v >= results["chance"]["60"] - 1e-9 for v in c[kind]["perSubject"]["60"])),
                    }
                    for kind in ("generic", "personal")
                },
                "perSubject60": c["generic"]["perSubject"]["60"],
            }
            for name, c in results["configs"].items()
        },
        "calibration": results["calibration"],
        "electrodeOrder": results["electrodeOrder"],
        "people": people_out,
        "method": results["method"],
    }
    # The learned decoder's blocks come from deep_export.py; keep them across a rerun of this.
    path = os.path.join(OUT, "results.json")
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f)
        page.update({k: old[k] for k in ("neural", "fusion", "belief") if k in old})
    with open(path, "w") as f:
        json.dump(page, f, separators=(",", ":"))
    print("[export] done", flush=True)


if __name__ == "__main__":
    main()
