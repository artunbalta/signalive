"""
The signal chain and the decoder, defined once.

The earbud pipeline in lib/sense runs these same steps in the same order, and
its tests check it against numbers this file produces:

  1. causal Butterworth band pass, 1 to 9 Hz, at the electrode rate
  2. resample to 64 Hz by linear interpolation (sample k is time k / 64 s)
  3. per channel scaling to unit variance
  4. a linear backward model: the speech envelope at time t is reconstructed
     from every channel at t, t + 1/64 s, ..., t + (LAGS - 1)/64 s
  5. over a decision window, the story whose envelope correlates best with the
     reconstruction is the one being listened to

Nothing here looks at a sample from the future of the moment it outputs,
except the lags in step 4, which is why a decision needs LAGS / 64 s of EEG
after the window it decides about.
"""
import numpy as np
from scipy.signal import butter, sosfilt

FS_RAW = 500
FS = 64
BAND = (1.0, 9.0)
ORDER = 2
LAGS = 32


def bandpass_sos(fs):
    return butter(ORDER, BAND, btype="bandpass", fs=fs, output="sos")


def causal_filter(sos, x):
    return sosfilt(sos, x, axis=-1)


def decimate(x, n, fs_in=FS_RAW, fs_out=FS):
    """n samples at fs_out from x at fs_in, by linear interpolation; sample k is time k / fs_out."""
    pos = np.arange(n) * (fs_in / fs_out)
    i = np.floor(pos).astype(np.int64)
    frac = pos - i
    return x[..., i] * (1.0 - frac) + x[..., i + 1] * frac


def lagged(eeg, n, lags=LAGS):
    """Design matrix: row t holds every channel at t, t + 1, ..., t + lags - 1."""
    c = eeg.shape[0]
    out = np.empty((n, c * lags), dtype=np.float64)
    for k in range(lags):
        out[:, k::lags] = eeg[:, k : k + n].T
    return out


def montage_matrix(names, chans, mode):
    """
    Channel mixing for a montage, rows are derived channels.

    'wired': every chosen electrode against the recording's reference behind
      the right ear, which needs a wire between the ears.
    'wireless': each ear referenced to its own average, so the left and right
      earbud never share an electrical reference. With electrodes from one
      ear only, this is a single earbud on its own.
    """
    idx = {n: i for i, n in enumerate(names)}
    m = np.zeros((len(chans), len(names)))
    for r, ch in enumerate(chans):
        m[r, idx[ch]] = 1.0
    if mode == "wireless":
        for side in ("L", "R"):
            rows = [r for r, ch in enumerate(chans) if ch.startswith(side)]
            if not rows:
                continue
            if len(rows) < 2:
                # A single electrode has nothing in its own ear to refer to.
                return None
            mean = m[rows].mean(axis=0)
            for r in rows:
                m[r] -= mean
    return m


def ridge(cxx, cxs, alpha):
    d = cxx.shape[0]
    lam = alpha * np.trace(cxx) / d
    return np.linalg.solve(cxx + lam * np.eye(d), cxs)


def window_correlations(recon, s1, s2, win):
    """Pearson r of the reconstruction with each story, per non overlapping window of win samples."""
    n = (len(recon) // win) * win
    if n == 0:
        return np.empty((0, 2))
    a = recon[:n].reshape(-1, win)
    out = []
    for s in (s1, s2):
        b = s[:n].reshape(-1, win)
        am = a - a.mean(axis=1, keepdims=True)
        bm = b - b.mean(axis=1, keepdims=True)
        den = np.sqrt((am * am).sum(axis=1) * (bm * bm).sum(axis=1)) + 1e-12
        out.append((am * bm).sum(axis=1) / den)
    return np.stack(out, axis=1)
