"""Evaluation of MERRA-2 against independent observation records, bad-year detection and patching.

T2M          vs GISTEMP v4 (NASA GISS) surface temperature anomalies, 2 x 2 degree boxes
PRECTOTCORR  vs GPCP v2.3 monthly precipitation (NOAA PSL OPeNDAP), 2.5 x 2.5 degree boxes

Definitions (fixed by the task):
  R[y, b]  reference annual value = mean of its 12 months, missing if any month is missing
  M[y, b]  MERRA-2 annual value = cos(lat)-weighted mean of the full-resolution cells whose centre lies inside the box
           (lower edges inclusive), missing if any of them is missing that year (products.load_grid values)
  used     R and M both have >= 40 valid years in 1981-2025
  D[y]     T2M: (M - mean M) - (R - mean R) over common years;  rain: M - c*R, c = median(M/R) over common years with
           R >= 0.1 mm/day (fewer than 30 such years: not checked)
  D'[y]    D with its own Sen line removed (D - b*year, b = median pairwise slope of D). Without this a slow drift
           between the two records (itself the trend disagreement) inflates the MAD and hides single bad years: the
           Manila box 2020 (MERRA-2 11.66 vs GPCP 7.08 mm/day) had z = 4.07 before detrending and 8.68 after.
  z[y]     0.6745 (D' - median D') / MAD(D')   (MAD = 0: not checked)
  bad year |z| > 5 and |D' - median D'| > FLOOR (0.5 C, 1.0 mm/day)
           Benchmark with planted faults on real rainfall boxes (one year multiplied by 1+f, excess >= 1 mm/day):
           detected 21% / 63% / 90% for f = 30% / 50% / 100%; 0.12% of real box-years are flagged with nothing planted.
  agree    the two 95% confidence intervals overlap (1) or not (2); 0 = box not used

Run from the pipeline directory:
  .venv/bin/python reference.py            fetch GPCP (once), build both variables, write cache + JSON, print report
  .venv/bin/python reference.py report     print the report from the cache only
  .venv/bin/python reference.py rewrite    rewrite the JSON files from the cached npz (no rebuild), print the summaries
"""
import json
import math
import os
import struct
import sys
import time
import urllib.request

import numpy as np

import config
import products
from trendstats import trend_1d

YEARS = np.array(config.YEARS, dtype=np.float64)
NY = len(YEARS)
MIN_VALID = 40
Z_LIMIT = 5.0
FLOORS = {"T2M": 0.5, "PRECTOTCORR": 1.0}
MIN_RAIN = 0.1
MIN_RATIO_YEARS = 30
VARS = ("T2M", "PRECTOTCORR")

GISTEMP_NC = os.environ.get(
    "GISTEMP_NC",
    "/tmp/claude-1000/-home-osm-Projects-Heckathon-NASA-Earth-System-Trend-Detective/"
    "4971f1a2-7b78-4025-91e4-70c9b4ffe23b/scratchpad/refdata/gistemp1200.nc")
GISTEMP_URL = "https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz"
GPCP_DAP = "https://psl.noaa.gov/thredds/dodsC/Datasets/gpcp/precip.mon.mean.nc"
GPCP_NPY = os.path.join(config.CACHE_DIR, "gpcp_monthly.npy")
OUT_DIR = os.path.join(config.WEB_DATA_DIR, "reference")

SOURCES = {
    "T2M": {"name": "GISTEMP v4 (NASA GISS), surface temperature anomaly", "url": GISTEMP_URL,
            "grid": "2 x 2 degrees, monthly", "short": "NASA GISTEMP", "what": "thermometer and ship records",
            "boxKm": 220,
            "note": "Over the oceans GISTEMP is sea-surface temperature, not air temperature, and it is smoothed over up "
                    "to 1200 km. Annual values need all 12 months. Compared on anomalies: only the year-to-year "
                    "differences and the trend are compared, not the absolute level."},
    "PRECTOTCORR": {"name": "GPCP v2.3 monthly precipitation (NOAA PSL)", "url": GPCP_DAP,
                    "grid": "2.5 x 2.5 degrees, monthly", "short": "GPCP", "what": "rain gauges and satellites",
                    "boxKm": 280,
                    "note": "Satellite-gauge product; an independent estimate, not the truth. Annual values need all 12 "
                            "months. MERRA-2 is compared with a ratio-scaled GPCP (c = median ratio) so a constant "
                            "bias is not counted as a bad year."},
}


def reference_grid(var):
    """(lat0, dlat, nlat, lon0, dlon, nlon) of the boxes; longitudes -180..180 ascending, lat ascending."""
    if var == "T2M":
        return -89.0, 2.0, 90, -179.0, 2.0, 180
    return -88.75, 2.5, 72, -178.75, 2.5, 144


# ---------------------------------------------------------------- reference data

def gistemp_annual(path=GISTEMP_NC):
    """[45][90][180] annual GISTEMP anomaly (deg C), lat ascending (-89..89), lon -179..179. NaN where any month is
    missing."""
    from scipy.io import netcdf_file
    f = netcdf_file(path, mmap=False)
    lat = np.array(f.variables["lat"][:], dtype=np.float64)
    lon = np.array(f.variables["lon"][:], dtype=np.float64)
    if not (lat[0] < lat[-1] and lon[0] < lon[-1]):
        raise ValueError("unexpected GISTEMP orientation")
    tv = f.variables["tempanomaly"]
    fill = int(tv._attributes["_FillValue"])
    scale = float(tv._attributes["scale_factor"])
    time_days = np.array(f.variables["time"][:], dtype=np.float64)
    raw = np.array(tv[:])
    start = int((1981 - 1880) * 12)
    n = NY * 12
    # time = days since 1800-01-01; index (year-1880)*12 is January of that year (first value 1880-01-16)
    days0 = (np.datetime64("1981-01-16") - np.datetime64("1800-01-01")).astype(int)
    if abs(time_days[start] - days0) > 1:
        raise ValueError("GISTEMP time axis is not monthly from 1880-01")
    blk = raw[start:start + n].astype(np.float64)
    if blk.shape[0] != n:
        raise ValueError("GISTEMP does not cover 2025-12")
    blk = np.where(blk == fill, np.nan, blk * scale).reshape(NY, 12, *blk.shape[1:])
    return blk.mean(axis=1)  # NaN if any month missing


def _dods_floats(blob):
    """Float32 values of the first array in a DAP2 .dods response (a Grid: array, then its maps)."""
    k = blob.index(b"\nData:\n") + len(b"\nData:\n")
    n1, n2 = struct.unpack(">II", blob[k:k + 8])
    if n1 != n2:
        raise ValueError("bad DAP array header")
    return np.frombuffer(blob[k + 8:k + 8 + 4 * n1], dtype=">f4").astype(np.float32)


def fetch_gpcp(path=GPCP_NPY, log=print):
    """[540][72][144] float32 monthly GPCP precipitation mm/day for 1981-01..2025-12, lat ascending (-88.75..88.75),
    lon 1.25..358.75. NaN = missing. Fetched once (one year per request, with retries) and cached."""
    if os.path.exists(path):
        return np.load(path)
    out = np.full((NY * 12, 72, 144), np.nan, dtype=np.float32)
    for k, year in enumerate(config.YEARS):
        i0 = (year - 1979) * 12
        url = f"{GPCP_DAP}.dods?precip.precip[{i0}:{i0 + 11}][0:71][0:143]"
        for attempt in range(6):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    blob = r.read()
                v = _dods_floats(blob)
                if v.size != 12 * 72 * 144:
                    raise ValueError(f"got {v.size} values")
                break
            except Exception as e:  # noqa: BLE001
                log(f"  {year}: attempt {attempt + 1} failed: {e}")
                time.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError(f"GPCP {year} could not be fetched")
        v = v.reshape(12, 72, 144).astype(np.float64)
        v = np.where((v > 1e30) | (v < -1e30) | (v < 0), np.nan, v)  # missing_value -9.96921E36
        out[k * 12:(k + 1) * 12] = v
    os.makedirs(os.path.dirname(path), exist_ok=True)
    np.save(path, out)
    return out


def gpcp_annual(monthly=None):
    """[45][72][144] annual GPCP (mm/day), lon converted to -180..180 ascending (-178.75 .. 178.75)."""
    m = fetch_gpcp() if monthly is None else monthly
    a = m.astype(np.float64).reshape(NY, 12, 72, 144).mean(axis=1)
    return np.roll(a, 72, axis=2)  # centres 181.25.. -> -178.75.. first, then 1.25..178.75


# ---------------------------------------------------------------- MERRA-2 on boxes

def box_means(grid, lat, lon, lat0, dlat, nlat, lon0, dlon, nlon):
    """grid [years][nlat_cells][nlon_cells] -> [years][nlat][nlon]: cos(lat)-weighted mean of the cells whose centre lies in
    the box [lo, hi) of each box (lower edge inclusive); NaN for a year in which any of those cells is NaN, and for a box
    that holds no cell."""
    grid = np.asarray(grid, dtype=np.float64)
    out = np.full((grid.shape[0], nlat, nlon), np.nan)
    w_all = np.cos(np.radians(lat))
    for i in range(nlat):
        lo = lat0 - dlat / 2 + i * dlat
        i0, i1 = np.searchsorted(lat, lo, "left"), np.searchsorted(lat, lo + dlat, "left")
        if i1 <= i0:
            continue
        w = w_all[i0:i1]
        for j in range(nlon):
            lo2 = lon0 - dlon / 2 + j * dlon
            j0, j1 = np.searchsorted(lon, lo2, "left"), np.searchsorted(lon, lo2 + dlon, "left")
            if j1 <= j0:
                continue
            blk = grid[:, i0:i1, j0:j1]
            out[:, i, j] = (blk * w[None, :, None]).sum(axis=(1, 2)) / (w.sum() * (j1 - j0))
    return out


def box_land(mask, lat, lon, lat0, dlat, nlat, lon0, dlon, nlon):
    """[nlat][nlon] bool: more than half of the cells in the box are land (mask != 255). mask [lat][lon] like the grid."""
    land = np.zeros((nlat, nlon), dtype=bool)
    for i in range(nlat):
        lo = lat0 - dlat / 2 + i * dlat
        i0, i1 = np.searchsorted(lat, lo, "left"), np.searchsorted(lat, lo + dlat, "left")
        for j in range(nlon):
            lo2 = lon0 - dlon / 2 + j * dlon
            j0, j1 = np.searchsorted(lon, lo2, "left"), np.searchsorted(lon, lo2 + dlon, "left")
            blk = mask[i0:i1, j0:j1]
            land[i, j] = blk.size > 0 and (blk != 255).mean() > 0.5
    return land


# ---------------------------------------------------------------- comparison rules

def mad_z(d):
    """(z, median, MAD) of a series; z is None when MAD == 0."""
    med = float(np.median(d))
    mad = float(np.median(np.abs(d - med)))
    if mad == 0:
        return None, med, mad
    return 0.6745 * (d - med) / mad, med, mad


def difference_series(var, m, r):
    """D over the common valid years (boolean mask ok) of two annual series; None when the box is not checked."""
    ok = np.isfinite(m) & np.isfinite(r)
    if var == "T2M":
        d = (m - m[ok].mean()) - (r - r[ok].mean())
        return d, ok, np.nan
    use = ok & (r >= MIN_RAIN)
    if use.sum() < MIN_RATIO_YEARS:
        return None, ok, np.nan
    c = float(np.median(m[use] / r[use]))
    return m - c * r, ok, c


def bad_years(var, m, r):
    """(bad bool[years], D, z) for one box; D/z None when not checked. Only common valid years can be bad."""
    d, ok, _ = difference_series(var, m, r)
    bad = np.zeros(len(m), dtype=bool)
    if d is None or ok.sum() == 0:
        return bad, None, None
    tt = YEARS[ok]
    dd = d[ok]
    if len(dd) >= 3:
        i, j = np.triu_indices(len(dd), 1)
        dd = dd - np.median((dd[j] - dd[i]) / (tt[j] - tt[i])) * tt   # remove the slow drift between the two records
    z, med, _ = mad_z(dd)
    if z is None:
        return bad, d, None
    zz = np.full(len(m), np.nan)
    zz[ok] = z
    dev = np.full(len(m), np.nan)
    dev[ok] = np.abs(dd - med)
    bad = ok & (np.abs(np.nan_to_num(zz)) > Z_LIMIT) & (np.nan_to_num(dev) > FLOORS[var])
    return bad, d, zz


def ci_overlap(a_lo, a_hi, b_lo, b_hi):
    return bool(a_lo <= b_hi and b_lo <= a_hi)


def trend_of(y):
    """trend_1d of a series over its valid years -> (slope/decade, lo, hi, p) or NaNs."""
    ok = np.isfinite(y)
    if ok.sum() < 3:
        return (np.nan,) * 4
    t = trend_1d(y[ok], YEARS[ok])
    return t["slope"] * 10, t["ci_low"] * 10, t["ci_high"] * 10, t["p"]


def sen_residual(y, t):
    t1 = trend_1d(y, t)
    return y - t1["slope"] * t - np.median(y - t1["slope"] * t)


def detrended_corr(m, r):
    """Pearson correlation of the two series after removing each one's own Sen line, over common valid years."""
    ok = np.isfinite(m) & np.isfinite(r)
    if ok.sum() < 5:
        return np.nan
    a, b = sen_residual(m[ok], YEARS[ok]), sen_residual(r[ok], YEARS[ok])
    if a.std() == 0 or b.std() == 0:
        return np.nan
    return float(np.corrcoef(a, b)[0, 1])


# ---------------------------------------------------------------- build

def compute(var, R, M, land):
    """R, M: [years][nlat][nlon]. Returns dict of arrays (all [nbox] or [years][nbox], box = ilat * nlon + ilon)."""
    ny, nlat, nlon = R.shape
    nb = nlat * nlon
    R = R.reshape(ny, nb)
    M = M.reshape(ny, nb)
    nanb = lambda: np.full(nb, np.nan)  # noqa: E731
    o = {k: nanb() for k in ("refSlope", "refLo", "refHi", "refP", "merraSlope", "merraLo", "merraHi", "merraP",
                             "patchedSlope", "patchedLo", "patchedHi", "patchedP", "corr", "cRatio")}
    o["used"] = ((np.isfinite(R).sum(0) >= MIN_VALID) & (np.isfinite(M).sum(0) >= MIN_VALID))
    o["agree"] = np.zeros(nb, dtype=np.int8)
    o["patchedAgree"] = np.zeros(nb, dtype=np.int8)
    o["checked"] = np.zeros(nb, dtype=bool)
    o["bad"] = np.zeros((ny, nb), dtype=bool)
    o["D"] = np.full((ny, nb), np.nan)
    o["z"] = np.full((ny, nb), np.nan)
    o["land"] = land.reshape(nb)
    o["R"], o["M"] = R, M
    for b in np.flatnonzero(o["used"]):
        r, m = R[:, b], M[:, b]
        o["refSlope"][b], o["refLo"][b], o["refHi"][b], o["refP"][b] = trend_of(r)
        o["merraSlope"][b], o["merraLo"][b], o["merraHi"][b], o["merraP"][b] = trend_of(m)
        bad, d, z = bad_years(var, m, r)
        if d is not None:
            o["D"][:, b] = np.where(np.isfinite(m) & np.isfinite(r), d, np.nan)
            o["cRatio"][b] = difference_series(var, m, r)[2]
        if z is not None:
            o["z"][:, b] = z
            o["checked"][b] = True
        o["bad"][:, b] = bad
        pm = np.where(bad, np.nan, m)
        if bad.any():
            o["patchedSlope"][b], o["patchedLo"][b], o["patchedHi"][b], o["patchedP"][b] = trend_of(pm)
        else:
            for k in ("Slope", "Lo", "Hi", "P"):
                o["patched" + k][b] = o["merra" + k][b]
        o["agree"][b] = 1 if ci_overlap(o["merraLo"][b], o["merraHi"][b], o["refLo"][b], o["refHi"][b]) else 2
        o["patchedAgree"][b] = 1 if ci_overlap(o["patchedLo"][b], o["patchedHi"][b], o["refLo"][b], o["refHi"][b]) else 2
        o["corr"][b] = detrended_corr(m, r)
    return o


def _lat_lon(nlat, lat0, dlat, nlon, lon0, dlon):
    return lat0 + dlat * np.arange(nlat), lon0 + dlon * np.arange(nlon)


def load_country_mask():
    return np.fromfile(os.path.join(config.WEB_DATA_DIR, "country_mask.bin"), dtype=np.uint8).reshape(361, 576)


def build(var, log=print):
    lat0, dlat, nlat, lon0, dlon, nlon = reference_grid(var)
    grid = products.load_grid(var)
    # The stored coordinates carry rounding noise (the equator is -1.8e-13, not 0). Snap them, or a cell exactly on
    # a box edge lands in the wrong box and "lower edge inclusive" is not what actually happens.
    lat = np.round(np.load(os.path.join(config.CACHE_DIR, "lat.npy")).astype(np.float64), 6)
    lon = np.round(np.load(os.path.join(config.CACHE_DIR, "lon.npy")).astype(np.float64), 6)
    assert grid.shape == (NY, 361, 576) and lat[0] == -90 and lon[0] == -180
    R = gistemp_annual() if var == "T2M" else gpcp_annual()
    log(f"{var}: reference {R.shape}, computing MERRA-2 box means ...")
    M = box_means(grid, lat, lon, lat0, dlat, nlat, lon0, dlon, nlon)
    land = box_land(load_country_mask(), lat, lon, lat0, dlat, nlat, lon0, dlon, nlon)
    o = compute(var, R, M, land)
    np.savez_compressed(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"), years=YEARS, floor=FLOORS[var],
                        lat0=lat0, dlat=dlat, nlat=nlat, lon0=lon0, dlon=dlon, nlon=nlon, **o)
    write_json(var, o)
    return o


def _sig4(a):
    out = []
    for x in np.asarray(a, dtype=np.float64):
        out.append(None if not np.isfinite(x) else float(f"{x:.4g}"))
    return out


def eligible_mask(var, used, land, nlat=None, nlon=None):
    """[nbox] 0/1: the box can be used to check the site. T2M: used and land (over the sea GISTEMP is water temperature,
    not air temperature). Rain: used and |box centre latitude| < 60 (GPCP is weak near the poles)."""
    lat0, dlat, nlat, lon0, dlon, nlon = reference_grid(var)
    used = np.asarray(used, dtype=bool)
    if var == "T2M":
        return (used & np.asarray(land, dtype=bool)).astype(np.int8)
    blat = np.repeat(lat0 + dlat * np.arange(nlat), nlon)
    return (used & (np.abs(blat) < 60)).astype(np.int8)


def summarize(var, o):
    """cos(lat)-weighted shares over ELIGIBLE boxes where MERRA-2's box trend is significant (merraP < 0.05):
    confirmed (refP < 0.05, same sign as merraSlope), contradicted (refP < 0.05, opposite sign), unconfirmed (refP >= 0.05);
    eligibleShareOfGlobe = area of eligible boxes / area of all boxes; nBoxes = number of eligible boxes."""
    lat0, dlat, nlat, lon0, dlon, nlon = reference_grid(var)
    blat = np.repeat(lat0 + dlat * np.arange(nlat), nlon)
    w = np.cos(np.radians(blat))
    el = eligible_mask(var, o["used"], o["land"]) == 1
    ms, mp, rs, rp = (np.asarray(o[k], dtype=np.float64) for k in ("merraSlope", "merraP", "refSlope", "refP"))
    with np.errstate(invalid="ignore"):
        sig = el & (mp < 0.05)
        refsig = rp < 0.05
        same = np.sign(rs) == np.sign(ms)
        conf = sig & refsig & same
        contra = sig & refsig & ~same
        unconf = sig & (rp >= 0.05)
    tot = w[sig].sum()
    share = lambda m: float(round(w[m].sum() / tot, 4)) if tot > 0 else None  # noqa: E731
    return {"confirmed": share(conf), "contradicted": share(contra), "unconfirmed": share(unconf),
            "eligibleShareOfGlobe": float(round(w[el].sum() / w.sum(), 4)), "nBoxes": int(el.sum())}


def write_json(var, o):
    lat0, dlat, nlat, lon0, dlon, nlon = reference_grid(var)
    badyears = {}
    for b in np.flatnonzero(o["bad"].any(axis=0)):
        badyears[str(int(b))] = [int(YEARS[k]) for k in np.flatnonzero(o["bad"][:, b])]
    doc = {"source": SOURCES[var], "lat0": lat0, "dlat": dlat, "nlat": nlat, "lon0": lon0, "dlon": dlon, "nlon": nlon,
           "years": [int(y) for y in YEARS], "floor": FLOORS[var]}
    for k in ("refSlope", "refP", "merraSlope", "merraP", "patchedSlope", "patchedP", "corr"):
        doc[k] = _sig4(o[k])
    doc["agree"] = [int(x) for x in o["agree"]]
    doc["patchedAgree"] = [int(x) for x in o["patchedAgree"]]
    doc["land"] = [int(x) for x in o["land"]]
    doc["eligible"] = [int(x) for x in eligible_mask(var, o["used"], o["land"])]
    doc["summary"] = summarize(var, o)
    import reference_multi   # the other independent records (lazy: reference_multi imports this module)
    doc["records"], doc["consensus"] = reference_multi.records_block(var, o)
    doc["badYears"] = badyears
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, f"{var}.json"), "w") as f:
        json.dump(doc, f, separators=(",", ":"))


# ---------------------------------------------------------------- report

def wquant(x, w, q):
    """Weighted quantile (inverse of the weighted empirical CDF, linear between midpoints)."""
    o = np.argsort(x)
    x, w = x[o], w[o]
    c = (np.cumsum(w) - 0.5 * w) / w.sum()
    return float(np.interp(q, c, x))


def wshare(mask, w):
    return float(w[mask].sum() / w.sum()) if w.sum() > 0 else float("nan")


def components(sel, nlat, nlon):
    """4-connected groups (longitude wraps) of a [nlat][nlon] bool grid -> list of lists of (i, j)."""
    seen = np.zeros_like(sel, dtype=bool)
    groups = []
    for i0, j0 in zip(*np.nonzero(sel)):
        if seen[i0, j0]:
            continue
        stack, g = [(i0, j0)], []
        seen[i0, j0] = True
        while stack:
            i, j = stack.pop()
            g.append((i, j))
            for ni, nj in ((i - 1, j), (i + 1, j), (i, (j - 1) % nlon), (i, (j + 1) % nlon)):
                if 0 <= ni < nlat and sel[ni, nj] and not seen[ni, nj]:
                    seen[ni, nj] = True
                    stack.append((ni, nj))
        groups.append(g)
    return groups


PLACES = [("Istanbul", 41.01, 28.97), ("Cebu", 10.32, 123.89), ("Porto Velho", -8.76, -63.90),
          ("Manila", 14.6, 121.0), ("Brasilia", -15.8, -47.9)]


def box_of(var, lat, lon):
    lat0, dlat, nlat, lon0, dlon, nlon = reference_grid(var)
    i = int(math.floor((lat - (lat0 - dlat / 2)) / dlat))
    j = int(math.floor((lon - (lon0 - dlon / 2)) / dlon))
    return i * nlon + j


def f(x, n=3):
    return "nan" if x is None or not np.isfinite(x) else f"{x:.{n}f}"


def report(var, out=print):
    z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
    lat0, dlat, nlat, lon0, dlon, nlon = (float(z[k]) for k in ("lat0", "dlat", "nlat", "lon0", "dlon", "nlon"))
    nlat, nlon = int(nlat), int(nlon)
    latc = lat0 + dlat * np.arange(nlat)
    lonc = lon0 + dlon * np.arange(nlon)
    blat = np.repeat(latc, nlon)
    blon = np.tile(lonc, nlat)
    w_all = np.cos(np.radians(blat))
    unit = "C/decade" if var == "T2M" else "mm/day/decade"
    used, land, agree, pag = z["used"], z["land"], z["agree"], z["patchedAgree"]
    rs, rp, ms, mp, ps, pp = (z[k] for k in ("refSlope", "refP", "merraSlope", "merraP", "patchedSlope", "patchedP"))
    bad = z["bad"]
    nbad = bad.sum(0)
    out(f"\n{'=' * 100}\n{var}   reference: {SOURCES[var]['name']}   slopes in {unit}, area weights cos(lat)\n{'=' * 100}")
    for name, sel_all in (("LAND", land), ("OCEAN", ~land)):
        sel = used & sel_all
        n_all = int(sel_all.sum())
        out(f"\n--- {name} boxes: used {int(sel.sum())}, not used {n_all - int(sel.sum())} (of {n_all}); "
            f"checked for bad years {int((z['checked'] & sel).sum())}")
        if sel.sum() == 0:
            continue
        w = w_all[sel]
        dif = ms[sel] - rs[sel]
        out(f"slope diff MERRA-2 - reference: median {f(wquant(dif, w, .5))}  p5 {f(wquant(dif, w, .05))}  "
            f"p95 {f(wquant(dif, w, .95))}  RMSE {f(math.sqrt(float((w * dif ** 2).sum() / w.sum())))}")
        same = np.sign(ms[sel]) == np.sign(rs[sel])
        out(f"same sign {f(wshare(same, w))}   AGREE (CI overlap) {f(wshare(agree[sel] == 1, w))}")
        rsig = rp[sel] < 0.05
        msig = mp[sel] < 0.05
        both = rsig & msig & same
        out(f"reference significant (p<0.05): share of area {f(wshare(rsig, w))}; of those MERRA-2 also significant with "
            f"same sign: {f(w[both].sum() / w[rsig].sum() if rsig.any() else np.nan)}")
        only = msig & ~(rsig & same)
        out(f"MERRA-2 significant: share of area {f(wshare(msig, w))}; of those, reference not significant or opposite "
            f"sign ('MERRA-2-only'): {f(w[only].sum() / w[msig].sum() if msig.any() else np.nan)}   "
            f"(as share of all used area: {f(wshare(only, w))})")
        out(f"median year-to-year correlation (detrended): {f(wquant(z['corr'][sel][np.isfinite(z['corr'][sel])], w[np.isfinite(z['corr'][sel])], .5))}")
        # bad years
        nb = int(nbad[sel].sum())
        hasb = nbad[sel] > 0
        out(f"bad years: {nb} box-years flagged; share of used boxes with at least one {f(wshare(hasb, w))} "
            f"({int(hasb.sum())} boxes)")
        cnt = {}
        for y_i in np.nonzero(bad[:, sel].any(axis=1))[0]:
            cnt[int(YEARS[y_i])] = int(bad[y_i, sel].sum())
        top = sorted(cnt.items(), key=lambda kv: -kv[1])[:10]
        out("  10 most frequent years (year: box count): " + ", ".join(f"{y}: {c}" for y, c in top))
        idx = np.flatnonzero(sel)
        recs = []
        for yy, bb in zip(*np.nonzero(bad[:, idx])):
            b = idx[bb]
            recs.append((abs(z["D"][yy, b] - np.nanmedian(z["D"][:, b])), b, yy))
        recs.sort(key=lambda t: -t[0])
        out("  15 largest |D - median(D)|:   centre(lat,lon)   year   MERRA-2   reference   |D-med|")
        for dev, b, yy in recs[:15]:
            out(f"    ({blat[b]:7.2f},{blon[b]:8.2f})  {int(YEARS[yy])}  {f(z['M'][yy, b], 2):>8}  "
                f"{f(z['R'][yy, b], 2):>8}  {f(dev, 2):>6}")
        # patching
        out("  patching (patched MERRA-2 vs reference), before -> after:")
        for lab, ss in (("all used boxes", sel), ("boxes with a bad year", sel & (nbad > 0))):
            if ss.sum() == 0:
                out(f"    {lab}: none")
                continue
            ww = w_all[ss]
            d0, d1 = ms[ss] - rs[ss], ps[ss] - rs[ss]
            r0 = math.sqrt(float((ww * d0 ** 2).sum() / ww.sum()))
            r1 = math.sqrt(float((ww * d1 ** 2).sum() / ww.sum()))
            out(f"    {lab} (n={int(ss.sum())}): RMSE {f(r0, 4)} -> {f(r1, 4)};  AGREE share "
                f"{f(wshare(agree[ss] == 1, ww), 4)} -> {f(wshare(pag[ss] == 1, ww), 4)}")
        # disagree regions
        dis = np.zeros((nlat, nlon), dtype=bool)
        dis.ravel()[np.flatnonzero(sel & (agree == 2))] = True
        groups = components(dis, nlat, nlon)
        groups.sort(key=lambda g: -len(g))
        out("  10 largest regions of DISAGREE boxes (4-connected, longitude wraps): boxes, area share of the surface class, "
            "centre (lat, lon), mean slope diff")
        for g in groups[:10]:
            gi = np.array([a * nlon + c for a, c in g])
            ww = w_all[gi]
            clat = float((ww * blat[gi]).sum() / ww.sum())
            ang = np.radians(blon[gi])
            clon = float(np.degrees(np.arctan2((ww * np.sin(ang)).sum(), (ww * np.cos(ang)).sum())))
            out(f"    {len(g):4d} boxes  {ww.sum() / w_all[sel].sum() * 100:5.2f}%  ({clat:7.2f},{clon:8.2f})  "
                f"mean diff {f(float((ms[gi] - rs[gi]).mean()))}")
        out(f"    (total {len(groups)} regions, {int(dis.sum())} DISAGREE boxes)")
    out("\n--- places (the box that contains the point; slopes per decade, p)")
    for name, la, lo in PLACES:
        b = box_of(var, la, lo)
        yrs = [int(YEARS[k]) for k in np.flatnonzero(bad[:, b])]
        out(f"{name:12s} ({la}, {lo}) box centre ({blat[b]:.2f},{blon[b]:.2f}) {'land' if land[b] else 'ocean'} "
            f"{'used' if used[b] else 'NOT USED'}: MERRA-2 {f(ms[b])}/{f(mp[b], 4)}  ref {f(rs[b])}/{f(rp[b], 4)}  "
            f"patched {f(ps[b])}/{f(pp[b], 4)}  agree {int(agree[b])} patchedAgree {int(pag[b])}  "
            f"corr {f(z['corr'][b], 2)}  bad years {yrs}")


def main(argv):
    t0 = time.time()
    if len(argv) > 1 and argv[1] == "rewrite":
        for var in VARS:
            z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
            write_json(var, {k: z[k] for k in z.files})
            with open(os.path.join(OUT_DIR, f"{var}.json")) as fh:
                print(var, json.dumps(json.load(fh)["summary"]))
        return
    if len(argv) > 1 and argv[1] == "report":
        pass
    else:
        os.makedirs(config.CACHE_DIR, exist_ok=True)
        had = os.path.exists(GPCP_NPY)
        t = time.time()
        fetch_gpcp()
        if not had:
            print(f"GPCP fetch took {time.time() - t:.1f} s")
        for var in VARS:
            build(var)
            print(f"built {var} in {time.time() - t0:.0f} s")
    for var in VARS:
        report(var)


if __name__ == "__main__":
    main(sys.argv)
