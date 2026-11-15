"""Quality checks on a trend: is it a real change, or does it look like a flaw in the data? (evaluation layer)

One FIXED definition, implemented here (Python reference + a vectorised grid version) and mirrored in
web/src/evaluation/quality.ts, tied by tests/fixtures/quality_cases.json. Thresholds are not tunable parameters.

Input: years t (ascending) and values y after the usual missing-value handling (only the valid years of the selected
period); n = len(y). All checks need n >= 20, otherwise every flag is false and the grade is "unchecked".
`trend` is trendstats.trend_1d (slope per year, p); kind(p) is significant (p < 0.05) / possible (< 0.10) / none.

1. STEP "looks like a jump" (Pettitt change-point test + a comparison of a step model with the straight line):
   U_k = sum_{i<=k} sum_{j>k} sign(y_j - y_i), k = 0..n-2 (k = last index of the first part); k* = smallest k that
   maximises |U_k|; K = |U_k*|; pPettitt = min(1, 2 exp(-6 K^2 / (n^3 + n^2))). Both parts need >= 5 values
   (4 <= k* <= n-6). withinSlope = median of the pairwise slopes over pairs inside one part; ratio = withinSlope /
   slope (slope == 0: no flag); fit = sum|step-model residuals| / sum|line residuals| (step model: each part minus its
   own median; line: y - slope*t minus its median; denominator 0: no flag).
   STEP = pPettitt < 0.05 and ratio < 0.5 and fit < 0.85.  stepYear = t[k*+1], stepSize = median(second) - median(first).
2. ONE_YEAR "depends on one unusual year": r = y - slope*t, r -= median(r), mad = median(|r|) (0: no flag),
   z = 0.6745 r / mad; i* = first index of the largest |z|. Only if |z[i*]| > 3.5 the trend is recomputed without
   that year. ONE_YEAR = the kind changes, or the slope changes sign (a zero slope is no sign change).
3. REVERSAL "the two halves disagree": h = n // 2; trend on y[:h] and y[h:]; REVERSAL = slopes of strictly opposite
   signs and both p < 0.10.
4. END_SENSITIVE: the Sen slope without the first 5 values, or without the last 5 values, has the strictly opposite
   sign to the full slope.
Grade (only when kind is significant or possible; kind none -> "none", though ONE_YEAR is still reported):
   "doubtful": ONE_YEAR or two or more flags; "caution": exactly one of STEP, REVERSAL, END_SENSITIVE; "robust": none.
5. MANY_TESTS (Detective only): Holm adjustment over the raw p-values of the variables with data at one place; a line
   that is significant but has an adjusted p >= 0.05 is at best "caution" (holm_adjust, grade_with_many_tests).
"""
import math

import numpy as np

from core import trendstats as ts
from core.trendstats import trend_1d

MIN_YEARS = 20
MIN_PART = 5            # values needed in each part of a step
P_STEP = 0.05
RATIO_MAX = 0.5
FIT_MAX = 0.85
Z_OUTLIER = 3.5
MAD_SCALE = 0.6745
END_YEARS = 5
GRADE_CODE = {"none": 0, "robust": 1, "caution": 2, "doubtful": 3}
CODE_GRADE = {v: k for k, v in GRADE_CODE.items()}
NODATA = 255
UNCHECKED = 4           # grid grade code for a series that is too short (never exported)


def kind_of(p, alpha=0.05):
    if p < alpha:
        return "significant"
    if p < 0.10:
        return "possible"
    return "none"


def _sign(x):
    return (x > 0) - (x < 0)


def grade_of(kind, flags):
    """Grade string from the verdict kind and the four flags."""
    if kind == "none":
        return "none"
    if flags["oneYear"]:
        return "doubtful"
    k = int(flags["step"]) + int(flags["reversal"]) + int(flags["endSensitive"])
    return "doubtful" if k >= 2 else "caution" if k == 1 else "robust"


def holm_adjust(ps):
    """Holm-adjusted p-values (same order as the input): sort ascending, adj_(i) = max_{j<=i} min(1, (m-j+1) p_(j))."""
    ps = [float(x) for x in ps]
    m = len(ps)
    order = sorted(range(m), key=lambda i: (ps[i], i))
    out = [0.0] * m
    run = 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (m - rank) * ps[i]))
        out[i] = run
    return out


def grade_with_many_tests(grade, kind, p_adjusted):
    """MANY_TESTS: returns (grade, many_tests). A significant line with a Holm-adjusted p >= 0.05 is at best caution."""
    many = kind == "significant" and p_adjusted >= 0.05
    if many and grade == "robust":
        grade = "caution"
    return grade, many


def _empty(n):
    return {
        "n": n, "checked": False, "slope": None, "p": None, "kind": None,
        "kStar": None, "pettittK": None, "pPettitt": None, "withinSlope": None, "ratio": None, "fit": None,
        "stepYear": None, "stepSize": None,
        "outlierYear": None, "outlierZ": None, "slopeWithout": None, "pWithout": None, "kindWithout": None,
        "slopeFirstHalf": None, "pFirstHalf": None, "slopeSecondHalf": None, "pSecondHalf": None,
        "slopeNoFirst": None, "slopeNoLast": None, "endSide": None,
        "flags": {"step": False, "oneYear": False, "reversal": False, "endSensitive": False},
        "grade": "unchecked",
    }


def quality_1d(y, t):
    """Reference implementation. Returns a JSON-able dict with every intermediate number, the flags and the grade."""
    y = np.asarray(y, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    n = len(y)
    if np.any(np.isnan(y)):
        raise ValueError("quality_1d needs the valid years only (no NaN)")
    out = _empty(n)
    if n < MIN_YEARS:
        return out
    out["checked"] = True
    tr = trend_1d(y, t)
    slope, p = tr["slope"], tr["p"]
    kind = kind_of(p)
    out.update(slope=slope, p=p, kind=kind)
    flags = out["flags"]

    # 1. STEP. U_k by the definition, k = 0..n-2
    ii, jj = np.triu_indices(n, 1)
    U = np.array([float(np.sum(np.sign(y[k + 1:][None, :] - y[:k + 1][:, None]))) for k in range(n - 1)])
    k_star = int(np.argmax(np.abs(U)))
    K = float(abs(U[k_star]))
    p_pet = min(1.0, 2.0 * math.exp(-6.0 * K * K / (n ** 3 + n ** 2)))
    out.update(kStar=k_star, pettittK=K, pPettitt=p_pet)
    if MIN_PART - 1 <= k_star <= n - MIN_PART - 1:
        same = (jj <= k_star) | (ii > k_star)
        within = float(np.median((y[jj] - y[ii])[same] / (t[jj] - t[ii])[same]))
        m1, m2 = float(np.median(y[:k_star + 1])), float(np.median(y[k_star + 1:]))
        step_res = float(np.sum(np.abs(y[:k_star + 1] - m1)) + np.sum(np.abs(y[k_star + 1:] - m2)))
        r = y - slope * t
        line_res = float(np.sum(np.abs(r - np.median(r))))
        out.update(withinSlope=within, stepYear=int(round(t[k_star + 1])), stepSize=m2 - m1)
        if slope != 0:
            out["ratio"] = within / slope
        if line_res != 0:
            out["fit"] = step_res / line_res
        if slope != 0 and line_res != 0:
            flags["step"] = bool(p_pet < P_STEP and out["ratio"] < RATIO_MAX and out["fit"] < FIT_MAX)

    # 2. ONE_YEAR
    r = y - slope * t
    r = r - np.median(r)
    mad = float(np.median(np.abs(r)))
    if mad != 0:
        z = MAD_SCALE * r / mad
        i_star = int(np.argmax(np.abs(z)))
        if abs(z[i_star]) > Z_OUTLIER:
            keep = np.arange(n) != i_star
            tr2 = trend_1d(y[keep], t[keep])
            kind2 = kind_of(tr2["p"])
            out.update(outlierYear=int(round(t[i_star])), outlierZ=float(z[i_star]), slopeWithout=tr2["slope"],
                       pWithout=tr2["p"], kindWithout=kind2)
            flags["oneYear"] = bool(kind2 != kind or _sign(tr2["slope"]) * _sign(slope) < 0)

    # 3. REVERSAL
    h = n // 2
    a, b = trend_1d(y[:h], t[:h]), trend_1d(y[h:], t[h:])
    out.update(slopeFirstHalf=a["slope"], pFirstHalf=a["p"], slopeSecondHalf=b["slope"], pSecondHalf=b["p"])
    flags["reversal"] = bool(_sign(a["slope"]) * _sign(b["slope"]) < 0 and a["p"] < 0.10 and b["p"] < 0.10)

    # 4. END_SENSITIVE
    s_first = trend_1d(y[END_YEARS:], t[END_YEARS:])["slope"]
    s_last = trend_1d(y[:-END_YEARS], t[:-END_YEARS])["slope"]
    out.update(slopeNoFirst=s_first, slopeNoLast=s_last)
    flip_first = _sign(s_first) * _sign(slope) < 0
    flip_last = _sign(s_last) * _sign(slope) < 0
    flags["endSensitive"] = bool(flip_first or flip_last)
    if flags["endSensitive"]:
        out["endSide"] = "both" if (flip_first and flip_last) else "first" if flip_first else "last"

    out["grade"] = grade_of(kind, flags)
    return out


# ---- the grid version ------------------------------------------------------------------------------------------------

def _trend_cols(Y, t):
    """(slope, p) of trendstats._trend_block for Y (n, m) without NaN, in column chunks that keep memory small."""
    n, m = Y.shape
    N = n * (n - 1) // 2
    step = max(500, int(8.0e7 // (N * 8)))
    slope, p = np.empty(m), np.empty(m)
    for c0 in range(0, m, step):
        res = ts._trend_block(Y[:, c0:c0 + step], t)
        slope[c0:c0 + step] = res["slope"]
        p[c0:c0 + step] = res["p"]
    return slope, p


def _kind_code(p):
    return np.where(p < 0.05, 2, np.where(p < 0.10, 1, 0))


def _quality_block(Y, t):
    """Y (n, m) with no NaN. Returns a dict of (m,) arrays (see quality_grid)."""
    n, m = Y.shape
    ar = np.arange(m)
    nan = np.full(m, np.nan)
    slope, p = _trend_cols(Y, t)
    kind = _kind_code(p)

    # 1. STEP: U_k = U_{k-1} + sum_{j>k} sign(y_j - y_k) - sum_{i<k} sign(y_k - y_i)  (integers, so exact)
    U = np.zeros((n - 1, m))
    acc = np.zeros(m)
    for k in range(n - 1):
        acc = acc + np.sign(Y[k + 1:] - Y[k]).sum(axis=0)
        if k > 0:
            acc = acc - np.sign(Y[k] - Y[:k]).sum(axis=0)
        U[k] = acc
    absU = np.abs(U)
    kstar = np.argmax(absU, axis=0)
    K = absU[kstar, ar]
    p_pet = np.minimum(1.0, 2.0 * np.exp(-6.0 * K * K / (n ** 3 + n ** 2)))
    within, step_size, fit_num = nan.copy(), nan.copy(), nan.copy()
    step_year = np.zeros(m, dtype=np.int64)
    ii, jj = np.triu_indices(n, 1)
    R = Y - slope[None, :] * t[:, None]
    R0 = R - np.median(R, axis=0)[None, :]
    line_res = np.abs(R0).sum(axis=0)
    for k in range(MIN_PART - 1, n - MIN_PART):
        idx = np.nonzero(kstar == k)[0]
        if len(idx) == 0:
            continue
        same = (jj <= k) | (ii > k)
        Yk = Y[:, idx]
        sl = (Yk[jj[same]] - Yk[ii[same]]) / (t[jj[same]] - t[ii[same]])[:, None]
        within[idx] = np.median(sl, axis=0)
        m1 = np.median(Yk[:k + 1], axis=0)
        m2 = np.median(Yk[k + 1:], axis=0)
        fit_num[idx] = np.abs(Yk[:k + 1] - m1[None, :]).sum(axis=0) + np.abs(Yk[k + 1:] - m2[None, :]).sum(axis=0)
        step_size[idx] = m2 - m1
        step_year[idx] = int(round(t[k + 1]))
    valid_k = (kstar >= MIN_PART - 1) & (kstar <= n - MIN_PART - 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(valid_k & (slope != 0), within / np.where(slope != 0, slope, 1.0), np.nan)
        fit = np.where(valid_k & (line_res != 0), fit_num / np.where(line_res != 0, line_res, 1.0), np.nan)
    step = valid_k & (slope != 0) & (line_res != 0) & (p_pet < P_STEP) & (ratio < RATIO_MAX) & (fit < FIT_MAX)

    # 2. ONE_YEAR
    mad = np.median(np.abs(R0), axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        z = MAD_SCALE * R0 / np.where(mad != 0, mad, 1.0)[None, :]
    i_star = np.argmax(np.abs(z), axis=0)
    zmax = z[i_star, ar]
    cand = (mad != 0) & (np.abs(zmax) > Z_OUTLIER)
    slope_wo, p_wo = nan.copy(), nan.copy()
    out_year = np.zeros(m, dtype=np.int64)
    one = np.zeros(m, dtype=bool)
    for i in np.unique(i_star[cand]):
        idx = np.nonzero(cand & (i_star == i))[0]
        keep = np.arange(n) != i
        s2, p2 = _trend_cols(Y[keep][:, idx], t[keep])
        slope_wo[idx], p_wo[idx] = s2, p2
        out_year[idx] = int(round(t[i]))
        one[idx] = (_kind_code(p2) != kind[idx]) | (np.sign(s2) * np.sign(slope[idx]) < 0)
    outlier_z = np.where(cand, zmax, np.nan)

    # 3. REVERSAL
    h = n // 2
    s_a, p_a = _trend_cols(Y[:h], t[:h])
    s_b, p_b = _trend_cols(Y[h:], t[h:])
    reversal = (np.sign(s_a) * np.sign(s_b) < 0) & (p_a < 0.10) & (p_b < 0.10)

    # 4. END_SENSITIVE
    s_nf, _ = _trend_cols(Y[END_YEARS:], t[END_YEARS:])
    s_nl, _ = _trend_cols(Y[:-END_YEARS], t[:-END_YEARS])
    end = (np.sign(s_nf) * np.sign(slope) < 0) | (np.sign(s_nl) * np.sign(slope) < 0)

    nf = step.astype(int) + reversal.astype(int) + end.astype(int)
    grade = np.where(kind == 0, 0, np.where(one, 3, np.where(nf >= 2, 3, np.where(nf == 1, 2, 1))))
    return {
        "slope": slope, "p": p, "kind": kind, "pPettitt": p_pet, "kStar": kstar, "pettittK": K,
        "withinSlope": within, "ratio": ratio, "fit": fit, "stepSize": step_size, "stepYear": step_year,
        "outlierYear": out_year, "outlierZ": outlier_z, "slopeWithout": slope_wo, "pWithout": p_wo,
        "slopeFirstHalf": s_a, "pFirstHalf": p_a, "slopeSecondHalf": s_b, "pSecondHalf": p_b,
        "slopeNoFirst": s_nf, "slopeNoLast": s_nl,
        "step": step, "oneYear": one, "reversal": reversal, "endSensitive": end, "grade": grade.astype(np.uint8),
    }


def quality_cols(Y, t):
    """quality for the columns of Y (n, m) with no NaN (many series at once); dict of (m,) arrays."""
    Y = np.asarray(Y, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    n, m = Y.shape
    if n < MIN_YEARS:
        z = np.zeros(m, dtype=bool)
        return {"step": z, "oneYear": z.copy(), "reversal": z.copy(), "endSensitive": z.copy(),
                "grade": np.full(m, UNCHECKED, dtype=np.uint8)}
    parts = [_quality_block(Y[:, c0:c0 + 12000], t) for c0 in range(0, m, 12000)]
    if not parts:
        return _quality_block(Y, t) if m else {}
    return {k: np.concatenate([q[k] for q in parts]) for k in parts[0]}


def quality_grid(arr, t):
    """quality_1d for every cell of arr (n, nlat, nlon); NaN in any year = no data (grade NODATA = 255, flags false).
    Returns a dict of (nlat, nlon) arrays: flags (bool) step / oneYear / reversal / endSensitive, grade (uint8 0..3, 255),
    kind (0 none, 1 possible, 2 significant), stepYear / outlierYear (int, 0 = not computed) and the numbers of
    quality_1d under the same names (NaN = not computed)."""
    arr = np.asarray(arr, dtype=np.float64)
    n, nlat, nlon = arr.shape
    Y = arr.reshape(n, -1)
    ok = ~np.isnan(Y).any(axis=0)
    res = quality_cols(Y[:, ok], t)
    out = {}
    for k, v in res.items():
        fill = NODATA if k == "grade" else (False if v.dtype == bool else (0 if v.dtype.kind in "iu" else np.nan))
        full = np.full(Y.shape[1], fill, dtype=v.dtype)
        full[ok] = v
        out[k] = full.reshape(nlat, nlon)
    return out
