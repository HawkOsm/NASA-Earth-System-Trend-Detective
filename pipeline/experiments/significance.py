"""Experiment R2: which significance test should a 45-year annual trend use?

Run from the pipeline directory:   .venv/bin/python experiments/significance.py
(optional first argument: part1 | part2 | maps | check ; default = all). Writes nothing but stdout.

Tests (all two-sided, alpha = 0.05; S = Mann-Kendall statistic, var0 = tie-corrected Var(S) =
[n(n-1)(2n+5) - sum g(g-1)(2g+5)] / 18, z = (S -/+ 1)/sqrt(Var) and p = erfc(|z|/sqrt 2), exactly as trendstats.py):

 A  MK, no correction: Var = var0.                                                    (Mann 1945, Kendall 1975)
 B  CURRENT: trendstats.trend_grid, unchanged (lag-1 Hamed-Rao factor on ranks, only if the lag-1 rank
    autocorrelation of the Sen-detrended series is outside +-1.96/sqrt(n); factor 1 + 2(n-3)/n r1, never < 1).
 C  Hamed & Rao (1998, J. Hydrol. 204): ranks R of e = y - b t (b = Sen slope), rank autocorrelations
    rho_k (sample ACF about the mean) for k = 1..n-3; Var = var0 * [1 + 2/(n(n-1)(n-2)) *
    sum_{k significant} (n-k)(n-k-1)(n-k-2) rho_k], a lag k being significant when rho_k is outside the Anderson limits
    [-1 -/+ 1.96 sqrt(n-k-1)]/(n-k) used by the paper. Not clamped at 1 (the paper allows deflation); floored at 0.01
    only to keep the variance positive.
 D  Yue & Wang (2004, Water Resour. Manage. 18) effective sample size, lag-1 version (as the task asks): rho1 = lag-1
    sample ACF of the Sen-detrended VALUES (not ranks); n/n* = 1 + 2 (1 - 1/n) rho1 (Lettenmaier 1976 form of the ESS);
    Var = var0 * n/n*. Applied always, but never below 1 (n* <= n). NOTE: written from memory of the paper (no
    internet / paper available); the unclamped, all-lag form is not tested.
 D2 Yue-Wang, all-lag form (what the paper / pymannkendall actually compute, checked against the installed
    pymannkendall source): n/n* = 1 + 2 sum_{k=1}^{n-1} (1 - k/n) rho_k on the Sen-detrended values, unconditional,
    not clamped at 1 (floored at 0.01 to keep the variance positive). Added because D as specified (lag-1) is not it.
 E  Trend-free pre-whitening, Yue, Pilon, Phinney, Cavadias (2002, Hydrol. Process. 16): e = y - b t (b Sen);
    r1 = lag-1 ACF of e; y' = (e_t - r1 e_{t-1}) + b t, t = 2..n (n-1 values); plain MK (with ties) on y'.
    Applied unconditionally (also for insignificant or negative r1), as in the paper's procedure / pymannkendall.
 F  Iterative pre-whitening, Zhang et al. (2000, Water Resour. Res.) / Wang & Swail (2001, J. Climate): start b = Sen(y);
    repeat { e = y - b t; r = lag-1 ACF(e); w_t = (y_t - r y_{t-1})/(1 - r); b = Sen(w) } until |change in r| < 1e-3
    (max 10 iterations); plain MK on the final w. Written from memory of the papers (not available offline); the
    stopping rule and the 1/(1-r) rescaling are my reading of Wang & Swail. Share of series that did not converge is printed.
 G  Moving-block bootstrap of S: e = y - b t (b Sen); 400 resamples of n values made of ceil(n/L) blocks of length L
    (L = 3 and 5, block starts uniform on 0..n-L, truncated to n; the same block draws are shared by all series of a
    batch); p = (1 + #{|S*| >= |S_obs|}) / 401 where S_obs is S of the ORIGINAL series and S* of the resampled residuals.

Part 1: synthetic series with known truth. Part 2: MERRA-2 box series against the independent records (reference_*.npz).
maps: the ten full-resolution maps.
"""
import math
import os
import sys
import time

import numpy as np
from scipy.special import erfc

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from core import config  # noqa: E402
from core import products  # noqa: E402
from evaluation import reference  # noqa: E402
from core import trendstats  # noqa: E402

YEARS = np.array(config.YEARS, dtype=np.float64)
N = len(YEARS)
Z95 = 1.959964
TESTS = ["A", "B", "C", "D", "D2", "E", "F", "G3", "G5"]
NAMES = {"A": "A  MK, no correction", "B": "B  current (lag-1 HR)", "C": "C  Hamed-Rao all lags",
         "D": "D  Yue-Wang ESS lag-1", "D2": "D2 Yue-Wang ESS all lags", "E": "E  TFPW", "F": "F  iterative PW", "G3": "G3 block bootstrap L=3",
         "G5": "G5 block bootstrap L=5"}
NBOOT = 400
GMAX = 5000   # part 1: block bootstrap on this many of the series of each batch (all of them)
_PAIRS = {}
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)


def pairs(n):
    if n not in _PAIRS:
        _PAIRS[n] = np.triu_indices(n, 1)
    return _PAIRS[n]


# ------------------------------------------------------------------------------------------------ kernels
def sen(Y, t):
    i, j = pairs(len(t))
    return np.median((Y[j] - Y[i]) / (t[j] - t[i])[:, None], axis=0)


def mk_stats(Y):
    """S and tie-corrected var0 for each column of Y (n, m)."""
    n = Y.shape[0]
    i, j = pairs(n)
    S = np.sign(Y[j] - Y[i]).sum(axis=0)
    c = (Y[:, None, :] == Y[None, :, :]).sum(axis=1).astype(np.float64)
    var0 = (n * (n - 1) * (2 * n + 5) - np.sum((c - 1) * (2 * c + 5), axis=0)) / 18.0
    return S, var0


def p_from(S, var):
    sq = np.sqrt(np.where(var > 0, var, 1.0))
    z = np.where(S > 0, (S - 1) / sq, np.where(S < 0, (S + 1) / sq, 0.0))
    z = np.where(var > 0, z, 0.0)
    return erfc(np.abs(z) / math.sqrt(2))


def lag1(E):
    d = E - E.mean(axis=0)
    den = (d * d).sum(axis=0)
    num = (d[:-1] * d[1:]).sum(axis=0)
    return np.where(den > 0, num / np.where(den > 0, den, 1.0), 0.0)


def ranks(E):
    less = (E[None, :, :] < E[:, None, :]).sum(axis=1)
    eq = (E[None, :, :] == E[:, None, :]).sum(axis=1)
    return less + (eq + 1) / 2.0


def test_C(Y, t, slope):
    n = len(t)
    E = Y - slope[None, :] * t[:, None]
    d = ranks(E)
    d = d - d.mean(axis=0)
    den = (d * d).sum(axis=0)
    den = np.where(den > 0, den, 1.0)
    acc = np.zeros(Y.shape[1])
    for k in range(1, n - 2):
        rho = (d[:-k] * d[k:]).sum(axis=0) / den
        s = math.sqrt(n - k - 1) * Z95
        sig = (rho > (-1 + s) / (n - k)) | (rho < (-1 - s) / (n - k))
        acc += np.where(sig, (n - k) * (n - k - 1) * (n - k - 2) * rho, 0.0)
    return np.maximum(1.0 + 2.0 * acc / (n * (n - 1) * (n - 2)), 0.01)


def test_D(Y, t, slope):
    n = len(t)
    r1 = lag1(Y - slope[None, :] * t[:, None])
    return np.maximum(1.0 + 2.0 * (1.0 - 1.0 / n) * r1, 1.0)


def test_D2(Y, t, slope):
    n = len(t)
    d = Y - slope[None, :] * t[:, None]
    d = d - d.mean(axis=0)
    den = (d * d).sum(axis=0)
    den = np.where(den > 0, den, 1.0)
    acc = np.zeros(Y.shape[1])
    for k in range(1, n):
        acc += (1.0 - k / n) * (d[:-k] * d[k:]).sum(axis=0) / den
    return np.maximum(1.0 + 2.0 * acc, 0.01)


def test_E(Y, t, slope):
    E = Y - slope[None, :] * t[:, None]
    r1 = lag1(E)
    W = (E[1:] - r1[None, :] * E[:-1]) + slope[None, :] * t[1:, None]
    S, v0 = mk_stats(W)
    return p_from(S, v0)


def test_F(Y, t, slope, maxit=10, tol=1e-3):
    """Returns (p, converged mask)."""
    m = Y.shape[1]
    b = slope.copy()
    r_old = np.full(m, np.inf)
    active = np.arange(m)
    Wf = np.empty((len(t) - 1, m))
    conv = np.zeros(m, dtype=bool)
    for _ in range(maxit):
        if len(active) == 0:
            break
        Ya = Y[:, active]
        E = Ya - b[active][None, :] * t[:, None]
        r = np.clip(lag1(E), -0.99, 0.99)
        W = (Ya[1:] - r[None, :] * Ya[:-1]) / (1.0 - r)[None, :]
        Wf[:, active] = W
        b[active] = sen(W, t[1:])
        done = np.abs(r - r_old[active]) < tol
        conv[active[done]] = True
        r_old[active] = r
        active = active[~done]
    S, v0 = mk_stats(Wf)
    return p_from(S, v0), conv


def test_G(Y, t, slope, S_obs, L, rng):
    n = len(t)
    E = (Y - slope[None, :] * t[:, None]).astype(np.float32)   # float32 only for speed; ordering is what matters
    nb = -(-n // L)
    cnt = np.zeros(Y.shape[1])
    aS = np.abs(S_obs)
    for _ in range(NBOOT):
        st = rng.integers(0, n - L + 1, size=nb)
        idx = (st[:, None] + np.arange(L)[None, :]).ravel()[:n]
        Z = E[idx]
        Ss = np.zeros(Y.shape[1], dtype=np.float32)
        for r in range(n - 1):
            Ss += (Z[r + 1:] > Z[r]).sum(axis=0) - (Z[r + 1:] < Z[r]).sum(axis=0)
        cnt += np.abs(Ss) >= aS
    return (1.0 + cnt) / (NBOOT + 1.0)


def run_tests(Y, t, tests=TESTS, seed=0, conv_out=None, gmax=None):
    """Y (n, m) finite. Returns {test: p (m,)} and the Sen slope (m,)."""
    n, m = Y.shape
    out = {}
    B = trendstats.trend_grid(Y.reshape(n, 1, m), t)
    slope = B["slope"][0]
    S, v0 = B["s"][0], B["var0"][0]
    out["B"] = B["p"][0]
    if "A" in tests:
        out["A"] = p_from(S, v0)
    if "C" in tests:
        out["C"] = p_from(S, v0 * test_C(Y, t, slope))
    if "D" in tests:
        out["D"] = p_from(S, v0 * test_D(Y, t, slope))
    if "D2" in tests:
        out["D2"] = p_from(S, v0 * test_D2(Y, t, slope))
    if "E" in tests:
        out["E"] = test_E(Y, t, slope)
    if "F" in tests:
        out["F"], cv = test_F(Y, t, slope)
        if conv_out is not None:
            conv_out.append((cv.sum(), len(cv)))
    rng = np.random.default_rng(seed)
    for L in (3, 5):
        if f"G{L}" in tests:
            g = m if gmax is None else min(m, gmax)
            pg = np.full(m, np.nan)
            pg[:g] = test_G(Y[:, :g], t, slope[:g], S[:g], L, rng)
            out[f"G{L}"] = pg
    return out, slope


def run_chunked(Y, t, tests=TESTS, chunk=6000, seed=0, conv_out=None, gmax=None):
    n, m = Y.shape
    out = {k: np.empty(m) for k in tests}
    slope = np.empty(m)
    for c0 in range(0, m, chunk):
        sl = slice(c0, min(m, c0 + chunk))
        o, s = run_tests(Y[:, sl], t, tests, seed + c0, conv_out, None if gmax is None else max(0, gmax - c0))
        for k in tests:
            out[k][sl] = o[k]
        slope[sl] = s
    return out, slope


# ------------------------------------------------------------------------------------------------ Part 1
def ar1_noise(m, phi, rng, theta=0.0, burn=200):
    eps = rng.normal(size=(burn + N + 1, m))
    x = np.zeros((burn + N, m))
    prev = np.zeros(m)
    for k in range(burn + N):
        prev = phi * prev + eps[k + 1] + theta * eps[k]
        x[k] = prev
    return x[burn:], np.ones(m)


def real_cells(var, rng, ncell=2000):
    g = products.load_grid(var).reshape(N, -1)
    ok = np.isfinite(g).all(axis=0) & (g.std(axis=0) > 0)
    cols = rng.choice(np.flatnonzero(ok), size=ncell, replace=False)
    Y = g[:, cols]
    res = Y - sen(Y, YEARS)[None, :] * YEARS[:, None]
    return res - res.mean(axis=0)


def real_noise(res, m, rng):
    """phase-randomised copies of residual columns: m series, cell j % ncell"""
    cols = np.arange(m) % res.shape[1]
    R = res[:, cols]
    F = np.fft.rfft(R, axis=0)
    ph = rng.uniform(0, 2 * np.pi, size=F.shape)
    ph[0] = 0
    out = np.fft.irfft(np.abs(F) * np.exp(1j * ph), n=N, axis=0)
    r1 = np.clip(lag1(R), -0.95, 0.95)
    sig = R.std(axis=0) * np.sqrt(1 - r1 ** 2)          # AR(1) innovation sd of the source cell
    return out, sig


def adj_power(p_null, p_alt, alpha=0.05):
    p_null, p_alt = p_null[np.isfinite(p_null)], p_alt[np.isfinite(p_alt)]
    thr = np.quantile(p_null, alpha)
    below, eq = np.mean(p_null < thr), np.mean(p_null == thr)
    frac = (alpha - below) / eq if eq > 0 else 0.0
    return np.mean(p_alt < thr) + frac * np.mean(p_alt == thr)


def part1(m=5000):
    cases = [(f"AR(1) phi={phi}", ("ar", phi, 0.0)) for phi in (0.0, 0.2, 0.4, 0.6, 0.8)]
    cases.append(("ARMA(1,1) phi=0.5 theta=0.3", ("ar", 0.5, 0.3)))
    cases += [(f"real-noise {v} (phase-randomised)", ("real", v)) for v in ("T2M", "PRECTOTCORR", "WS2M")]
    rec = {}
    ramp = (YEARS - YEARS[0]) / (N - 1)
    for ci, (name, spec) in enumerate(cases):
        rng = np.random.default_rng(1000 + ci)
        if spec[0] == "ar":
            Y0, sig = ar1_noise(m, spec[1], rng, spec[2])
        else:
            Y0, sig = real_noise(real_cells(spec[1], np.random.default_rng(77 + ci)), m, rng)
        conv = []
        pn, _ = run_chunked(Y0, YEARS, seed=10 * ci, conv_out=conv, gmax=GMAX)
        pa = {}
        for k in (1, 2, 3):
            Y = Y0 + (k * sig)[None, :] * ramp[:, None]
            pa[k], _ = run_chunked(Y, YEARS, seed=10 * ci + k, gmax=GMAX)
        rec[name] = (pn, pa)
        log(f"part1 case done: {name}   (F converged {conv[0][0]}/{conv[0][1]} per first chunk)")
    # tables
    summ = {t: {"fpr": [], "adj": {1: [], 2: [], 3: []}} for t in TESTS}
    for name, (pn, pa) in rec.items():
        print(f"\n=== Part 1: {name}; {m} series per cell of the table (G3/G5: the first {GMAX}), n = {N}, alpha = 0.05 ===")
        print(f"{'test':24s} {'false-pos':>9s} {'(MC se)':>8s} | {'power':>20s} | {'size-adjusted power':>20s}")
        print(f"{'':24s} {'rate':>9s} {'':>8s} | {'1sd':>6s}{'2sd':>7s}{'3sd':>7s} | {'1sd':>6s}{'2sd':>7s}{'3sd':>7s}")
        for t in TESTS:
            pt = pn[t][np.isfinite(pn[t])]
            fp = np.mean(pt < 0.05)
            se = math.sqrt(fp * (1 - fp) / len(pt))
            pw = [np.mean(pa[k][t][np.isfinite(pa[k][t])] < 0.05) for k in (1, 2, 3)]
            ad = [adj_power(pn[t], pa[k][t]) for k in (1, 2, 3)]
            summ[t]["fpr"].append(fp)
            for k, a in zip((1, 2, 3), ad):
                summ[t]["adj"][k].append(a)
            print(f"{NAMES[t]:24s} {fp:9.4f} {se:8.4f} | {pw[0]:6.3f}{pw[1]:7.3f}{pw[2]:7.3f} | {ad[0]:6.3f}{ad[1]:7.3f}{ad[2]:7.3f}")
    print(f"\n=== Part 1 summary over all {len(rec)} noise cases (power columns = trend of 1/2/3 innovation sd over the record) ===")
    print(f"{'test':24s} {'worst FPR':>9s} {'mean FPR':>9s} {'FPR AR1 .6':>10s} {'FPR AR1 .8':>10s} | mean size-adjusted power: {'1sd':>6s}{'2sd':>7s}{'3sd':>7s}")
    for t in TESTS:
        f = summ[t]["fpr"]
        print(f"{NAMES[t]:24s} {max(f):9.4f} {np.mean(f):9.4f} {f[3]:10.4f} {f[4]:10.4f} | {'':25s}"
              f"{np.mean(summ[t]['adj'][1]):6.3f}{np.mean(summ[t]['adj'][2]):7.3f}{np.mean(summ[t]['adj'][3]):7.3f}")
    print("\n(Real-noise cases: innovation sd = sd of the source cell's residual * sqrt(1 - r1^2), r1 clipped to +-0.95; the trend\n"
          " total change is k times that. Power series are the null series plus the ramp, i.e. paired with the null.)")


# ------------------------------------------------------------------------------------------------ Part 2
def groups_by_pattern(Y):
    ok = np.isfinite(Y)
    keys = np.packbits(ok, axis=0).T
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    for g in np.unique(inv):
        cols = np.flatnonzero(inv == g)
        yield cols, ok[:, cols[0]]


def part2():
    for var in ("T2M", "PRECTOTCORR"):
        z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
        used, land = z["used"], z["land"]
        el = reference.eligible_mask(var, used, land) == 1
        lat0, dlat, nlat, lon0, dlon, nlon = reference.reference_grid(var)
        blat = np.repeat(lat0 + dlat * np.arange(nlat), nlon)
        w = np.cos(np.radians(blat))
        M = z["M"]
        idx = np.flatnonzero(el)
        p = {k: np.full(len(blat), np.nan) for k in TESTS}
        slope = np.full(len(blat), np.nan)
        Msub = M[:, idx]
        for cols, ok in groups_by_pattern(Msub):
            o, s = run_chunked(Msub[ok][:, cols], YEARS[ok], seed=5)
            for k in TESTS:
                p[k][idx[cols]] = o[k]
            slope[idx[cols]] = s
        dB = np.nanmax(np.abs(p["B"][idx] - z["merraP"][idx]))
        rp, rs = z["refP"], z["refSlope"]
        refsig = rp < 0.05
        print(f"\n=== Part 2: {var}: {el.sum()} eligible boxes ({'land' if var == 'T2M' else '|lat|<60'}), "
              f"area weights cos(lat). Reference judged by test B in every row. "
              f"(check: max |p_B recomputed - stored merraP| = {dB:.2e}) ===")
        wref = w[el & refsig].sum()
        print(f"area where the reference trend is significant (B): {wref / w[el].sum():.3f} of eligible area")
        print(f"{'test (MERRA-2 side)':24s} {'sig share':>9s} {'precision':>9s} {'recall':>8s} {'contradicted':>12s} {'unconfirmed':>12s}")
        for k in TESTS:
            sig = el & (p[k] < 0.05)
            same = np.sign(slope) == np.sign(rs)
            conf = sig & refsig & same
            contra = sig & refsig & ~same
            unconf = sig & ~refsig
            tot = w[sig].sum()
            print(f"{NAMES[k]:24s} {tot / w[el].sum():9.3f} {w[conf].sum() / tot:9.3f} {w[el & refsig & (p[k] < 0.05) & same].sum() / wref:8.3f}"
                  f" {w[contra].sum() / tot:12.3f} {w[unconf].sum() / tot:12.3f}")


# ------------------------------------------------------------------------------------------------ full maps
def maps(sample=5000):
    lat = np.round(np.load(os.path.join(config.CACHE_DIR, "lat.npy")).astype(np.float64), 6)
    wcell = np.repeat(np.cos(np.radians(lat)), 576)
    vars_ = list(config.VARIABLES.keys())
    full = {t: {"p": {}, "bh": {}, "area": {}} for t in TESTS[:7]}
    smp = {t: {} for t in TESTS}
    ncell = {}
    for var in vars_:
        g = products.load_grid(var).reshape(N, -1)
        ok = np.isfinite(g).all(axis=0)
        cols = np.flatnonzero(ok)
        ncell[var] = len(cols)
        Y = g[:, cols]
        w = wcell[cols]
        o, _ = run_chunked(Y, YEARS, tests=TESTS[:7], seed=3)
        for t in TESTS[:7]:
            pv = o[t]
            q = trendstats.bh_adjust(pv)
            full[t]["p"][var] = np.mean(pv < 0.05)
            full[t]["bh"][var] = np.mean(q < 0.05)
            full[t]["area"][var] = w[pv < 0.05].sum() / w.sum()
        rng = np.random.default_rng(11)
        sc = rng.choice(len(cols), size=min(sample, len(cols)), replace=False)
        os_, _ = run_chunked(Y[:, sc], YEARS, tests=TESTS, seed=4)
        for t in TESTS:
            smp[t][var] = np.mean(os_[t] < 0.05)
        log(f"maps done: {var} ({len(cols)} cells)")
    hdr = f"{'test':24s}" + "".join(f"{v[:9]:>10s}" for v in vars_)
    print(f"\n=== Maps: valid cells per variable: " + ", ".join(f"{v} {ncell[v]}" for v in vars_) + " ===")
    for key, title in (("p", "share of CELLS with p < 0.05 (full resolution)"),
                       ("area", "share of AREA (cos lat) with p < 0.05"),
                       ("bh", "share of CELLS significant after Benjamini-Hochberg (q < 0.05, over the variable's valid cells)")):
        print(f"\n--- {title} ---\n{hdr}")
        for t in TESTS[:7]:
            print(f"{NAMES[t]:24s}" + "".join(f"{full[t][key][v]:10.3f}" for v in vars_))
    print(f"\n--- share of cells with p < 0.05 on a random sample of {sample} valid cells per variable (A-F and G on the same cells) ---\n{hdr}")
    for t in TESTS:
        print(f"{NAMES[t]:24s}" + "".join(f"{smp[t][v]:10.3f}" for v in vars_))


# ------------------------------------------------------------------------------------------------ checks
def check():
    rng = np.random.default_rng(5)
    Y, _ = ar1_noise(400, 0.5, rng)
    Y = Y + 0.02 * (YEARS - YEARS[0])[:, None]
    o, slope = run_tests(Y, YEARS)
    S, v0 = mk_stats(Y)
    B = trendstats.trend_grid(Y.reshape(N, 1, -1), YEARS)
    print("check: own S/var0/Sen vs trendstats: max diff", np.abs(S - B["s"][0]).max(), np.abs(v0 - B["var0"][0]).max(),
          np.abs(sen(Y, YEARS) - B["slope"][0]).max())
    print("check: A == B when the lag-1 correction is not triggered: share of series with identical p:",
          np.mean(np.isclose(o["A"], o["B"])), " (series with factor==1:", np.mean(B["factor"][0] == 1.0), ")")
    try:
        import pymannkendall as mk
    except Exception as e:  # noqa: BLE001
        print("check: pymannkendall not importable:", e)
        return
    pm = {"A": mk.original_test, "C": mk.hamed_rao_modification_test, "D2": mk.yue_wang_modification_test,
          "E": mk.trend_free_pre_whitening_modification_test}
    print("check vs pymannkendall on 100 AR(1) phi=.5 series with a small trend: mean |p_mine - p_pymk|, correlation of p")
    for k, f in pm.items():
        a = np.array([f(Y[:, c]).p for c in range(100)])
        print(f"   {k}: {np.mean(np.abs(a - o[k][:100])):.4f}  corr {np.corrcoef(a, o[k][:100])[0, 1]:.4f}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("all", "check"):
        check()
    if what in ("all", "part1"):
        part1()
    if what in ("all", "part2"):
        part2()
    if what in ("all", "maps"):
        maps()
    log("total runtime")
