#!/usr/bin/env python3
"""
The measured referencing table in hardware/SPEC.md, from results.json, so the
spec quotes the analysis rather than a copy of it:

    python3 research/aad/spec_table.py
"""
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
ROWS = [
    ("wired_4", "Wired: 4 per ear against one reference behind the right ear"),
    ("wireless_4", "Wireless: 4 per ear, each ear referenced to itself"),
    ("left_4", "Left earbud only: 4, referenced to itself"),
    ("right_4", "Right earbud only: 4, referenced to itself"),
]
WINDOWS = ["2", "5", "10", "30", "60", "300"]


def main():
    with open(os.path.join(ROOT, "results.json")) as f:
        configs = json.load(f)["configs"]
    head = ["Montage"] + [f"{w} s" if int(w) < 120 else f"{int(w) // 60} min" for w in WINDOWS] + ["MESD"]
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    for name, label in ROWS:
        g = configs[name]["generic"]
        cells = [f"{100 * g['mean'][w]:.1f}%" for w in WINDOWS]
        print(f"| {label} | " + " | ".join(cells) + f" | {round(g['mesdMedian'])} s |")
    print()
    print("Generic decoder (no calibration), mean over 36 people, held out. Chance is 50%.")


if __name__ == "__main__":
    main()
