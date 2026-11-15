"""Satellite check: MERRA-2 against an instrument the challenge names, over the instrument's own years.

The independent records of reference.py cover 1981-2025. The satellite instruments (GPM, MODIS, AIRS, OMI) and the
GLDAS land model start around 2000, so they cannot join that check. Here each one is compared with MERRA-2 over the
years they share:

  both on 2 degree boxes (mean of the valid cells, a box needs half of its area valid in every shared year),
  Theil-Sen slope and Mann-Kendall p of both over the shared years (trendstats.trend_grid),
  class per box:  agree          both significant (p < 0.05), same sign
                  not_confirmed  MERRA-2 significant, the instrument not
                  contradicted   both significant, opposite signs
                  instrument     the instrument significant, MERRA-2 not
                  neither        neither significant

The result is information next to the grade; it never changes a grade (the grade is about 1981-2025).

Inputs: pipeline/cache/inst_KEY.npz (pipeline/instruments/KEY.py). Output: web/public/data/instruments/VAR.json and
web/public/data/instruments/index.json.     python -m evaluation.instrument_check [VAR ...]
"""
import json
import os
import sys

import numpy as np

from core import config
from core import products
from core.trendstats import trend_grid

ALPHA = 0.05
MIN_SHARE = 0.5
LAT0, DLAT, NLAT = -89.0, 2.0, 90
LON0, DLON, NLON = -179.0, 2.0, 180
OUT_DIR = os.path.join(config.WEB_DATA_DIR, "instruments")
CLASSES = ("none", "agree", "not_confirmed", "contradicted", "instrument", "neither")

# VAR -> the instrument record. `array`: which array of the npz; `lat_limit`: boxes with |centre latitude| >= this
# are not used; `scale`: instrument value * scale = the site's units.
INSTRUMENTS = {
    "PRECTOTCORR": dict(key="gpm", short="GPM", array="annual", lat_limit=60.0, scale=1.0,
                        name="GPM IMERG precipitation (NASA), as distributed by NASA POWER",
                        what="rainfall measured from space"),
    "FRSNO": dict(key="modis_snow", short="MODIS", array="annual", lat_limit=90.0, scale=1.0,
                  name="MODIS snow cover (NASA Terra)", what="snow cover seen from space"),
    "TO3": dict(key="omi_o3", short="OMI", array="annual", lat_limit=90.0, scale=1.0,
                name="OMI total ozone (NASA Aura)", what="ozone measured from space"),
    "T2M": dict(key="airs_t", short="AIRS", array="annual", lat_limit=90.0, scale=1.0,
                name="AIRS near-surface air temperature (NASA Aqua), AIRS3STM v7.0",
                what="air temperature measured from space"),
    # GLDAS is a land-surface model driven by observations, not an instrument: the panel calls it a model check.
    "EVLAND": dict(key="gldas_et", short="GLDAS", array="annual", lat_limit=90.0, scale=1.0, label="Model check",
                   name="GLDAS-2.1 Noah evapotranspiration (NASA GLDAS)", what="NASA's land model, driven by observations"),
    # Root-zone soil moisture: GLDAS gives kg per square metre, MERRA-2 percent of saturation. The two trends are
    # compared by sign and significance; each is printed in its own units.
    "GWETROOT": dict(key="gldas_sm", short="GLDAS", array="annual", lat_limit=90.0, scale=1.0, label="Model check",
                     units="kg/m²", name="GLDAS-2.1 Noah root-zone soil moisture (NASA GLDAS)",
                     what="NASA's land model, driven by observations"),
}


def box_mean_valid(grid, lat, lon, min_share=MIN_SHARE):
    """grid [years][nlat_cells][nlon_cells] (NaN = missing) -> [years][NLAT][NLON]: cos(lat)-weighted mean of the valid
    cells whose centre lies in each box [lo, hi) (lower edge inclusive); NaN where the valid cells hold less than
    `min_share` of the box's cell area in that year."""
    grid = np.asarray(grid, dtype=np.float64)
    out = np.full((grid.shape[0], NLAT, NLON), np.nan)
    w_all = np.cos(np.radians(lat))
    for i in range(NLAT):
        lo = LAT0 - DLAT / 2 + i * DLAT
        i0, i1 = np.searchsorted(lat, lo, "left"), np.searchsorted(lat, lo + DLAT, "left")
        if i1 <= i0:
            continue
        w = np.maximum(w_all[i0:i1], 0.0)[None, :, None]
        for j in range(NLON):
            lo2 = LON0 - DLON / 2 + j * DLON
            j0, j1 = np.searchsorted(lon, lo2, "left"), np.searchsorted(lon, lo2 + DLON, "left")
            if j1 <= j0:
                continue
            blk = grid[:, i0:i1, j0:j1]
            ok = np.isfinite(blk)
            total = float(w.sum() * (j1 - j0))
            if total <= 0:
                continue
            den = (ok * w).sum(axis=(1, 2))
            num = (np.where(ok, blk, 0.0) * w).sum(axis=(1, 2))
            good = den / total >= min_share
            out[good, i, j] = num[good] / den[good]
    return out


def classify(m_slope, m_p, i_slope, i_p):
    """Class code per box (see CLASSES); 0 where either trend is missing."""
    ok = np.isfinite(m_slope) & np.isfinite(m_p) & np.isfinite(i_slope) & np.isfinite(i_p)
    m_sig, i_sig = m_p < ALPHA, i_p < ALPHA
    same = np.sign(m_slope) == np.sign(i_slope)
    cls = np.zeros(m_slope.shape, dtype=np.int8)
    cls[ok & m_sig & i_sig & same] = 1
    cls[ok & m_sig & ~i_sig] = 2
    cls[ok & m_sig & i_sig & ~same] = 3
    cls[ok & ~m_sig & i_sig] = 4
    cls[ok & ~m_sig & ~i_sig] = 5
    return cls


def _sig4(a):
    return [None if not np.isfinite(x) else float(f"{x:.4g}") for x in np.asarray(a, dtype=np.float64).ravel()]


def build(var, log=print):
    spec = INSTRUMENTS[var]
    path = os.path.join(config.CACHE_DIR, f"inst_{spec['key']}.npz")
    z = np.load(path, allow_pickle=False)
    inst = z[spec["array"]].astype(np.float64) * spec["scale"]
    iyears = z["years"].astype(int)
    ilat, ilon = z["lat"].astype(np.float64), z["lon"].astype(np.float64)
    assert inst.shape == (len(iyears), 180, 360) and ilat[0] == -89.5 and ilon[0] == -179.5, inst.shape

    grid = products.load_grid(var)
    lat = np.round(np.load(os.path.join(config.CACHE_DIR, "lat.npy")).astype(np.float64), 6)
    lon = np.round(np.load(os.path.join(config.CACHE_DIR, "lon.npy")).astype(np.float64), 6)
    myears = np.array(config.YEARS, dtype=int)
    assert grid.shape == (len(myears), 361, 576)

    # Shared years: every year both have, minus years in which the instrument has no value anywhere.
    has = np.array([np.isfinite(inst[k]).any() for k in range(len(iyears))])
    years = np.array([y for y, h in zip(iyears, has) if h and y in set(myears.tolist())], dtype=int)
    assert len(years) >= 15, f"{var}: only {len(years)} shared years"
    if not np.array_equal(years, np.arange(years[0], years[-1] + 1)):
        log(f"{var}: shared years are not consecutive: {years.tolist()}")
    I = box_mean_valid(inst[np.isin(iyears, years)], ilat, ilon)
    M = box_mean_valid(grid[np.isin(myears, years)], lat, lon)
    t = years.astype(np.float64)
    ti, tm = trend_grid(I, t), trend_grid(M, t)
    i_slope, i_p = ti["slope"] * 10.0, ti["p"]
    m_slope, m_p = tm["slope"] * 10.0, tm["p"]
    blat = np.repeat(LAT0 + DLAT * np.arange(NLAT), NLON).reshape(NLAT, NLON)
    usable = np.abs(blat) < spec["lat_limit"]
    for a in (i_slope, i_p, m_slope, m_p):
        a[~usable] = np.nan
    cls = classify(m_slope, m_p, i_slope, i_p)

    w = np.cos(np.radians(blat))
    checked = cls > 0
    m_sig = checked & (m_p < ALPHA)
    share = lambda sel, base: float(w[sel & base].sum() / w[base].sum()) if w[base].sum() > 0 else None  # noqa: E731
    both = checked
    same_sign = both & (np.sign(m_slope) == np.sign(i_slope))
    summary = {
        "nBoxes": int(checked.sum()),
        "merraSignificant": share(m_sig, checked),
        "agree": share(cls == 1, m_sig),
        "notConfirmed": share(cls == 2, m_sig),
        "contradicted": share(cls == 3, m_sig),
        "sameSign": share(same_sign, both),
    }
    out = {
        "variable": var,
        "instrument": {"short": spec["short"], "name": spec["name"], "what": spec["what"],
                       "label": spec.get("label", "Satellite check"), "units": spec.get("units")},
        "years": [int(years[0]), int(years[-1])],
        "nYears": int(len(years)),
        "lat0": LAT0, "dlat": DLAT, "nlat": NLAT, "lon0": LON0, "dlon": DLON, "nlon": NLON,
        "merraSlope": _sig4(m_slope), "merraP": _sig4(m_p),
        "instSlope": _sig4(i_slope), "instP": _sig4(i_p),
        "summary": summary,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, f"{var}.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    np.savez_compressed(os.path.join(config.CACHE_DIR, f"instcheck_{var}.npz"), years=years, I=I, M=M, cls=cls,
                        m_slope=m_slope, m_p=m_p, i_slope=i_slope, i_p=i_p)
    log(f"{var}: {spec['short']} {years[0]}-{years[-1]} ({len(years)} years), boxes checked {summary['nBoxes']}")
    log(f"  summary {json.dumps(summary)}")
    return out


PLACES = [("Istanbul", 41.01, 28.97), ("Shanghai", 31.22, 121.43), ("Porto Velho", -8.76, -63.90),
          ("Manila", 14.6, 121.0), ("Moscow", 55.75, 37.6), ("Denver", 39.7, -105.0), ("Nairobi", -1.3, 36.8),
          ("Sydney", -33.9, 151.2), ("mid-Pacific", 0.0, -150.0), ("Utqiagvik", 71.3, -156.8)]


def box_index(lat, lon):
    i = min(NLAT - 1, max(0, int(np.floor((lat - (LAT0 - DLAT / 2)) / DLAT))))
    j = int(np.floor((lon - (LON0 - DLON / 2)) / DLON)) % NLON
    return i, j


def report(var, o, log=print):
    for name, la, lo in PLACES:
        i, j = box_index(la, lo)
        k = i * NLON + j
        ms, mp, s, p = o["merraSlope"][k], o["merraP"][k], o["instSlope"][k], o["instP"][k]
        log(f"  {name:12s} box {LAT0 + i * DLAT:+.0f} {LON0 + j * DLON:+.0f}: MERRA-2 {ms} (p {mp}) | {o['instrument']['short']} {s} (p {p})")


def main(argv):
    wanted = argv or [v for v in INSTRUMENTS if os.path.exists(os.path.join(config.CACHE_DIR, f"inst_{INSTRUMENTS[v]['key']}.npz"))]
    done = []
    for var in wanted:
        o = build(var)
        report(var, o)
        done.append({"variable": var, "short": o["instrument"]["short"], "years": o["years"]})
    # index.json lists every variable that has a file (also ones built in an earlier run).
    index = []
    for var in INSTRUMENTS:
        p = os.path.join(OUT_DIR, f"{var}.json")
        if os.path.exists(p):
            with open(p) as f:
                d = json.load(f)
            index.append({"variable": var, "short": d["instrument"]["short"], "years": d["years"]})
    with open(os.path.join(OUT_DIR, "index.json"), "w") as f:
        json.dump({"instruments": index}, f, separators=(",", ":"))
    print("index:", index)


if __name__ == "__main__":
    main(sys.argv[1:])
