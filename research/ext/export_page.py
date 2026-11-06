#!/usr/bin/env python3
"""
The numbers /research shows from beyond its first dataset, in one file:
public/research/beyond.json. Each part is read from the result file its
own script wrote, and left out when that file does not exist yet.

  clench      research/ext/clench_*.json      (clench_*.test.ts)
  inEar       research/ext/earsaad.json       (earsaad_decode.py)
  heldOut     research/aad/runs/*.json        (deep3.py with "holdout")
  hardware    research/aad/hardware.json      (hardware_bars.py)
  splice      research/aad/runs/*.splice.json (switch_splice.py)
  hold        research/aad/hold_value.json    (hold_value.py)

    python3 research/ext/export_page.py
"""
import glob
import json
import re
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(ROOT, "..", "..")
AAD = os.path.join(ROOT, "..", "aad")
OUT = os.path.join(REPO, "public", "research", "beyond.json")


def load(path):
    return json.load(open(path)) if os.path.exists(path) else None


def r3(v):
    return None if v is None else round(float(v), 4)


def clench():
    park = load(os.path.join(ROOT, "clench_real.json"))
    muse = load(os.path.join(ROOT, "clench_muse.json"))
    phys = load(os.path.join(ROOT, "clench_physiomotion.json"))
    lis = load(os.path.join(ROOT, "clench_listening.json"))
    if not (park and muse and phys and lis):
        return None
    own = park["ownEar"]
    hours_park = sum(v["minutes"] for v in own["falseIn"].values()) / 60
    reports_park = sum(v["reports"] for v in own["falseIn"].values())
    hours_muse = sum(v["minutes"] for v in muse["k4"]["falseIn"].values()) / 60
    reports_muse = sum(v["reports"] for v in muse["k4"]["falseIn"].values())
    labels = {r["label"]: r for r in phys["byLabel"]}
    movement = []
    for key in ("swallow", "eyebrow", "ver_headm", "blink", "tongue", "hor_headm"):
        r = labels.get(key)
        if r:
            movement.append({"key": key, "events": r["events"], "share": r["shareWithReport"], "doubles": r["doubles"]})
    eyes = [labels[k] for k in ("ver_eyem", "hor_eyem") if k in labels]
    if eyes:
        n = sum(e["events"] for e in eyes)
        movement.append({"key": "eyes", "events": n, "share": round(sum(e["shareWithReport"] * e["events"] for e in eyes) / n, 4), "doubles": sum(e["doubles"] for e in eyes)})
    return {
        "threshold": 4,
        "datasets": [
            {"key": "around", "people": 15, "fs": 250, "caught": own["caughtShare"], "peopleAll": sum(1 for c in own["perPersonCaught"] if c >= 9), "falsePerHour": round(reports_park / hours_park, 2)},
            {"key": "headband", "people": muse["k4"]["people"], "fs": 256, "caught": muse["k4"]["caughtShare"], "peopleAll": muse["k4"]["peopleAbove90"], "falsePerHour": round(reports_muse / hours_muse, 2)},
            {"key": "scalp", "people": phys["people"], "fs": 1000, "caught": labels["chew"]["shareWithReport"], "peopleAll": None, "falsePerHour": None},
            {"key": "listening", "people": lis["k4"]["people"], "fs": 500, "caught": None, "peopleAll": None, "falsePerHour": lis["k4"]["perHour"], "hours": lis["k4"]["hours"]},
        ],
        "sweep": [{"k": r["k"], "caught": r["caughtShare"], "falsePerHour": r["falsePerHour"]} for r in park["sweep"]["rows"]],
        "listening": {"perHour": lis["k4"]["perHour"], "kindsPerHour": lis["k4"]["kindsPerHour"], "medianPerson": lis["k4"]["medianPersonPerHour"], "worstPerson": lis["k4"]["worstPersonPerHour"]},
        "movement": movement,
        # False doubles against every other false report, per recording, an hour each.
        "doubles": [
            {"key": "listening", "hours": lis["k4"]["hours"], "doubles": lis["k4"]["kinds"]["double"], "others": lis["k4"]["reports"] - lis["k4"]["kinds"]["double"]},
            {"key": "around", "hours": round(hours_park, 2), "doubles": sum(v["doubles"] for v in own["falseIn"].values()), "others": reports_park - sum(v["doubles"] for v in own["falseIn"].values())},
            {"key": "headband", "hours": round(hours_muse, 2), "doubles": sum(v["doubles"] for v in muse["k4"]["falseIn"].values()), "others": reports_muse - sum(v["doubles"] for v in muse["k4"]["falseIn"].values())},
            {"key": "unannotated", "hours": phys["unlabelled"]["hours"], "doubles": phys["unlabelled"]["doubles"], "others": phys["unlabelled"]["reports"] - phys["unlabelled"]["doubles"]},
        ],
    }


def in_ear():
    e = load(os.path.join(ROOT, "earsaad.json"))
    if not e:
        return None
    out = {}
    for key in ("inear", "aroundear", "both", "scalp"):
        if key not in e:
            continue
        out[key] = {
            dec: {
                "mean": {w: r3(v) for w, v in e[key][dec]["mean"].items()},
                "control60": r3(e[key][dec]["control"]["60"]),
                "mesd": e[key][dec]["mesdMedian"],
                "perSubject60": e[key][dec]["perSubject60"],
            }
            for dec in ("linear", "learned")
        }
    return out or None


def held_out():
    runs = {os.path.basename(p)[: -len(".seed7.json")]: load(p) for p in glob.glob(os.path.join(AAD, "runs", "*.seed7.json"))}
    pick = {"standard": "a.all", "content": "g.part", "study": "g.study"}
    out = {}
    for key, tag in pick.items():
        r = runs.get(tag)
        if r:
            out[key] = {"mean": {w: r3(v) for w, v in r["mean"].items()}, "control60": r3(r["control"]["60"]), "mesd": r["mesdMedian"]}
    return out if len(out) > 1 else None


def hold():
    h = load(os.path.join(AAD, "hold_value.json"))
    if not h:
        return None

    def row(split, away=0.25):
        return next(r for r in h["splits"][split] if abs(r["away"] - away) < 1e-9)

    keys = {"face": "face", "face_hold": "face, hold", "face_dwell": "face, dwell", "EEG": "EEG", "fused": "fused", "fused_k1": "fused k1"}
    pick = lambda r, pre="": {k: (r[pre + v] if pre == "took " else r3(r[pre + v])) for k, v in keys.items()}
    mixed = row("half at the other talker")
    return {
        "away": 0.25,
        "meanLookSeconds": h["meanLookSeconds"],
        "mixed": pick(mixed),
        "other": pick(row("all at the other talker")),
        "nobody": pick(row("all at nobody")),
        "covert": pick(mixed, "covert "),
        "switchTookS": pick(mixed, "took "),
        "replay": replay(),
    }


def replay():
    """One typical person's real ten second decisions, for the page's hold replay: the median at one minute in the first final split."""
    finals = sorted(p for p in glob.glob(os.path.join(AAD, "runs", "final.seed*.json")) if re.search(r"\.seed\d+\.json$", p))
    if not finals:
        return None
    run = load(finals[0])
    acc = run["perSubject"]["60"]
    i = sorted(range(len(acc)), key=lambda k: acc[k])[len(acc) // 2]
    margins = [round(float(m), 5) for block in run["margins10"][i] for m in block]
    return {"weight": run["calibration"]["weight"], "hazard": 0.02, "kappa": 1.0, "margins": margins, "blocks": [len(b) for b in run["margins10"][i]], "person": {"accuracy60": r3(acc[i])}}


def main():
    page = {"note": "Results beyond research/aad's main analysis; see research/ext/README.md and research/aad/README.md"}
    for key, fn in (("clench", clench), ("inEar", in_ear), ("heldOut", held_out), ("hold", hold)):
        v = fn()
        if v:
            page[key] = v
    hw = load(os.path.join(AAD, "hardware.json"))
    if hw:
        page["hardware"] = hw
    sp = sorted(glob.glob(os.path.join(AAD, "runs", "*.splice.json")))
    if sp:
        page["splice"] = load(sp[-1])
    with open(OUT, "w") as f:
        json.dump(page, f, indent=1)
    print(f"[export_page] {', '.join(k for k in page if k != 'note')} -> public/research/beyond.json")


if __name__ == "__main__":
    main()
