#!/usr/bin/env python3
"""
Better decoders for the same earbud, judged exactly as the baseline was.

The baseline (analyze.py) rebuilds the followed story's envelope with one
linear backward model and compares one correlation per story. This tries,
for four electrodes per ear on two separate earbuds (the product), with
decoders trained on the other 35 people:

  cca     canonical correlation analysis between the lagged EEG and the
          lagged envelope (de Cheveigne et al. 2018): several pairs of
          projections instead of one, each pair's correlation compared per
          story, combined by a linear discriminant trained on the other
          people's windows
  onset   the same with the envelope's onsets (its rising edges) as a second
          stimulus feature, which the auditory cortex follows too
  adapt   unsupervised adaptation (after Geirnaert et al. 2021): the decoder
          labels a new person's unlabelled minutes itself, is retrained on
          them together with what it learned from others, and repeats; tested
          on a block it never adapted on

Every number is held out: never a person, or for adapt a block, that shaped
the decoder.

    python3 research/aad/improve.py [--jobs 6]

Writes research/aad/improved.json.
"""
import os

os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "2")

import argparse
import json
import multiprocessing as mp
import time
import warnings

import numpy as np

import analyze as A
from pipeline import FS, LAGS, bandpass_sos, causal_filter, lagged, ridge, window_correlations

warnings.filterwarnings("ignore", message=".*encountered in matmul")

ROOT = os.path.dirname(os.path.abspath(__file__))
WINDOWS = A.WINDOWS
# Stimulus lags for CCA: the envelope now and over the last quarter second.
SLAGS = 16
K_MAX = 6
ALPHAS = [1e-2, 1e-1, 1.0, 10.0]
SUBJECTS = []
CFG = None


def onset(env):
    """The envelope's rising edges, band passed like the envelope itself."""
    d = np.diff(env, prepend=env[:1])
    return np.maximum(d, 0.0)


def stim_lagged(s, n):
    """Row t holds s(t), s(t-1), ..., s(t-SLAGS+1): the stimulus up to now."""
    out = np.zeros((n, SLAGS))
    for k in range(SLAGS):
        out[k:, k] = s[: n - k]
    return out


def prep_block(b, feature):
    """The stimulus features for a block, for both stories, at 64 Hz, band passed like the EEG."""
    sos = bandpass_sos(FS)
    feats = {}
    for name, raw in (("att", b.att_raw), ("una", b.una_raw)):
        cols = [causal_filter(sos, raw)]
        if feature == "onset":
            cols.append(causal_filter(sos, onset(raw)))
        feats[name] = np.concatenate([stim_lagged(c, b.T) for c in cols], axis=1)
    return feats


def init_worker(feature):
    global SUBJECTS, CFG
    SUBJECTS = A.load()
    with open(os.path.join(ROOT, "results.json")) as f:
        chans = json.load(f)["configs"]["wireless_4"]["electrodes"]
    CFG = A.Config("wireless_4", SUBJECTS[0].names, chans, "wireless")
    import scipy.io  # noqa: F401  (load the raw envelopes the prep files keep)

    for s in SUBJECTS:
        z = np.load(os.path.join(A.PREP, f"{s.id}.npz"))
        for i, b in enumerate(s.blocks):
            e1 = z[f"raw_env1_{i}"].astype(np.float64)
            e2 = z[f"raw_env2_{i}"].astype(np.float64)
            b.att_raw, b.una_raw = (e1, e2) if s.attended == "left" else (e2, e1)
            b.stim = prep_block(b, feature)
            X = lagged(b.eeg, b.T)
            b.Cxx = X.T @ X
            b.Cxy = X.T @ b.stim["att"]
            b.Cyy = b.stim["att"].T @ b.stim["att"]
            seg = b.eeg[:, : b.T]
            b.S0 = seg @ seg.T
            w = A.WARMUP_S * FS
            b.S0_warm = seg[:, :w] @ seg[:, :w].T


def person_stats(s, sc, blocks=None):
    K = CFG.K(sc)
    blocks = s.blocks if blocks is None else blocks
    Cxx = sum(K @ b.Cxx @ K.T for b in blocks)
    Cxy = sum(K @ b.Cxy for b in blocks)
    Cyy = sum(b.Cyy for b in blocks)
    n = sum(b.T for b in blocks)
    return Cxx, Cxy, Cyy, n


def cca(Cxx, Cxy, Cyy, alpha):
    """Canonical pairs: EEG weights A (dx x k), stimulus weights B (dy x k), strongest first."""
    dx = Cxx.shape[0]
    dy = Cyy.shape[0]
    Rx = Cxx + alpha * np.trace(Cxx) / dx * np.eye(dx)
    Ry = Cyy + 1e-3 * np.trace(Cyy) / dy * np.eye(dy)
    ex, Vx = np.linalg.eigh(Rx)
    ey, Vy = np.linalg.eigh(Ry)
    Wx = Vx @ np.diag(1 / np.sqrt(np.maximum(ex, 1e-12))) @ Vx.T
    Wy = Vy @ np.diag(1 / np.sqrt(np.maximum(ey, 1e-12))) @ Vy.T
    U, S, Vt = np.linalg.svd(Wx @ Cxy @ Wy)
    k = min(K_MAX, len(S))
    return Wx @ U[:, :k], Wy @ Vt.T[:, :k], S[:k]


def components(s, b, Aw, sc):
    """Each canonical EEG component's time course for a block, from the raw 18 channel features."""
    full = CFG.K(sc).T @ Aw  # 576 x k
    out = np.zeros((Aw.shape[1], b.T))
    for j in range(Aw.shape[1]):
        Wj = full[:, j].reshape(-1, LAGS)
        out[j] = A.reconstruct(Wj, b)
    return out


def window_features(comp, stim_att, stim_una, Bw, win):
    """Per window: each pair's correlation with the attended story minus with the other."""
    ya = stim_att @ Bw
    yu = stim_una @ Bw
    k = Bw.shape[1]
    n = (comp.shape[1] // win) * win
    if n == 0:
        return np.empty((0, k))
    feats = []
    for j in range(k):
        r = window_correlations(comp[j, :n], ya[:n, j], yu[:n, j], win)
        feats.append(r[:, 0] - r[:, 1])
    return np.stack(feats, axis=1)


def lda_weights(F):
    """A discriminant for 'the first story is the attended one', trained on both orderings of each window."""
    X = np.concatenate([F, -F])
    y = np.concatenate([np.ones(len(F)), -np.ones(len(F))])
    mu1 = X[y > 0].mean(axis=0)
    mu0 = X[y < 0].mean(axis=0)
    Sw = np.cov(X[y > 0].T) + np.cov(X[y < 0].T)
    Sw = np.atleast_2d(Sw)
    Sw += 1e-3 * np.trace(Sw) / Sw.shape[0] * np.eye(Sw.shape[0])
    return np.linalg.solve(Sw, mu1 - mu0)


def fold(t):
    """Generic CCA decoder for person t, trained on everyone else; accuracies per window length."""
    others = [i for i in range(len(SUBJECTS)) if i != t]
    stats = {i: person_stats(SUBJECTS[i], A.subject_scale(CFG, SUBJECTS[i])) for i in others}
    Cxx = sum(stats[i][0] for i in others)
    Cxy = sum(stats[i][1] for i in others)
    Cyy = sum(stats[i][2] for i in others)
    # Ridge strength by inner validation on the others: first canonical correlation on held out people.
    best = None
    folds = np.array_split(np.array(others), 4)
    for a in ALPHAS:
        rs = []
        for f in folds:
            tr = [i for i in others if i not in f]
            Aw, Bw, _ = cca(sum(stats[i][0] for i in tr), sum(stats[i][1] for i in tr), sum(stats[i][2] for i in tr), a)
            for i in f:
                Cx, Cxy_i, Cy, _ = stats[i]
                num = Aw[:, 0] @ Cxy_i @ Bw[:, 0]
                den = np.sqrt((Aw[:, 0] @ Cx @ Aw[:, 0]) * (Bw[:, 0] @ Cy @ Bw[:, 0]))
                rs.append(num / den)
        if best is None or np.mean(rs) > best[0]:
            best = (np.mean(rs), a)
    Aw, Bw, S = cca(Cxx, Cxy, Cyy, best[1])
    # Window features on the others train each window length's discriminant.
    other_comp = {}
    for i in others:
        s = SUBJECTS[i]
        sc = A.subject_scale(CFG, s)
        other_comp[i] = [(components(s, b, Aw, sc), b) for b in s.blocks]
    s = SUBJECTS[t]
    sc = A.subject_scale(CFG, s, warm=True)
    test = [(components(s, b, Aw, sc), b) for b in s.blocks]
    acc = {}
    for W in WINDOWS:
        win = W * FS
        Ftr = np.concatenate([window_features(c, b.stim["att"], b.stim["una"], Bw, win) for i in others for c, b in other_comp[i]])
        w = lda_weights(Ftr) if len(Ftr) > 4 * Aw.shape[1] else np.ones(Aw.shape[1])
        Fte = np.concatenate([window_features(c, b.stim["att"], b.stim["una"], Bw, win) for c, b in test])
        acc[W] = float(np.mean(Fte @ w > 0)) if len(Fte) else float("nan")
    return t, acc, float(S[0]), best[1]


def adapt_fold(t, iters=3, prior_min=10):
    """
    Unsupervised: the generic linear decoder labels person t's two adaptation
    blocks window by window (30 s), a personal decoder is fit to the
    envelopes it picked plus the generic statistics as prior_min minutes of
    pseudo data, and that repeats; then the held out block is decoded.
    Rotated over the three blocks.
    """
    others = [i for i in range(len(SUBJECTS)) if i != t]
    gstats = []
    for i in others:
        si = SUBJECTS[i]
        sci = A.subject_scale(CFG, si)
        K = CFG.K(sci)
        C = sum(K @ b.Cxx @ K.T for b in si.blocks)
        c = sum(K @ (b.Cxy[:, 0] if b.Cxy.ndim == 2 else b.Cxy) for b in si.blocks)
        gstats.append((C, c, sum(b.T for b in si.blocks)))
    Cg = sum(g[0] for g in gstats)
    cg = sum(g[1] for g in gstats)
    ng = sum(g[2] for g in gstats)
    s = SUBJECTS[t]
    accs = {W: [] for W in WINDOWS}
    for te in range(3):
        tr = [i for i in range(3) if i != te]
        sc = A.subject_scale(CFG, s, [s.blocks[i] for i in tr])
        K = CFG.K(sc)
        w = ridge(Cg, cg, 1.0)
        Xs = {}
        for i in tr:
            b = s.blocks[i]
            Xs[i] = lagged(b.eeg, b.T) @ K.T  # derived lagged features
        for _ in range(iters):
            C = np.zeros_like(Cg)
            c = np.zeros_like(cg)
            for i in tr:
                b = s.blocks[i]
                rec = Xs[i] @ w
                win = 30 * FS
                att_f = causal_filter(bandpass_sos(FS), b.att_raw)
                una_f = causal_filter(bandpass_sos(FS), b.una_raw)
                r = window_correlations(rec, att_f, una_f, win)
                chosen = np.where(np.repeat(r[:, 0] >= r[:, 1], win), att_f[: len(r) * win], una_f[: len(r) * win])
                n = len(chosen)
                C += Xs[i][:n].T @ Xs[i][:n]
                c += Xs[i][:n].T @ chosen
            weight = prior_min * 60 * FS / ng
            w = ridge(C + weight * Cg, c + weight * cg, 1.0)
        b = s.blocks[te]
        W_full = CFG.full_weights(w, sc)
        rec = A.reconstruct(W_full, b)
        for Wd in WINDOWS:
            r = window_correlations(rec, b.att, b.una, Wd * FS)
            accs[Wd].extend((r[:, 0] > r[:, 1]).tolist())
    return t, {W: float(np.mean(v)) for W, v in accs.items()}


def summarize(per):
    accs = {W: [p[W] for p in per] for W in WINDOWS}
    m = [A.mesd(p) for p in per]
    return {
        "mean": {W: float(np.mean(v)) for W, v in accs.items()},
        "sem": {W: float(np.std(v, ddof=1) / np.sqrt(len(v))) for W, v in accs.items()},
        "perSubject": {W: [round(x, 4) for x in v] for W, v in accs.items()},
        "mesdMedian": float(np.median(m)) if np.isfinite(np.median(m)) else None,
    }


def run(method, jobs):
    feature = "onset" if method == "onset" else "env"
    ctx = mp.get_context("spawn")
    with ctx.Pool(jobs, initializer=init_worker, initargs=(feature,)) as pool:
        if method == "adapt":
            out = pool.map(adapt_fold, range(36))
            per = [acc for _, acc in sorted(out)]
            return summarize(per)
        out = pool.map(fold, range(36))
    out.sort()
    res = summarize([acc for _, acc, _, _ in out])
    res["firstCanonicalR"] = float(np.mean([r for _, _, r, _ in out]))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--methods", default="cca,onset,adapt")
    args = ap.parse_args()
    path = os.path.join(ROOT, "improved.json")
    results = json.load(open(path)) if os.path.exists(path) else {}
    for method in args.methods.split(","):
        t0 = time.time()
        res = run(method, args.jobs)
        results[method] = res
        m = res["mean"]
        print(
            f"[improve] {method:6s} 2s {m[2]:.3f} 10s {m[10]:.3f} 60s {m[60]:.3f} 300s {m[300]:.3f} MESD {res['mesdMedian']}  ({time.time() - t0:.0f}s)",
            flush=True,
        )
        with open(path, "w") as f:
            json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
