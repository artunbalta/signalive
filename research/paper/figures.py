#!/usr/bin/env python3
"""
The paper's figures, drawn from the same result files as its numbers
(make_numbers.py). A figure whose results do not exist yet is skipped.

    python3 research/paper/figures.py   # writes research/paper/fig_*.pdf
"""
import glob
import json
import re
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
AAD = os.path.join(ROOT, "..", "aad")
EXT = os.path.join(ROOT, "..", "ext")

plt.rcParams.update({
    "font.family": "serif",
    "font.size": 8.5,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.linewidth": 0.6,
    "xtick.major.width": 0.6,
    "ytick.major.width": 0.6,
    "lines.linewidth": 1.4,
    "legend.frameon": False,
    "savefig.bbox": "tight",
})
INK = "#111111"
GREY = "#7a7a7a"
LIGHT = "#bdbdbd"
ACCENT = "#c47f00"


def load(path):
    return json.load(open(path)) if os.path.exists(path) else None


def save(fig, name):
    fig.savefig(os.path.join(ROOT, f"fig_{name}.pdf"))
    plt.close(fig)
    print(f"[figures] fig_{name}.pdf")


def windows_figure():
    res = load(os.path.join(AAD, "results.json"))
    finals = [load(p) for p in sorted(glob.glob(os.path.join(AAD, "runs", "final.seed*.json"))) if re.search(r"\.seed\d+\.json$", p)]
    part = load(os.path.join(AAD, "runs", "g.part.seed7.json"))
    study = load(os.path.join(AAD, "runs", "g.study.seed7.json"))
    if not res:
        return
    W = res["windows"]
    fig, ax = plt.subplots(figsize=(3.4, 2.5))
    chance = [res["chance"].get(str(w)) for w in W]
    xs = [w for w, c in zip(W, chance) if c is not None]
    ax.fill_between(xs, [1 - c for c in chance if c is not None], [c for c in chance if c is not None], color="#eeeeee", lw=0)
    ax.plot(W, [res["configs"]["wireless_4"]["generic"]["mean"][str(w)] for w in W], color=GREY, label="Linear")
    if finals and all(finals):
        m = np.mean([[f["mean"][str(w)] for w in W] for f in finals], axis=0)
        ax.plot(W, m, color=INK, label="Learned")
        c = np.mean([[f["control"][str(w)] for w in W] for f in finals], axis=0)
        ax.plot(W, c, color=LIGHT, ls=":", label="Learned, out of step")
    if part:
        ax.plot(W, [part["mean"][str(w)] for w in W], color=ACCENT, ls="--", label="Learned, unseen speech")
    if study:
        ax.plot(W, [study["mean"][str(w)] for w in W], color=ACCENT, ls=":", label="Learned, unseen study")
    ax.set_xscale("log")
    ax.set_xticks([1, 2, 5, 10, 30, 60, 300, 600])
    ax.set_xticklabels(["1", "2", "5", "10", "30", "60", "300", "600"])
    ax.set_xlabel("Decision window (s)")
    ax.set_ylabel("Decisions right")
    ax.set_ylim(0.4, 1.0)
    ax.legend(loc="upper left", fontsize=7)
    save(fig, "windows")


def ear_figure():
    e = load(os.path.join(EXT, "earsaad.json"))
    if not e:
        return
    keys = [k for k in ("inear", "aroundear", "both", "scalp") if k in e]
    names = {"inear": "In ear\n(dry)", "aroundear": "Around ear\n(wet)", "both": "Both", "scalp": "Scalp"}
    fig, ax = plt.subplots(figsize=(3.4, 2.3))
    x = np.arange(len(keys))
    for j, (dec, color) in enumerate((("linear", GREY), ("learned", INK))):
        vals = [e[k][dec]["mean"]["60"] for k in keys]
        ax.bar(x + (j - 0.5) * 0.36, vals, width=0.34, color=color, label={"linear": "Linear", "learned": "Learned"}[dec])
    ax.axhline(0.5, color=LIGHT, lw=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels([names[k] for k in keys])
    ax.set_ylim(0.4, 0.9)
    ax.set_ylabel("60 s decisions right")
    ax.legend(loc="upper left", fontsize=7)
    save(fig, "ear")


def hardware_figure():
    hw = load(os.path.join(AAD, "hardware.json"))
    if not hw:
        return
    panels = [
        ("noise", "White noise (nV/$\\sqrt{Hz}$)", False),
        ("pink", "1/f noise, 1 to 9 Hz ($\\mu$V rms)", False),
        ("lsb", "ADC step ($\\mu$V)", False),
        ("rate", "Sampling rate (Hz)", False),
        ("skew", "Right earbud late (ms)", False),
        ("loss", "Frames lost (share)", False),
        ("artifacts", "Movement artifacts per min", True),
        ("envlag", "Envelopes late (ms)", False),
        ("crosstalk", "Envelope crosstalk (share)", False),
        ("mains", "50 Hz common mode ($\\mu$V)", False),
    ]
    panels = [p for p in panels if p[0] in hw]
    n = len(panels)
    cols = 3
    rows = int(np.ceil(n / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(7.0, 1.9 * rows), sharey=True)
    axes = np.atleast_1d(axes).ravel()
    for ax, (kind, label, gated) in zip(axes, panels):
        d = hw[kind]
        lv = d["levels"]
        xs = np.arange(len(lv))
        ax.plot(xs, d["mean60"], color=INK, marker="o", ms=2.5, label="60 s")
        ax.plot(xs, d["mean10"], color=GREY, marker="o", ms=2.5, label="10 s")
        if gated and "gated" in hw:
            ax.plot(xs, hw["gated"]["mean60"], color=ACCENT, marker="o", ms=2.5, ls="--", label="60 s, gated")
        ax.set_xticks(xs)
        ax.set_xticklabels([str(v) for v in lv], fontsize=6.5, rotation=0)
        ax.set_xlabel(label, fontsize=7.5)
        ax.set_ylim(0.45, 0.85)
        ax.axhline(0.5, color=LIGHT, lw=0.6)
    for ax in axes[n:]:
        ax.axis("off")
    axes[0].legend(fontsize=6.5, loc="lower left")
    axes[0].set_ylabel("Decisions right")
    fig.tight_layout()
    save(fig, "hardware")


def clench_figure():
    park = load(os.path.join(EXT, "clench_real.json"))
    phys = load(os.path.join(EXT, "clench_physiomotion.json"))
    if not (park and phys):
        return
    fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 2.4))
    rows = park["sweep"]["rows"]
    a.plot([r["falsePerHour"] for r in rows], [r["caughtShare"] for r in rows], color=INK, marker="o", ms=3)
    for r in rows:
        if r["k"] in (4, 3, 2.5, 2.1):
            a.annotate(f"k = {r['k']:g}", (r["falsePerHour"], r["caughtShare"]), fontsize=6.5, xytext=(4, -9), textcoords="offset points")
    a.axvline(1, color=LIGHT, lw=0.8)
    a.axhline(0.95, color=LIGHT, lw=0.8)
    a.set_xlabel("False reports an hour")
    a.set_ylabel("Cued clenches caught")
    a.set_ylim(0.6, 1.0)
    lab = {r["label"]: r for r in phys["byLabel"]}
    order = [("swallow", "Swallow"), ("eyebrow", "Raised brows"), ("ver_headm", "Nod"), ("blink", "Blink"), ("tongue", "Tongue (speech)"), ("hor_headm", "Head turn")]
    order = [(k, n) for k, n in order if k in lab]
    b.barh([n for _, n in order][::-1], [lab[k]["shareWithReport"] for k, _ in order][::-1], color=[ACCENT if k == "swallow" else GREY for k, _ in order][::-1])
    b.set_xlabel("Share of movements that set it off")
    b.set_xlim(0, 0.6)
    fig.tight_layout()
    save(fig, "clench")


def splice_figure():
    sp = sorted(glob.glob(os.path.join(AAD, "runs", "*.splice.json")))
    if not sp:
        return
    d = load(sp[-1])
    hz = sorted(d["byHazard"], key=float)
    fig, ax = plt.subplots(figsize=(3.4, 2.3))
    xs = [d["byHazard"][h]["switchMedianS"] for h in hz]
    ys = [d["byHazard"][h]["steadyShare"] for h in hz]
    ax.plot(xs, ys, color=INK, marker="o", ms=3)
    for h, x, y in zip(hz, xs, ys):
        ax.annotate(f"h={float(h) * 100:g}%", (x, y), fontsize=6.5, xytext=(3, 3), textcoords="offset points")
    ax.set_xlabel("Median time to follow a real switch (s)")
    ax.set_ylabel("Belief on the followed story")
    save(fig, "splice")


if __name__ == "__main__":
    for fn in (windows_figure, ear_figure, hardware_figure, clench_figure, splice_figure):
        fn()
