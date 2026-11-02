#!/usr/bin/env python3
"""
What the public cEEGrid recordings say about the earbud.

Questions, each answered on held out data only:

  1. How often does a decoder pick the story a person was told to follow,
     for decision windows from 1 to 60 seconds?
  2. Does it survive true wireless earbuds? Two earbuds share no electrical
     reference, so each ear has to be referenced to itself. 'wired' keeps the
     recording's reference behind the right ear for every electrode;
     'wireless' references each ear to its own average; 'left' and 'right'
     use one earbud alone.
  3. How many electrodes per ear does it need, and which?
  4. How much calibration does each person need? A generic decoder trained
     on other people, a personal one trained on 1 to 20 minutes of the
     wearer's own data, and the generic one adapted with those minutes.
  5. How fast can attention switches be followed? The minimal expected
     switch duration (MESD) of Geirnaert et al. folds accuracy and window
     length into one number of seconds.

Personal decoders are tested on a block they never saw (leave one block
out); generic ones on a person they never saw (leave one subject out).

    python3 research/aad/analyze.py [--jobs 6]

Writes research/aad/results.json (and prints a summary).
"""
import os

# Several worker processes share the cores; each keeps its linear algebra to two threads.
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "2")
os.environ.setdefault("OMP_NUM_THREADS", "2")

import argparse
import glob
import json
import multiprocessing as mp
import time
import warnings

import numpy as np

from pipeline import FS, LAGS, lagged, montage_matrix, ridge, window_correlations

# NumPy 2.0 with Apple's Accelerate reports floating point warnings from matmul
# on perfectly finite results; fixtures.py checks the arithmetic itself.
warnings.filterwarnings("ignore", message=".*encountered in matmul")

ROOT = os.path.dirname(os.path.abspath(__file__))
PREP = os.path.join(ROOT, "data", "prep")
WINDOWS = [1, 2, 5, 10, 20, 30, 60]
ALPHAS = [1e-3, 1e-2, 1e-1, 1.0, 10.0, 100.0]
CALIB_MIN = [1, 2, 5, 10, 20]
# The generic decoder counts as this many minutes of data when adapted.
PRIOR_MIN = 10
# Warm up for the per channel scale of a person the decoder has never seen.
WARMUP_S = 120
LEFT = ["L01", "L02", "L03", "L04", "L04a", "L04b", "L05", "L06", "L07", "L08"]
RIGHT = ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08"]

SUBJECTS = []


class Block:
    def __init__(self, eeg, att, una):
        self.eeg = eeg
        self.att = att
        self.una = una
        self.T = len(att)


class Subject:
    def __init__(self, sid, attended, study, names, blocks):
        self.id = sid
        self.attended = attended
        self.study = study
        self.names = names
        self.blocks = blocks


def load():
    subjects = []
    for path in sorted(glob.glob(os.path.join(PREP, "sub-*.npz"))):
        z = np.load(path)
        side = str(z["attended"])
        blocks = []
        for i in range(3):
            s1 = z[f"s1_{i}"].astype(np.float64)
            s2 = z[f"s2_{i}"].astype(np.float64)
            # Story 1 is the left audio channel, story 2 the right one.
            att, una = (s1, s2) if side == "left" else (s2, s1)
            blocks.append(Block(z[f"eeg{i}"].astype(np.float64), att, una))
        sid = os.path.basename(path)[:-4]
        subjects.append(Subject(sid, side, str(z["study"]), [str(n) for n in z["channels"]], blocks))
    return subjects


def block_stats(b):
    """Lagged covariances of the 18 recorded channels, from which every montage is derived."""
    X = lagged(b.eeg, b.T)
    b.C = X.T @ X
    b.ca = X.T @ b.att
    b.saa = float(b.att @ b.att)
    seg = b.eeg[:, : b.T]
    b.S0 = seg @ seg.T
    w = WARMUP_S * FS
    b.S0_warm = seg[:, :w] @ seg[:, :w].T


class Config:
    """A montage over chosen electrodes: which channels, and how they are referenced."""

    def __init__(self, name, names, chans, mode):
        self.name = name
        self.chans = chans
        self.mode = mode
        self.M = montage_matrix(names, chans, mode)

    def scale(self, S0, n):
        var = np.einsum("ij,jk,ik->i", self.M, S0, self.M) / n
        return 1.0 / np.sqrt(np.maximum(var, 1e-12))

    def K(self, sc):
        return np.kron(self.M * sc[:, None], np.eye(LAGS))

    def derived(self, b, sc):
        K = self.K(sc)
        return K @ b.C @ K.T, K @ b.ca

    def full_weights(self, w, sc):
        """Weights on the 18 recorded channels x lags, so a reconstruction is one pass over raw features."""
        return (self.K(sc).T @ w).reshape(-1, LAGS)


def subject_scale(cfg, s, blocks=None, warm=False):
    if warm:
        return cfg.scale(s.blocks[0].S0_warm, WARMUP_S * FS)
    blocks = s.blocks if blocks is None else blocks
    return cfg.scale(sum(b.S0 for b in blocks), sum(b.T for b in blocks))


def reconstruct(W, b):
    rec = np.zeros(b.T)
    for k in range(LAGS):
        rec += W[:, k] @ b.eeg[:, k : k + b.T]
    return rec


def held_out_r(w, C, c, saa):
    den = np.sqrt(max(w @ C @ w, 1e-20) * saa)
    return float(w @ c / den)


def accuracies(recs):
    """recs: (reconstruction, attended, ignored) per test block of one person; accuracy per window length."""
    out = {}
    for W in WINDOWS:
        hits = []
        for rec, att, una in recs:
            r = window_correlations(rec, att, una, W * FS)
            hits.extend((r[:, 0] > r[:, 1]).tolist())
        out[W] = float(np.mean(hits))
    return out


def recon_r(recs):
    return float(np.mean([np.corrcoef(rec, att)[0, 1] for rec, att, _ in recs]))


# ---------------------------------------------------------------- personal


def train_personal(cfg, s, train_idx):
    """Personal decoder on the given blocks; ridge strength chosen by validating one training block on the other."""
    sc = subject_scale(cfg, s, [s.blocks[i] for i in train_idx])
    stats = {i: cfg.derived(s.blocks[i], sc) for i in train_idx}
    best = None
    for a in ALPHAS:
        rs = []
        for va in train_idx:
            tr = [i for i in train_idx if i != va]
            w = ridge(sum(stats[i][0] for i in tr), sum(stats[i][1] for i in tr), a)
            rs.append(held_out_r(w, stats[va][0], stats[va][1], s.blocks[va].saa))
        if best is None or np.mean(rs) > best[0]:
            best = (np.mean(rs), a)
    w = ridge(sum(stats[i][0] for i in train_idx), sum(stats[i][1] for i in train_idx), best[1])
    return w, sc, best[1]


def personal_eval(cfg, subjects):
    """Leave one block out for every person."""
    per = []
    for s in subjects:
        recs = []
        for te in range(3):
            w, sc, _ = train_personal(cfg, s, [i for i in range(3) if i != te])
            b = s.blocks[te]
            recs.append((reconstruct(cfg.full_weights(w, sc), b), b.att, b.una))
        per.append({"acc": accuracies(recs), "r": recon_r(recs)})
    return per


# ---------------------------------------------------------------- generic


def generic_stats(cfg, subjects):
    """Per person derived covariances, each person scaled by their own channel spread."""
    out = []
    for s in subjects:
        sc = subject_scale(cfg, s)
        C, c = 0, 0
        for b in s.blocks:
            Cb, cb = cfg.derived(b, sc)
            C, c = C + Cb, c + cb
        out.append((C, c, sum(b.saa for b in s.blocks), sum(b.T for b in s.blocks)))
    return out


def choose_alpha_generic(stats, idx):
    folds = np.array_split(np.array(idx), 5)
    best = None
    for a in ALPHAS:
        rs = []
        for f in folds:
            tr = [i for i in idx if i not in f]
            w = ridge(sum(stats[i][0] for i in tr), sum(stats[i][1] for i in tr), a)
            rs.extend(held_out_r(w, stats[i][0], stats[i][1], stats[i][2]) for i in f)
        if best is None or np.mean(rs) > best[0]:
            best = (np.mean(rs), a)
    return best[1]


def generic_eval(cfg, subjects, stats):
    """Leave one subject out; the test person's channel scale comes from their first two minutes, unlabelled."""
    per = []
    n = len(subjects)
    for t in range(n):
        idx = [i for i in range(n) if i != t]
        a = choose_alpha_generic(stats, idx)
        w = ridge(sum(stats[i][0] for i in idx), sum(stats[i][1] for i in idx), a)
        s = subjects[t]
        W = cfg.full_weights(w, subject_scale(cfg, s, warm=True))
        recs = [(reconstruct(W, b), b.att, b.una) for b in s.blocks]
        per.append({"acc": accuracies(recs), "r": recon_r(recs), "alpha": a})
    return per


# ---------------------------------------------------------------- calibration


def adapt(C, c, prior):
    """Adds the generic decoder's statistics as PRIOR_MIN minutes worth of pseudo data."""
    Cg, cg, ng = prior
    weight = PRIOR_MIN * 60 * FS / ng
    return C + weight * Cg, c + weight * cg


def partial_block(b, n):
    out = Block(b.eeg[:, : n + LAGS], b.att[:n], b.una[:n])
    block_stats(out)
    return out


def calibration_eval(cfg, subjects, stats):
    """Personal decoders from m minutes of the wearer's own data, alone and on top of the generic decoder."""
    res = {"personal": {m: [] for m in CALIB_MIN}, "adapted": {m: [] for m in [0] + CALIB_MIN}}
    n = len(subjects)
    for t, s in enumerate(subjects):
        idx = [i for i in range(n) if i != t]
        a = choose_alpha_generic(stats, idx)
        prior = (sum(stats[i][0] for i in idx), sum(stats[i][1] for i in idx), sum(stats[i][3] for i in idx))
        recs = {(k, m): [] for k in res for m in res[k]}
        w0 = ridge(prior[0], prior[1], a)
        W0 = cfg.full_weights(w0, subject_scale(cfg, s, warm=True))
        for te in range(3):
            tr = [i for i in range(3) if i != te]
            b = s.blocks[te]
            recs[("adapted", 0)].append((reconstruct(W0, b), b.att, b.una))
            for m in CALIB_MIN:
                need = m * 60 * FS
                parts = []
                for i in tr:
                    if need <= 0:
                        break
                    take = min(need, s.blocks[i].T)
                    parts.append(s.blocks[i] if take == s.blocks[i].T else partial_block(s.blocks[i], take))
                    need -= take
                sc = subject_scale(cfg, s, parts)
                derived = [cfg.derived(p, sc) for p in parts]
                C = sum(d[0] for d in derived)
                c = sum(d[1] for d in derived)
                recs[("personal", m)].append((reconstruct(cfg.full_weights(ridge(C, c, 1.0), sc), b), b.att, b.una))
                Ca, ca = adapt(C, c, prior)
                recs[("adapted", m)].append((reconstruct(cfg.full_weights(ridge(Ca, ca, a), sc), b), b.att, b.una))
        for (k, m), r in recs.items():
            res[k][m].append(accuracies(r))
    return res


# ---------------------------------------------------------------- electrodes


def ear_ranking(side_names, alpha=1.0):
    """
    Greedy electrode order for one earbud alone, referenced to itself: the
    best pair first, then whichever electrode adds the most, judged by how
    well a generic decoder reconstructs the attended story for people it
    never saw.
    """
    subjects = SUBJECTS
    names = subjects[0].names

    def score(chans):
        cfg = Config("rank", names, chans, "wireless")
        stats = generic_stats(cfg, subjects)
        Ctot = sum(st[0] for st in stats)
        ctot = sum(st[1] for st in stats)
        rs = []
        for t in range(len(subjects)):
            w = ridge(Ctot - stats[t][0], ctot - stats[t][1], alpha)
            rs.append(held_out_r(w, stats[t][0], stats[t][1], stats[t][2]))
        return float(np.mean(rs))

    pairs = [[a, b] for i, a in enumerate(side_names) for b in side_names[i + 1 :]]
    first = max((score(p), p) for p in pairs)
    order = list(first[1])
    trail = [[len(order), first[0]]]
    while len(order) < len(side_names):
        best = max((score(order + [c]), c) for c in side_names if c not in order)
        order.append(best[1])
        trail.append([len(order), best[0]])
    return order, trail


# ---------------------------------------------------------------- MESD


# Parameters of the metric as published: the attended voice must sit in the
# top 35% of the gain range (comfort level 0.65) at least 80% of the time,
# with at least five gain steps.
P0, COMFORT, N_MIN = 0.8, 0.65, 5


def emtt(p, tau):
    """
    Expected Markov transit time (Geirnaert, Francart and Bertrand, EUSIPCO
    2019, eqs. 2 to 7): a gain control chain takes one step per decision,
    toward the decoded voice; this is the expected time, after a switch of
    attention, to bring the newly attended voice up to the comfort level,
    starting from where the chain sat for the previous voice, in the
    smallest chain whose steady state meets the comfort constraint.
    """
    if p <= 0.5:
        return np.inf
    p = min(p, 0.999)
    r = p / (1.0 - p)
    lr = np.log(r)
    N = N_MIN
    while True:
        # Lower bound of the P0 interval, eq. 2, in logs so r^N cannot overflow.
        log_term = N * lr + np.log((1.0 - P0) + P0 * np.exp(-N * lr))
        kbar = np.floor(log_term / lr + 1.0)
        if (kbar - 1.0) / (N - 1.0) >= COMFORT:
            break
        N += 1
        if N > 50000:
            return np.inf
    k = int(np.ceil(COMFORT * (N - 1) + 1 - 1e-9))
    i = np.arange(1, k, dtype=np.float64)
    # Mean hitting time of state k from state i, eq. 5.
    h = (k - i) / (2 * p - 1) + p * (r ** (-k) - r ** (-i)) / (2 * p - 1) ** 2
    # Start distribution: the reversed steady state below k, eq. 6.
    w = r ** (-(i - 1))
    return tau * float((w * h).sum() / w.sum())


def mesd(acc):
    """Minimal expected switch duration in seconds: the best transit time over window lengths, p interpolated linearly."""
    grid = np.arange(WINDOWS[0], WINDOWS[-1] + 0.01, 0.25)
    pg = np.interp(grid, WINDOWS, [acc[W] for W in WINDOWS])
    return min(emtt(p, tau) for tau, p in zip(grid, pg))


# ---------------------------------------------------------------- summary


def summarize(per):
    accs = {W: [p["acc"][W] for p in per] for W in WINDOWS}
    m = [mesd(p["acc"]) for p in per]
    return {
        "mean": {W: float(np.mean(v)) for W, v in accs.items()},
        "sem": {W: float(np.std(v, ddof=1) / np.sqrt(len(v))) for W, v in accs.items()},
        "median": {W: float(np.median(v)) for W, v in accs.items()},
        "perSubject": {W: [round(x, 4) for x in v] for W, v in accs.items()},
        "reconR": float(np.mean([p["r"] for p in per])),
        # The median person's MESD; infinite when most people never reach a stable gain.
        "mesdMedian": float(np.median(m)) if np.isfinite(np.median(m)) else None,
        "mesdPerSubject": [round(float(x), 2) if np.isfinite(x) else None for x in m],
    }


def refresh_mesd(results):
    """Recomputes every MESD from the stored per person accuracies, without rerunning the decoders."""
    for cfg in results["configs"].values():
        for kind in ("generic", "personal"):
            per = cfg[kind]["perSubject"]
            get = lambda W: per[W] if W in per else per[str(W)]
            m = [mesd({W: get(W)[i] for W in WINDOWS}) for i in range(len(get(WINDOWS[0])))]
            cfg[kind]["mesdMedian"] = float(np.median(m)) if np.isfinite(np.median(m)) else None
            cfg[kind]["mesdPerSubject"] = [round(float(x), 2) if np.isfinite(x) else None for x in m]
    return results


def chance_threshold(W, total_min=30, alpha=0.05):
    """Accuracy one person needs before it differs from coin flipping, for 30 minutes cut into windows of W s."""
    from scipy.stats import binom

    n = int(total_min * 60 // W)
    k = int(binom.ppf(1 - alpha, n, 0.5)) + 1
    return k / n


def run_config(spec):
    name, chans, mode = spec
    t1 = time.time()
    cfg = Config(name, SUBJECTS[0].names, chans, mode)
    stats = generic_stats(cfg, SUBJECTS)
    out = {
        "mode": mode,
        "ears": "both" if name.startswith("wire") else name.split("_")[0],
        "electrodes": chans,
        "generic": summarize(generic_eval(cfg, SUBJECTS, stats)),
        "personal": summarize(personal_eval(cfg, SUBJECTS)),
    }
    g, p = out["generic"], out["personal"]
    print(
        f"[analyze] {name:13s} personal 2s {p['mean'][2]:.3f} 10s {p['mean'][10]:.3f} 60s {p['mean'][60]:.3f} MESD {p['mesdMedian']}"
        f" | generic 2s {g['mean'][2]:.3f} 10s {g['mean'][10]:.3f} 60s {g['mean'][60]:.3f} MESD {g['mesdMedian']}  ({time.time() - t1:.0f}s)",
        flush=True,
    )
    return name, out


def run_calibration(spec):
    name, chans, mode = spec
    cfg = Config(name, SUBJECTS[0].names, chans, mode)
    calib = calibration_eval(cfg, SUBJECTS, generic_stats(cfg, SUBJECTS))
    mean = lambda accs: {str(W): float(np.mean([a[W] for a in accs])) for W in WINDOWS}
    return {
        "config": name,
        "priorMinutes": PRIOR_MIN,
        "personal": {str(m): mean(a) for m, a in calib["personal"].items()},
        "adapted": {str(m): mean(a) for m, a in calib["adapted"].items()},
    }


def init_worker():
    global SUBJECTS
    SUBJECTS = load()
    for s in SUBJECTS:
        for b in s.blocks:
            block_stats(b)


def main():
    global SUBJECTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--mesd-only", action="store_true", help="recompute MESD in results.json from its stored accuracies")
    args = ap.parse_args()
    if args.mesd_only:
        path = os.path.join(ROOT, "results.json")
        with open(path) as f:
            results = refresh_mesd(json.load(f))
        with open(path, "w") as f:
            json.dump(results, f, indent=1)
        print("[analyze] MESD recomputed", flush=True)
        return
    t0 = time.time()
    SUBJECTS = load()
    print(f"[analyze] {len(SUBJECTS)} people, {sum(len(s.blocks) for s in SUBJECTS)} blocks", flush=True)

    # Each worker loads the data itself: forking a process whose linear
    # algebra threads are already running deadlocks with Apple's Accelerate.
    ctx = mp.get_context("spawn")
    with ctx.Pool(args.jobs, initializer=init_worker) as pool:
        (left_order, left_trail), (right_order, right_trail) = pool.map(ear_ranking, [LEFT, RIGHT])
        print(f"[analyze] left ear order {left_order}", flush=True)
        print(f"[analyze] right ear order {right_order}  ({time.time() - t0:.0f}s)", flush=True)

        specs = []
        for k in (2, 3, 4, 6, 8):
            lk, rk = left_order[:k], right_order[:k]
            specs += [(f"wired_{k}", lk + rk, "wired"), (f"wireless_{k}", lk + rk, "wireless"), (f"left_{k}", lk, "wireless"), (f"right_{k}", rk, "wireless")]
        specs += [("wired_all", LEFT + RIGHT, "wired"), ("wireless_all", LEFT + RIGHT, "wireless")]
        head = next(s for s in specs if s[0] == "wireless_4")

        calib_job = pool.apply_async(run_calibration, (head,))
        configs = dict(pool.map(run_config, specs, chunksize=1))
        calibration = calib_job.get()
    print(f"[analyze] calibration {json.dumps(calibration)}", flush=True)

    results = {
        "configs": configs,
        "calibration": calibration,
        "electrodeOrder": {"left": left_order, "right": right_order, "leftTrail": left_trail, "rightTrail": right_trail},
        "chance": {str(W): chance_threshold(W) for W in WINDOWS},
        "windows": WINDOWS,
        "people": [{"id": s.id, "attended": s.attended, "study": s.study} for s in SUBJECTS],
        "method": {
            "band": [1, 9],
            "fs": FS,
            "lags": LAGS,
            "alphas": ALPHAS,
            "warmupSeconds": WARMUP_S,
            "personal": "leave one 10 minute block out (20 minutes of training data)",
            "generic": "leave one subject out (35 people of training data); the test person's channel scale comes from their first 2 minutes",
        },
    }
    with open(os.path.join(ROOT, "results.json"), "w") as f:
        json.dump(results, f, indent=1)
    print(f"[analyze] done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
