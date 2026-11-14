"""Several independent records per variable: "confirmed by k of n" (the multi-record independent check).

Records per variable, in this order (the first is the one the site has always used and its numbers never change):
  T2M          NASA GISTEMP (thermometers and ships, 2 degree boxes), GHCN-CAMS (weather stations, 0.5 degree land air
               temperature averaged to the same 2 degree boxes by reference_more.block_mean_valid)
  PRECTOTCORR  GPCP, CMAP (rain gauges and satellites), GPCC, PREC/L (rain gauges; land only), all on GPCP's 2.5 degree boxes

A record is AVAILABLE at a box if the box is eligible (reference.eligible_mask) and the record has >= 40 valid years there.
For a site trend with sign s: n = available records, k = those whose own trend is significant (p < 0.05) with sign s,
c = those significant with the opposite sign.
  none (n = 0) | contradicted (c > k) | confirmed (MORE THAN HALF of the records: 2k > n, and k > c) | partly (k >= 1, neither of those) |
  unconfirmed (k = 0 and c = 0)
Everything is computed from the cached records (pipeline/cache); nothing is fetched.
"""
import math
import os

import numpy as np

import config
import reference as X
import reference_more as RM
import sources as S

P_SIG = 0.05

# (key, short, name, what, loader kind)
DEFS = {
    "T2M": [
        ("gistemp", "NASA GISTEMP", None, "thermometer and ship records"),
        ("ghcncams", "GHCN-CAMS", "GHCN-CAMS land 2 m air temperature, 0.5 degrees averaged to 2 degree boxes (NOAA CPC)",
         "weather stations"),
    ],
    "PRECTOTCORR": [
        ("gpcp", "GPCP", None, "rain gauges and satellites"),
        ("cmap", "CMAP", "CMAP standard precipitation, 2.5 degrees (NOAA CPC)", "rain gauges and satellites"),
        ("gpcc", "GPCC", "GPCC Full Data v2025 land gauge precipitation, 2.5 degrees (DWD)", "rain gauges"),
        ("precl", "PREC/L", "PREC/L land gauge precipitation, 2.5 degrees (NOAA CPC)", "rain gauges"),
    ],
}


def class_of(n, k, c):
    """The class of a trend confirmed by k of n records with c contradicting (the rule fixed by the task)."""
    if n <= 0:
        return "none"
    if c > k:
        return "contradicted"
    if 2 * k > n and k > c:
        return "confirmed"
    if k >= 1:
        return "partly"
    return "unconfirmed"


CLASS_CODES = {"none": 0, "confirmed": 1, "partly": 2, "unconfirmed": 3, "contradicted": 4}


def class_codes(n, k, c):
    """Vectorised class_of -> int8 codes (CLASS_CODES). n, k, c integer arrays of equal shape."""
    n, k, c = (np.asarray(a) for a in (n, k, c))
    out = np.full(n.shape, CLASS_CODES["unconfirmed"], dtype=np.int8)
    out[k >= 1] = CLASS_CODES["partly"]
    out[(2 * k > n) & (k > c)] = CLASS_CODES["confirmed"]
    out[c > k] = CLASS_CODES["contradicted"]
    out[n <= 0] = CLASS_CODES["none"]
    return out


def counts(sign, recs):
    """n, k, c arrays [nbox] for the site sign (array of -1/0/+1, [nbox] or broadcastable) over the records
    (list of dicts with slope, p, available arrays [nbox])."""
    sign = np.asarray(sign)
    n = np.zeros(sign.shape, dtype=np.int16)
    k = np.zeros(sign.shape, dtype=np.int16)
    c = np.zeros(sign.shape, dtype=np.int16)
    for r in recs:
        av = np.asarray(r["available"], dtype=bool)
        with np.errstate(invalid="ignore"):
            sig = av & (np.asarray(r["p"], dtype=np.float64) < P_SIG)
            rs = np.sign(np.asarray(r["slope"], dtype=np.float64))
            n += av
            k += sig & (rs == sign) & (sign != 0)
            c += sig & (rs == -sign) & (sign != 0)
    return n, k, c


# ---------------------------------------------------------------- the records on the variable's boxes

def _series_of(var, key):
    """[45][nbox] annual series of a record on the variable's box grid (first record: from the cached reference build)."""
    grid = X.reference_grid(var)
    lat0, dlat, nlat, lon0, dlon, nlon = grid
    if key in ("gistemp", "gpcp"):
        z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
        return z["R"]
    ann, lat, lon = S.fetch_grid(key, log=lambda *_: None)   # cached: a missing file would start a fetch, so check first
    if var == "T2M":
        a = RM.block_mean_valid(ann, lat, lon, grid)
    else:
        a = np.asarray(ann, dtype=np.float64)
        assert a.shape[1:] == (nlat, nlon)
        assert np.allclose(lat, lat0 + dlat * np.arange(nlat)) and np.allclose(lon, lon0 + dlon * np.arange(nlon)), key
    return a.reshape(a.shape[0], nlat * nlon)


def require_cache():
    for key in ("ghcncams", "cmap", "gpcc", "precl"):
        p = os.path.join(config.CACHE_DIR, f"src_{key}.npz")
        if not os.path.exists(p):
            raise FileNotFoundError(p)
    for var in X.VARS:
        p = os.path.join(config.CACHE_DIR, f"reference_{var}.npz")
        if not os.path.exists(p):
            raise FileNotFoundError(p)


_MEMO = {}


def records_for(var):
    """List of dicts {key, short, name, what, slope, p, available} (full precision arrays [nbox]) in the fixed order,
    plus the eligible mask: returns (records, eligible)."""
    if var in _MEMO:
        return _MEMO[var]
    require_cache()
    z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
    el = X.eligible_mask(var, z["used"], z["land"]) == 1
    out = []
    for i, (key, short, name, what) in enumerate(DEFS[var]):
        if i == 0:
            slope, p = np.asarray(z["refSlope"], dtype=np.float64), np.asarray(z["refP"], dtype=np.float64)
            avail = el.copy()
            name = X.SOURCES[var]["name"]
        else:
            Rr = _series_of(var, key)
            nb = Rr.shape[1]
            valid = np.isfinite(Rr).sum(0) >= X.MIN_VALID
            slope, p = np.full(nb, np.nan), np.full(nb, np.nan)
            for b in np.flatnonzero(valid):
                s, _, _, pp = X.trend_of(Rr[:, b])
                slope[b], p[b] = s, pp
            avail = el & valid
        out.append({"key": key, "short": short, "name": name, "what": what, "slope": slope, "p": p, "available": avail})
    _MEMO[var] = (out, el)
    return _MEMO[var]


# ---------------------------------------------------------------- consensus summary

def consensus(var, o_merra_slope, o_merra_p, recs, el):
    """cos(lat)-weighted shares over the eligible boxes where MERRA-2's box trend is significant: confirmed / partly /
    unconfirmed / contradicted by the rule above (the box's own MERRA-2 sign), and byCount {n: {k: share among the boxes
    with that n}}; byCountArea {n: share of the whole significant area with that n}."""
    lat0, dlat, nlat, lon0, dlon, nlon = X.reference_grid(var)
    blat = np.repeat(lat0 + dlat * np.arange(nlat), nlon)
    w = np.cos(np.radians(blat))
    ms, mp = np.asarray(o_merra_slope, dtype=np.float64), np.asarray(o_merra_p, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        sig = el & (mp < P_SIG)
    n, k, c = counts(np.sign(np.nan_to_num(ms)), recs)
    code = class_codes(n, k, c)
    sel = sig & (n >= 1)
    tot = w[sel].sum()
    sh = lambda m: float(round(w[m & sel].sum() / tot, 4))  # noqa: E731
    out = {k_: sh(code == CLASS_CODES[k_]) for k_ in ("confirmed", "partly", "unconfirmed", "contradicted")}
    out["records"] = [r["short"] for r in recs]
    out["nBoxes"] = int(sel.sum())
    by, area = {}, {}
    for nn in sorted(set(int(x) for x in n[sel])):
        m = sel & (n == nn)
        t = w[m].sum()
        by[str(nn)] = {str(kk): float(round(w[m & (k == kk)].sum() / t, 4)) for kk in range(nn + 1)}
        area[str(nn)] = float(round(t / tot, 4))
    out["byCount"] = by
    out["byCountArea"] = area
    return out


def sig4(a):
    return X._sig4(a)


def records_block(var, o):
    """The `records` list for reference/<VAR>.json and the consensus summary."""
    recs, el = records_for(var)
    block = []
    for r in recs:
        av = r["available"]
        s = np.where(av, r["slope"], np.nan)
        p = np.where(av, r["p"], np.nan)
        block.append({"short": r["short"], "name": r["name"], "what": r["what"], "refSlope": sig4(s), "refP": sig4(p),
                      "available": [int(x) for x in av]})
    return block, consensus(var, o["merraSlope"], o["merraP"], recs, el)
