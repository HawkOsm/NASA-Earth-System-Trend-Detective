"""Trend statistics: Sen slope, Mann-Kendall test with lag-1 Hamed-Rao correction,
Sen confidence interval, Benjamini-Hochberg adjustment and plain-language verdicts."""
import math

import numpy as np
from scipy.special import erfc
from scipy.stats import rankdata

Z95 = 1.959964
KEYS = ("slope", "ci_low", "ci_high", "s", "var0", "r1", "factor", "var", "z", "p")


def _interp_sorted(sorted_vals, k):
    """Linear interpolation in a 1-D sorted array at fractional 0-based position k."""
    n = len(sorted_vals)
    k = min(max(k, 0.0), n - 1.0)
    lo = int(math.floor(k))
    hi = min(lo + 1, n - 1)
    frac = k - lo
    return sorted_vals[lo] + frac * (sorted_vals[hi] - sorted_vals[lo])


def trend_1d(y, t):
    """Scalar reference implementation. Slopes and CI are per YEAR."""
    y = np.asarray(y, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    n = len(y)
    if np.any(np.isnan(y)):
        return {k: np.nan for k in KEYS}

    # 1. pairwise slopes and Sen slope
    i, j = np.triu_indices(n, 1)
    dy = y[j] - y[i]
    slopes = np.sort(dy / (t[j] - t[i]))
    N = len(slopes)
    if N % 2 == 1:
        slope = slopes[N // 2]
    else:
        slope = (slopes[N // 2 - 1] + slopes[N // 2]) / 2.0

    # 2. Mann-Kendall S
    s = float(np.sum(np.sign(dy)))

    # 3. variance with tie correction
    _, counts = np.unique(y, return_counts=True)
    g = counts.astype(np.float64)
    var0 = (n * (n - 1) * (2 * n + 5) - np.sum(g * (g - 1) * (2 * g + 5))) / 18.0

    # 4. lag-1 Hamed-Rao correction on ranks of detrended residuals
    e = y - slope * t
    R = rankdata(e)  # average ranks for ties
    d = R - R.mean()
    den = np.sum(d * d)
    r1 = float(np.sum(d[:-1] * d[1:]) / den) if den != 0 else 0.0
    if abs(r1) > Z95 / math.sqrt(n):
        factor = 1.0 + 2.0 * (n - 3) / n * r1
    else:
        factor = 1.0
    factor = max(factor, 1.0)
    var = var0 * factor

    # 5. z and two-sided p
    if var == 0 or s == 0:
        z = 0.0
    elif s > 0:
        z = (s - 1) / math.sqrt(var)
    else:
        z = (s + 1) / math.sqrt(var)
    p = float(erfc(abs(z) / math.sqrt(2)))

    # 6. Sen confidence interval with the corrected variance
    C = Z95 * math.sqrt(var)
    ci_low = _interp_sorted(slopes, (N - C) / 2.0 - 1.0)
    ci_high = _interp_sorted(slopes, (N + C) / 2.0)

    return {
        "slope": float(slope), "ci_low": float(ci_low), "ci_high": float(ci_high),
        "s": s, "var0": float(var0), "r1": r1, "factor": float(factor), "var": float(var),
        "z": float(z), "p": p,
    }


def _trend_block(Y, t):
    """Vectorised statistics for Y of shape (n, m) with no NaNs. Returns dict of (m,) arrays."""
    n, m = Y.shape
    i, j = np.triu_indices(n, 1)
    N = len(i)

    dy = Y[j] - Y[i]                                    # (N, m)
    slopes = np.sort(dy / (t[j] - t[i])[:, None], axis=0)
    if N % 2 == 1:
        slope = slopes[N // 2]
    else:
        slope = (slopes[N // 2 - 1] + slopes[N // 2]) / 2.0

    s = np.sum(np.sign(dy), axis=0)
    del dy

    # tie term: sum over groups g(g-1)(2g+5) == sum over elements (c-1)(2c+5),
    # where c is the size of the element's own tie group.
    c = (Y[:, None, :] == Y[None, :, :]).sum(axis=1).astype(np.float64)   # (n, m)
    tie = np.sum((c - 1) * (2 * c + 5), axis=0)
    var0 = (n * (n - 1) * (2 * n + 5) - tie) / 18.0

    E = Y - slope[None, :] * t[:, None]
    less = (E[None, :, :] < E[:, None, :]).sum(axis=1)     # # of values strictly below each one
    eq = (E[None, :, :] == E[:, None, :]).sum(axis=1)      # tie group size incl. itself
    R = less + (eq + 1) / 2.0                              # average 1-based rank
    d = R - R.mean(axis=0)
    den = np.sum(d * d, axis=0)
    num = np.sum(d[:-1] * d[1:], axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        r1 = np.where(den != 0, num / np.where(den != 0, den, 1.0), 0.0)
    factor = np.where(np.abs(r1) > Z95 / math.sqrt(n), 1.0 + 2.0 * (n - 3) / n * r1, 1.0)
    factor = np.maximum(factor, 1.0)
    var = var0 * factor

    sq = np.sqrt(np.where(var > 0, var, 1.0))
    z = np.where(s > 0, (s - 1) / sq, np.where(s < 0, (s + 1) / sq, 0.0))
    z = np.where(var == 0, 0.0, z)
    p = erfc(np.abs(z) / math.sqrt(2))

    C = Z95 * np.sqrt(var)

    def interp(k):
        k = np.clip(k, 0.0, N - 1.0)
        lo = np.floor(k).astype(np.int64)
        hi = np.minimum(lo + 1, N - 1)
        frac = k - lo
        vlo = np.take_along_axis(slopes, lo[None, :], axis=0)[0]
        vhi = np.take_along_axis(slopes, hi[None, :], axis=0)[0]
        return vlo + frac * (vhi - vlo)

    ci_low = interp((N - C) / 2.0 - 1.0)
    ci_high = interp((N + C) / 2.0)
    return {"slope": slope, "ci_low": ci_low, "ci_high": ci_high, "s": s, "var0": var0,
            "r1": r1, "factor": factor, "var": var, "z": z, "p": p}


def trend_grid(arr, t, block_rows=None):
    """Vectorised trend_1d over arr of shape (n, nlat, nlon). Returns dict of (nlat, nlon) arrays."""
    arr = np.asarray(arr, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    n, nlat, nlon = arr.shape
    if block_rows is None:
        # keep the (N, cells) float64 slope array around ~100 MB
        N = n * (n - 1) // 2
        block_rows = max(1, int(1.0e8 // (N * 8 * nlon)))
    out = {k: np.full((nlat, nlon), np.nan) for k in KEYS}
    for r0 in range(0, nlat, block_rows):
        r1_ = min(nlat, r0 + block_rows)
        Y = arr[:, r0:r1_, :].reshape(n, -1)
        bad = np.any(np.isnan(Y), axis=0)
        Yc = np.where(bad[None, :], 0.0, Y)
        res = _trend_block(Yc, t)
        for k in KEYS:
            v = np.asarray(res[k], dtype=np.float64)
            v[bad] = np.nan
            out[k][r0:r1_, :] = v.reshape(r1_ - r0, nlon)
    return out


def bh_adjust(p):
    """Benjamini-Hochberg adjusted p-values over all finite entries; NaN stays NaN."""
    p = np.asarray(p, dtype=np.float64)
    q = np.full(p.shape, np.nan)
    flat = p.ravel()
    ok = np.isfinite(flat)
    pv = flat[ok]
    m = len(pv)
    if m == 0:
        return q
    order = np.argsort(pv, kind="mergesort")
    ranked = pv[order] * m / np.arange(1, m + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    ranked = np.minimum(ranked, 1.0)
    qv = np.empty(m)
    qv[order] = ranked
    qflat = q.ravel()
    qflat[ok] = qv
    return qflat.reshape(p.shape)


def _fmt_p(p):
    if p < 0.001:
        return "p < 0.001"
    return f"p = {p:.2g}"


def _fmt_rate(x):
    a = abs(x)
    return f"{a:.2f}" if a >= 0.01 or a == 0 else f"{a:.2g}"


def verdict(slope_per_decade, p, units, alpha=0.05):
    """Plain-language one-sentence verdict, always stating direction and rate."""
    if slope_per_decade > 0:
        direction = "rising"
    elif slope_per_decade < 0:
        direction = "falling"
    else:
        direction = "flat, changing"
    rate = f"{_fmt_rate(slope_per_decade)} {units} per decade"
    ptxt = _fmt_p(p)
    if p < alpha:
        return f"{direction.capitalize()} by {rate} — statistically significant ({ptxt})."
    if p < 0.10:
        return (f"Possible trend, needs more years: the best estimate is {direction} by {rate}, "
                f"but it is not yet statistically significant ({ptxt}).")
    return (f"No clear trend: the best estimate is {direction} by {rate}, "
            f"but this could be chance ({ptxt}).")
