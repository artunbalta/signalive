"""Finds the jaw clench(es) in a gesture clip, the way docs/ASSETS.md describes.

Frames at 540x960; the earbud tracked frame to frame as a template (so head
drift is not mistaken for jaw movement); mean absolute difference between
consecutive frames over the masseter region, sampled at the tracked offset,
and the same over the temple as a control: a clench moves the jaw more than
the temple, a movement of the head moves both.

usage: python3 measure_clench.py clip.mp4 bud_x bud_y [out_dir]
bud_x, bud_y: the earbud's position in the first frame, as fractions.
"""
import glob
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

FF = "/Users/artunbalta/Desktop/signalive/node_modules/ffmpeg-static/ffmpeg"
clip, bx, by = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
out = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "clench_frames")
os.makedirs(out, exist_ok=True)
for f in glob.glob(os.path.join(out, "f*.png")):
    os.remove(f)
subprocess.run([FF, "-loglevel", "error", "-i", clip, "-vf", "scale=540:960", os.path.join(out, "f%04d.png"), "-y"], check=True)
files = sorted(glob.glob(os.path.join(out, "f*.png")))
frames = [np.asarray(Image.open(f).convert("L"), dtype=np.float32) for f in files]
H, W = frames[0].shape
FPS = 24.0

# The template: the earbud and a little around it.
T = 36
cx, cy = int(bx * W), int(by * H)
tmpl = frames[0][cy - T:cy + T, cx - T:cx + T]


def locate(img, px, py, r=24):
    best, arg = None, (px, py)
    for dy in range(-r, r + 1, 2):
        for dx in range(-r, r + 1, 2):
            x, y = px + dx, py + dy
            patch = img[y - T:y + T, x - T:x + T]
            if patch.shape != tmpl.shape:
                continue
            d = np.mean((patch - tmpl) ** 2)
            if best is None or d < best:
                best, arg = d, (x, y)
    # refine at one pixel
    px, py = arg
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            x, y = px + dx, py + dy
            patch = img[y - T:y + T, x - T:x + T]
            if patch.shape != tmpl.shape:
                continue
            d = np.mean((patch - tmpl) ** 2)
            if d < best:
                best, arg = d, (x, y)
    return arg


pos = [(cx, cy)]
for img in frames[1:]:
    pos.append(locate(img, *pos[-1]))
pos = np.array(pos)

# The masseter: below and in front of the ear (the face looks left).
rx0, rx1 = -0.13, 0.03
ry0, ry1 = 0.07, 0.19


def series(x0, x1, y0, y1):
    """Frame to frame mean absolute difference over a box, in pixels from the tracked earbud."""
    out = [0.0]
    for i in range(1, len(frames)):
        (ax, ay), (bx_, by_) = pos[i - 1], pos[i]
        a = frames[i - 1][ay + y0:ay + y1, ax + x0:ax + x1]
        b = frames[i][by_ + y0:by_ + y1, bx_ + x0:bx_ + x1]
        n = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
        out.append(float(np.mean(np.abs(a[:n[0], :n[1]] - b[:n[0], :n[1]]))))
    out = np.array(out)
    return out / out[1:].mean()


mad = series(int(rx0 * W), int(rx1 * W), int(ry0 * H), int(ry1 * H))
temple = series(-150, -70, 10, 60)
order = np.argsort(mad)[::-1]
print(f"{len(frames)} frames, bud drift x {pos[:, 0].min()}..{pos[:, 0].max()}, y {pos[:, 1].min()}..{pos[:, 1].max()}")
print("top jaw events (frame, t, jaw and temple as multiples of their means):")
shown = []
for i in order:
    if all(abs(i - j) > 6 for j in shown):
        shown.append(i)
        verdict = "jaw" if mad[i] > temple[i] else "head"
        print(f"  frame {i:3d}  t={i / FPS:5.2f}s  jaw {mad[i]:4.2f}x  temple {temple[i]:4.2f}x  {verdict}")
    if len(shown) >= 6:
        break
np.save(os.path.join(out, "mad.npy"), mad)
# A sheet: the first frame with the region drawn, and the curve.
img = Image.open(files[0]).convert("RGB")
d = ImageDraw.Draw(img)
x, y = pos[0]
d.rectangle([x + rx0 * W, y + ry0 * H, x + rx1 * W, y + ry1 * H], outline=(255, 60, 60), width=2)
d.rectangle([x - T, y - T, x + T, y + T], outline=(60, 200, 255), width=2)
curve = Image.new("RGB", (W, 200), (20, 20, 20))
dc = ImageDraw.Draw(curve)
m = mad.max() or 1
pts = [(i * W / len(mad), 195 - 185 * v / m) for i, v in enumerate(mad)]
dc.line(pts, fill=(255, 194, 75), width=2)
for s in range(0, int(len(mad) / FPS) + 1):
    dc.line([(s * FPS * W / len(mad), 0), (s * FPS * W / len(mad), 200)], fill=(70, 70, 70))
sheet = Image.new("RGB", (W, H + 200))
sheet.paste(img, (0, 0))
sheet.paste(curve, (0, H))
sheet.save(os.path.join(out, "sheet.jpg"), quality=85)
print("sheet:", os.path.join(out, "sheet.jpg"))
