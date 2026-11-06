#!/usr/bin/env python3
"""
Runs deep3.py over a list of variants, a few at a time, and prints each one's
validation and test lines. The choice between them is made on validation
only (see deep3.py); the test numbers are logged for the record.

    python3 research/aad/search.py variants/stage_a.jsonl [parallel] [seed]
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))


def run(cfg, seed):
    path = os.path.join(ROOT, "runs", f"{cfg['tag']}.seed{seed}.json")
    if os.path.exists(path):
        return cfg["tag"], "(done before)"
    env = dict(os.environ, AAD_V3=json.dumps(cfg), AAD_SEED=str(seed), PYTHONUNBUFFERED="1")
    log = os.path.join(ROOT, "runs", "logs", f"{cfg['tag']}.seed{seed}.log")
    os.makedirs(os.path.dirname(log), exist_ok=True)
    with open(log, "w") as f:
        p = subprocess.run([sys.executable, os.path.join(ROOT, "deep3.py")], env=env, stdout=f, stderr=subprocess.STDOUT)
    last = open(log).read().strip().splitlines()[-1] if os.path.exists(log) else ""
    return cfg["tag"], last if p.returncode == 0 else f"FAILED ({p.returncode}): {last}"


def main():
    variants = [json.loads(l) for l in open(os.path.join(ROOT, sys.argv[1])) if l.strip()]
    par = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    with ThreadPoolExecutor(par) as pool:
        for tag, line in pool.map(lambda c: run(c, seed), variants):
            print(f"[search] {tag}: {line}", flush=True)


if __name__ == "__main__":
    main()
