#!/usr/bin/env python3
"""
Every number the paper quotes, as LaTeX macros read from the result files,
so the text cannot drift from the data. A result that does not exist yet
becomes ?? in the PDF.

    python3 research/paper/make_numbers.py   # writes research/paper/numbers.tex
"""
import glob
import json
import re
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
AAD = os.path.join(ROOT, "..", "aad")
EXT = os.path.join(ROOT, "..", "ext")
macros = {}


def load(path):
    return json.load(open(path)) if os.path.exists(path) else None


def pct(v, digits=1):
    return "??" if v is None else f"{v * 100:.{digits}f}\\%"


def put(name, value):
    macros[name] = value


def main():
    res = load(os.path.join(AAD, "results.json"))
    if res:
        g = res["configs"]["wireless_4"]["generic"]["mean"]
        for w, tag in (("2", "Two"), ("10", "Ten"), ("60", "Sixty"), ("300", "FiveMin")):
            put(f"lin{tag}", pct(g[w]))
        put("linMesd", f"{res['configs']['wireless_4']['generic']['mesdMedian']:.0f}")
        per = res["configs"]["wireless_4"]["generic"]["perSubject"]["60"]
        put("linPast", str(sum(1 for v in per if v >= res["chance"]["60"] - 1e-9)))

    final = sorted(p for p in glob.glob(os.path.join(AAD, "runs", "final.seed*.json")) if re.search(r"\.seed\d+\.json$", p))
    runs = [load(p) for p in final]
    if runs:
        import numpy as np

        per = np.mean([[r["perSubject"][w] for w in ("2", "10", "60", "300", "600")] for r in runs], axis=0)
        for i, tag in enumerate(("Two", "Ten", "Sixty", "FiveMin", "TenMin")):
            put(f"nn{tag}", pct(float(np.mean(per[i]))))
        bar = 0.6667
        put("nnPast", str(int(np.sum(per[2] >= bar))))
        ctl = np.mean([[r["control"][w] for w in ("10", "60", "300")] for r in runs], axis=0)
        put("nnCtlTen", pct(ctl[0]))
        put("nnCtlSixty", pct(ctl[1]))
        put("nnMesd", f"{np.median([r['mesdMedian'] for r in runs]):.0f}")
        put("nnSplits", ", ".join(pct(r["mean"]["60"]) for r in runs))

    for key, tag in (("g.part", "Content"), ("g.study", "Study"), ("a.all", "Standard")):
        r = load(os.path.join(AAD, "runs", f"{key}.seed7.json"))
        if r:
            for w, t in (("10", "Ten"), ("60", "Sixty"), ("300", "FiveMin")):
                put(f"held{tag}{t}", pct(r["mean"][w]))
            put(f"held{tag}Ctl", pct(r["control"]["60"]))

    park = load(os.path.join(EXT, "clench_real.json"))
    if park:
        put("clAround", pct(park["ownEar"]["caughtShare"], 0))
        rows = {r["k"]: r for r in park["sweep"]["rows"]}
        put("clAroundThree", pct(rows[3]["caughtShare"], 0))
        put("clAroundThreeFalse", f"{rows[3]['falsePerHour']:.1f}")
        put("clAroundFourFalse", f"{rows[4]['falsePerHour']:.1f}")
    muse = load(os.path.join(EXT, "clench_muse.json"))
    if muse:
        put("clHeadband", pct(muse["k4"]["caughtShare"], 0))
    phys = load(os.path.join(EXT, "clench_physiomotion.json"))
    if phys:
        lab = {r["label"]: r for r in phys["byLabel"]}
        put("clSwallow", pct(lab["swallow"]["shareWithReport"], 0))
        put("clBrows", pct(lab["eyebrow"]["shareWithReport"], 0))
        put("clTongue", pct(lab["tongue"]["shareWithReport"], 1))
        put("clScalp", pct(lab["chew"]["shareWithReport"], 0))
    lis = load(os.path.join(EXT, "clench_listening.json"))
    if lis:
        k = lis["k4"]["kindsPerHour"]
        put("clListen", f"{lis['k4']['perHour']:.1f}")
        put("clListenDouble", f"{k['double']:.2f}")
        put("clListenOthers", f"{k['single'] + k['hold']:.1f}")
        put("clListenHours", f"{lis['k4']['hours']:.0f}")

    ear = load(os.path.join(EXT, "earsaad.json"))
    if ear:
        for key, tag in (("inear", "In"), ("aroundear", "Around"), ("both", "Both"), ("scalp", "Scalp")):
            if key in ear:
                for dec, d in (("linear", "Lin"), ("learned", "Nn")):
                    put(f"ear{tag}{d}", pct(ear[key][dec]["mean"]["60"]))
                    put(f"ear{tag}{d}Five", pct(ear[key][dec]["mean"]["300"]))

    bel = load(os.path.join(AAD, "belief.json"))
    if bel and "learned" in bel:
        row = next(r for r in bel["learned"]["rows"] if abs(r["hazard"] - bel["chosenHazard"]) < 1e-9)
        put("beliefSteady", pct(row["steady"]))
        put("beliefSwitch", "??" if row["switchMedian"] is None else f"{row['switchMedian']:.0f}")
    spl = sorted(glob.glob(os.path.join(AAD, "runs", "final.seed*.splice.json")))
    if spl:
        s0 = load(spl[0])["byHazard"]["0.02"]
        put("spliceMedian", "??" if s0["switchMedianS"] is None else f"{s0['switchMedianS']:.0f}")
        put("spliceFollowed", pct(s0["followed"] / max(1, s0["settledSwitches"]), 0))
        put("spliceSteady", pct(s0["steadyShare"]))
    sc = load(os.path.join(AAD, "scaling.json"))
    if sc:
        lin = sc["linear"]["sizes"]
        put("scaleLinTwo", pct(lin["2"]["mean"]["60"]))
        put("scaleLinFifteen", pct(lin["15"]["mean"]["60"]))
        put("scaleLinAll", pct(lin["35"]["mean"]["60"]))
        nn = sc.get("learned", {})
        for n, tag in (("5", "Five"), ("10", "Ten"), ("15", "Fifteen"), ("20", "Twenty"), ("25", "All")):
            if n in nn:
                vals = [v["mean"]["60"] for v in nn[n].values()]
                put(f"scaleNn{tag}", pct(sum(vals) / len(vals)))

    hv = load(os.path.join(AAD, "hold_value.json"))
    if hv:
        def row(split, away):
            return next(r for r in hv["splits"][split] if abs(r["away"] - away) < 1e-9)
        r = row("half at the other talker", 0.25)
        for k, tag in (("face", "Face"), ("face, hold", "Hold"), ("face, dwell", "HeadDwell"), ("EEG", "Eeg"), ("fused", "Fused"), ("fused, dwell", "FusedDwell")):
            put(f"hold{tag}", pct(r[k]))
            put(f"holdCovert{tag}", pct(r["covert " + k], 0))
        put("holdSwitchTook", f"{r['took fused, dwell']:.0f}")
        put("holdFusedKOne", pct(r["fused k1"]))
        put("holdCovertFusedKOne", pct(r["covert fused k1"], 0))
        put("holdSwitchTookKOne", f"{r['took fused k1']:.0f}")
        o = row("all at the other talker", 0.25)
        put("holdOtherHeadDwell", pct(o["face, dwell"]))
        put("holdOtherFused", pct(o["fused"]))
        put("holdOtherFusedDwell", pct(o["fused, dwell"]))
        z = row("all at nobody", 0.25)
        put("holdNobodyHeadDwell", pct(z["face, dwell"]))
        put("holdNobodyFusedDwell", pct(z["fused, dwell"]))

    swf = load(os.path.join(EXT, "swallow_features.json"))
    if swf:
        put("clSwallowAuc", f"{swf['heldOutAuc']:.2f}")
        put("clSwallowBest", f"{max(max(v, 1 - v) for v in swf['auc'].values()):.2f}")
        put("clSwallowKeep", pct(swf["keep95"]["swallowsRejected"], 0))
        put("clSwallowN", str(swf["swallows"]))
        put("clClenchBursts", f"{swf['clenchBursts']:,}")

    hw = load(os.path.join(AAD, "hardware.json"))
    if hw:
        def tolerance(levels, mean, clean):
            base = mean[levels.index(clean)] if clean in levels else mean[0]
            order = sorted(zip(levels, mean), key=lambda lm: abs(lm[0] - clean))
            holds, breaks, failed = None, None, False
            for lv, m in order:
                if lv == clean:
                    continue
                if breaks is None and m <= base - 0.03:
                    breaks = lv
                if not failed and m >= base - 0.01:
                    holds = lv
                else:
                    failed = True
            return holds, breaks

        shares = ("loss", "burst", "crosstalk")
        fmt = lambda v, kind: "??" if v is None else (f"{v * 100:g}\\%" if kind in shares else f"{v:g}")
        for kind in ("noise", "pink", "lsb", "rate", "skew", "loss", "burst", "artifacts", "gated", "mains", "envlag", "crosstalk"):
            if kind in hw:
                d = hw[kind]
                h, b = tolerance(d["levels"], d["mean60"], 500 if kind == "rate" else 0)
                tag = kind.capitalize()
                put(f"hw{tag}Holds", "none" if h is None else fmt(abs(h), kind))
                put(f"hw{tag}Breaks", "beyond the range" if b is None else fmt(abs(b), kind))
                put(f"hw{tag}Base", pct(d["mean60"][d["levels"].index(500 if kind == "rate" else 0)]))
                put(f"hw{tag}Worst", pct(min(d["mean60"])))
        put("hwNets", str(hw.get("networks", "")))
        def at(kind, level):
            d = hw.get(kind)
            return pct(d["mean60"][d["levels"].index(level)]) if d and level in d["levels"] else "??"
        put("hwArtifactsTwo", at("artifacts", 2))
        put("hwArtifactsTen", at("artifacts", 10))
        put("hwGatedTwo", at("gated", 2))
        put("hwGatedTen", at("gated", 10))
        put("hwGatedClean", at("gated", 0))
        put("hwGatecClean", at("gatedc", 0))
        put("hwGatecTwo", at("gatedc", 2))
        put("hwGatecTen", at("gatedc", 10))
        put("hwEnvlagLate", at("envlag", 25))
        put("hwEnvlagEarly", at("envlag", -25))

    gj = load(os.path.join(AAD, "gate.json"))
    if gj:
        put("gateOffSixty", pct(gj["mean"]["off"]["60"]))
        put("gateOnSixty", pct(gj["mean"]["on"]["60"]))
        put("gateOffFive", pct(gj["mean"]["off"]["300"]))
        put("gateOnFive", pct(gj["mean"]["on"]["300"]))
        put("gateOffTen", pct(gj["mean"]["off"]["10"]))
        put("gateOnTen", pct(gj["mean"]["on"]["10"]))
        put("gateBlanked", pct(gj["blankedShare"], 0))

    on = load(os.path.join(AAD, "runs", "final.seed7.onset.json"))
    if on:
        m = on["mean"]
        put("onsetFiveZero", pct(m["0"]["300"]))
        put("onsetFiveTen", pct(m["10"]["300"]))
        put("onsetFiveThirty", pct(m["30"]["300"]))

    names = sorted(macros)
    with open(os.path.join(ROOT, "numbers.tex"), "w") as f:
        f.write("% Written by make_numbers.py from the result files; do not edit.\n")
        for n in names:
            f.write(f"\\newcommand{{\\{n}}}{{{macros[n]}}}\n")
        # Anything the text uses that has no result yet prints as ??.
        used = set()
        for tex in glob.glob(os.path.join(ROOT, "*.tex")):
            used |= set(re.findall(r"\\((?:lin|nn|held|cl|ear|belief|splice|scale|hw|hold|onset|gate)[A-Z][A-Za-z]*)", open(tex).read()))
        for n in sorted(used - set(names)):
            f.write(f"\\providecommand{{\\{n}}}{{??}}\n")
        f.write("\\providecommand{\\missing}{??}\n")
    print(f"[make_numbers] {len(names)} numbers -> research/paper/numbers.tex")


if __name__ == "__main__":
    main()
