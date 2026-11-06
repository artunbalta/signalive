"""
A small EDF and EDF+ reader: the signals in physical units, and the EDF+
annotations (onset, duration, text), with nothing but NumPy.

    labels, rates, signals, annotations = read_edf(path)
"""
import numpy as np


def _field(raw, n, width):
    return [raw[i * width : (i + 1) * width].decode("latin-1").strip() for i in range(n)]


def read_edf(path):
    with open(path, "rb") as f:
        head = f.read(256)
        header_bytes = int(head[184:192])
        records = int(head[236:244])
        duration = float(head[244:252])
        ns = int(head[252:256])
        rest = f.read(header_bytes - 256)
        data = f.read()

    def block(offset, width):
        return _field(rest[offset * ns : (offset + width) * ns], ns, width)

    labels = block(0, 16)
    phys_min = np.array([float(v) for v in _field(rest[ns * 104 : ns * 112], ns, 8)])
    phys_max = np.array([float(v) for v in _field(rest[ns * 112 : ns * 120], ns, 8)])
    dig_min = np.array([float(v) for v in _field(rest[ns * 120 : ns * 128], ns, 8)])
    dig_max = np.array([float(v) for v in _field(rest[ns * 128 : ns * 136], ns, 8)])
    per_record = np.array([int(v) for v in _field(rest[ns * 216 : ns * 224], ns, 8)])
    total = int(per_record.sum())
    raw = np.frombuffer(data[: records * total * 2], dtype="<i2")
    if records < 0 or raw.size < records * total:
        records = raw.size // total
        raw = raw[: records * total]
    raw = raw.reshape(records, total)
    gain = (phys_max - phys_min) / np.where(dig_max - dig_min == 0, 1, dig_max - dig_min)
    signals, annotations = [], []
    start = 0
    for i in range(ns):
        n = per_record[i]
        chunk = raw[:, start : start + n]
        start += n
        if labels[i] == "EDF Annotations":
            annotations.extend(_tals(chunk.tobytes()))
            signals.append(None)
            continue
        signals.append((chunk.reshape(-1).astype(np.float64) - dig_min[i]) * gain[i] + phys_min[i])
    rates = [n / duration for n in per_record]
    return labels, rates, signals, annotations


def _tals(raw):
    """EDF+ time stamped annotation lists: +onset[\\x15duration]\\x14text\\x14...\\x00."""
    out = []
    for tal in raw.split(b"\x00"):
        if not tal or tal[:1] not in (b"+", b"-"):
            continue
        parts = tal.split(b"\x14")
        timing = parts[0].split(b"\x15")
        onset = float(timing[0])
        duration = float(timing[1]) if len(timing) > 1 and timing[1] else 0.0
        for text in parts[1:]:
            if text:
                out.append((onset, duration, text.decode("utf-8", "replace")))
    return out
