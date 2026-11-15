"""MERRA-2 compared with additional observation records (see sources.py for the fetchers).

Same definitions as reference.py: box means of MERRA-2 (cos(lat)-weighted mean of the full-resolution cells whose centre
lies in the box), trends through trendstats (via reference.trend_of), agreement = the two 95 % confidence intervals
overlap, and the `summary` shares confirmed / not confirmed / contradicted over the area where MERRA-2's box trend is
significant (reference.summarize itself is called, with the box grid of the record temporarily swapped in).

A record finer than its comparison grid is first averaged to the boxes (cos(lat)-weighted mean of its valid cells,
a box needs at least half of its cell weight valid in a year, else the year is missing). Records finer than 2 degrees
are compared on 2 degree boxes (the GISTEMP grid), 2.5 degree records on the GPCP grid, NOAAGlobalTemp on its own
5 degree grid. A record that does not cover all of 1981-2025 is compared on its own years: MERRA-2's box series is
cut to the years the record has, and a box needs 90 % of those years valid.

Run from the pipeline directory:
  .venv/bin/python -m evaluation.reference_more fetch     fetch and cache every record (once)
  .venv/bin/python -m evaluation.reference_more report    the full comparison report (cache only)
"""
import contextlib
import math
import os
import sys

import numpy as np

from core import config
from core import products
from evaluation import reference as R
from download import sources as S

YEARS = R.YEARS
NY = R.NY
GRIDS = {"t2": R.reference_grid("T2M"), "r25": R.reference_grid("PRECTOTCORR"),
         "g5": (-87.5, 5.0, 36, -177.5, 5.0, 72), "zonal5": (-87.5, 5.0, 36, 0.0, 360.0, 1)}
PLACES = [("Istanbul", 41.01, 28.97), ("Shanghai", 31.22, 121.43), ("Porto Velho", -8.76, -63.90),
          ("Cebu", 10.32, 123.89)]


# ---------------------------------------------------------------- averaging a record to boxes

def block_mean_valid(a, lat, lon, grid, min_frac=0.5):
    """a [years][nlat][nlon] (lat ascending, lon -180..180 ascending, NaN = missing) -> [years][nbox_lat][nbox_lon].
    Box value = cos(lat)-weighted mean of the valid cells whose centre lies in the box (lower edge inclusive); missing
    when the valid cells carry less than min_frac of the box's cell weight in that year, or the box holds no cell."""
    lat0, dlat, nlat, lon0, dlon, nlon = grid
    a = np.asarray(a, dtype=np.float64)
    out = np.full((a.shape[0], nlat, nlon), np.nan)
    wlat = np.cos(np.radians(lat))
    for i in range(nlat):
        lo = lat0 - dlat / 2 + i * dlat
        i0, i1 = np.searchsorted(lat, lo, "left"), np.searchsorted(lat, lo + dlat, "left")
        if i1 <= i0:
            continue
        w = wlat[i0:i1]
        for j in range(nlon):
            lo2 = lon0 - dlon / 2 + j * dlon
            j0, j1 = np.searchsorted(lon, lo2, "left"), np.searchsorted(lon, lo2 + dlon, "left")
            if j1 <= j0:
                continue
            blk = a[:, i0:i1, j0:j1]
            ok = np.isfinite(blk)
            wm = w[None, :, None] * ok
            den = wm.sum(axis=(1, 2))
            num = (np.where(ok, blk, 0.0) * w[None, :, None]).sum(axis=(1, 2))
            full = w.sum() * (j1 - j0)
            with np.errstate(invalid="ignore", divide="ignore"):
                v = num / den
            out[:, i, j] = np.where(den >= min_frac * full - 1e-12, v, np.nan)
    return out


def merra_boxes(var, gname, log=print):
    """MERRA-2 [years][nlat][nlon] box means on grid gname (reference.box_means on products.load_grid), cached."""
    path = os.path.join(config.CACHE_DIR, f"more_M_{var}_{gname}.npy")
    if os.path.exists(path):
        return np.load(path)
    lat = np.load(os.path.join(config.CACHE_DIR, "lat.npy")).astype(np.float64)
    lon = np.load(os.path.join(config.CACHE_DIR, "lon.npy")).astype(np.float64)
    log(f"  MERRA-2 {var} box means on {gname} ...")
    M = R.box_means(products.load_grid(var), lat, lon, *GRIDS[gname])
    np.save(path, M)
    return M


def box_centres(grid):
    lat0, dlat, nlat, lon0, dlon, nlon = grid
    blat = np.repeat(lat0 + dlat * np.arange(nlat), nlon)
    blon = np.tile(lon0 + dlon * np.arange(nlon), nlat)
    return blat, blon


def land_boxes(grid):
    lat = np.load(os.path.join(config.CACHE_DIR, "lat.npy")).astype(np.float64)
    lon = np.load(os.path.join(config.CACHE_DIR, "lon.npy")).astype(np.float64)
    return R.box_land(R.load_country_mask(), lat, lon, *grid).reshape(-1)


def box_of(grid, lat, lon):
    lat0, dlat, nlat, lon0, dlon, nlon = grid
    return int(math.floor((lat - (lat0 - dlat / 2)) / dlat)) * nlon + int(math.floor((lon - (lon0 - dlon / 2)) / dlon))


# ---------------------------------------------------------------- comparison

def compare(M, Rr, min_valid=R.MIN_VALID):
    """M, Rr [years][nbox] -> dict like reference.compute's (used, trends of both, agree), without the bad-year part.
    Trends are R.trend_of (trendstats.trend_1d) of each box series over its valid years."""
    nb = M.shape[1]
    o = {k: np.full(nb, np.nan) for k in ("refSlope", "refLo", "refHi", "refP", "merraSlope", "merraLo", "merraHi", "merraP")}
    o["used"] = (np.isfinite(Rr).sum(0) >= min_valid) & (np.isfinite(M).sum(0) >= min_valid)
    o["agree"] = np.zeros(nb, dtype=np.int8)
    for b in np.flatnonzero(o["used"]):
        o["refSlope"][b], o["refLo"][b], o["refHi"][b], o["refP"][b] = R.trend_of(Rr[:, b])
        o["merraSlope"][b], o["merraLo"][b], o["merraHi"][b], o["merraP"][b] = R.trend_of(M[:, b])
        o["agree"][b] = 1 if R.ci_overlap(o["merraLo"][b], o["merraHi"][b], o["refLo"][b], o["refHi"][b]) else 2
    o["M"], o["R"] = M, Rr
    return o


def years_of(Rr):
    """Years in which a record has any valid value."""
    return np.isfinite(Rr).reshape(Rr.shape[0], -1).any(axis=1)


def run_gridded(var, rec, gname, min_frac=0.5, log=print):
    """Compare MERRA-2 variable var with gridded record rec ('ghcncams', ...) on grid gname.
    Returns dict o (see compare) plus land mask and grid name."""
    ann, lat, lon = S.fetch_grid(rec, log) if rec != "hadisst" else S.fetch_hadisst(log)
    Rr = block_mean_valid(ann, lat, lon, GRIDS[gname], min_frac)
    M = merra_boxes(var, gname, log).copy()
    ok = years_of(Rr)
    M[~ok] = np.nan  # MERRA-2 on the record's own years only
    nb = Rr.shape[1] * Rr.shape[2]
    min_valid = R.MIN_VALID if ok.all() else int(math.ceil(0.9 * ok.sum()))
    o = compare(M.reshape(NY, nb), Rr.reshape(NY, nb), min_valid)
    o["land"] = land_boxes(GRIDS[gname])
    o["grid"], o["nyears"], o["min_valid"] = gname, int(ok.sum()), min_valid
    return o


@contextlib.contextmanager
def grid_patched(grid):
    """reference.summarize / eligible_mask look the box grid up by variable name; give them ours for a moment."""
    old = R.reference_grid
    R.reference_grid = lambda var: grid
    try:
        yield
    finally:
        R.reference_grid = old


def summary(o, sel, rain=False):
    """reference.summarize over the boxes in sel (bool [nbox]). rain=True applies its |latitude| < 60 limit (the rain rule);
    otherwise every selected box counts (the temperature rule with the surface chosen by sel)."""
    oo = {k: o[k] for k in ("merraSlope", "merraP", "refSlope", "refP")}
    oo["used"] = np.asarray(o["used"], dtype=bool) & sel
    oo["land"] = np.ones(len(sel), dtype=bool)
    with grid_patched(GRIDS[o["grid"]]):
        return R.summarize("PRECTOTCORR" if rain else "T2M", oo)


def classes(o, sel, rain=False):
    """[nbox] int8: 0 = not eligible or MERRA-2 not significant, 1 confirmed, 2 not confirmed, 3 contradicted. Same rule as
    reference.summarize."""
    blat, _ = box_centres(GRIDS[o["grid"]])
    el = np.asarray(o["used"], dtype=bool) & sel
    if rain:
        el &= np.abs(blat) < 60
    ms, mp, rs, rp = (np.asarray(o[k], dtype=np.float64) for k in ("merraSlope", "merraP", "refSlope", "refP"))
    with np.errstate(invalid="ignore"):
        sig = el & (mp < 0.05)
        same = np.sign(rs) == np.sign(ms)
        c = np.zeros(len(sel), dtype=np.int8)
        c[sig & (rp >= 0.05)] = 2
        c[sig & (rp < 0.05) & same] = 1
        c[sig & (rp < 0.05) & ~same] = 3
    return c


def pair_table(oa, ob, sel, rain, w):
    """Over the boxes where MERRA-2 is significant and both records are used (same grid): confirmed by both / exactly one /
    neither, and how often the two records give the same class (confirmed / not confirmed / contradicted)."""
    ca, cb = classes(oa, sel, rain), classes(ob, sel, rain)
    both_used = (ca > 0) & (cb > 0)
    tot = w[both_used].sum()
    if tot == 0:
        return None
    sh = lambda m: w[m & both_used].sum() / tot  # noqa: E731
    return {"boxes": int(both_used.sum()), "both": sh((ca == 1) & (cb == 1)),
            "one": sh(((ca == 1) & (cb != 1)) | ((ca != 1) & (cb == 1))), "neither": sh((ca != 1) & (cb != 1)),
            "same_class": sh(ca == cb), "a_only_conf": sh((ca == 1) & (cb != 1)), "b_only_conf": sh((cb == 1) & (ca != 1))}


# ---------------------------------------------------------------- printing

f = R.f


def describe(title, o, sel, unit, rain=False, out=print):
    """Report lines for one record and one surface class (sel)."""
    grid = GRIDS[o["grid"]]
    blat, _ = box_centres(grid)
    w_all = np.cos(np.radians(blat))
    used = o["used"] & sel
    out(f"  [{title}] boxes in class {int(sel.sum())}, used {int(used.sum())}")
    if used.sum() == 0:
        return
    w = w_all[used]
    ms, mp, rs, rp = (o[k][used] for k in ("merraSlope", "merraP", "refSlope", "refP"))
    dif = ms - rs
    same = np.sign(ms) == np.sign(rs)
    out(f"    slope diff MERRA-2 - record ({unit}): median {f(R.wquant(dif, w, .5))}  p5 {f(R.wquant(dif, w, .05))}  "
        f"p95 {f(R.wquant(dif, w, .95))}  RMSE {f(math.sqrt(float((w * dif ** 2).sum() / w.sum())))}")
    out(f"    same sign {f(R.wshare(same, w))}   agree (CI overlap) {f(R.wshare(o['agree'][used] == 1, w))}   "
        f"MERRA-2 significant {f(R.wshare(mp < 0.05, w))}   record significant {f(R.wshare(rp < 0.05, w))}")
    s = summary(o, sel, rain)
    out(f"    summary over MERRA-2-significant area: confirmed {s['confirmed']}  not confirmed {s['unconfirmed']}  "
        f"contradicted {s['contradicted']}   ({s['nBoxes']} boxes)")


def places_rows(o, label, unit, out=print):
    grid = GRIDS[o["grid"]]
    blat, blon = box_centres(grid)
    for name, la, lo in PLACES:
        b = box_of(grid, la, lo)
        ok = 0 <= b < len(blat) and o["used"][b]
        out(f"    {name:12s} box ({blat[b]:7.2f},{blon[b]:8.2f}) {label:22s} "
            + (f"MERRA-2 {f(o['merraSlope'][b])} (p {f(o['merraP'][b], 4)})  record {f(o['refSlope'][b])} "
               f"(p {f(o['refP'][b], 4)})  {unit}" if ok else "record NOT USED here (no valid data)"))


def load_cached_reference(var):
    """The GISTEMP / GPCP comparison cached by reference.py, in the dict form of compare(), plus its box grid name."""
    z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
    o = {k: z[k] for k in ("used", "agree", "refSlope", "refLo", "refHi", "refP", "merraSlope", "merraLo", "merraHi",
                           "merraP", "land", "R", "M")}
    o["grid"] = "t2" if var == "T2M" else "r25"
    return o


# ---------------------------------------------------------------- hemispheric / zonal records

def rel_trend(y):
    """trend of a 1-D annual series as percent of its mean per decade: (slope, lo, hi, p), via reference.trend_of."""
    s = np.asarray(y, dtype=np.float64)
    m = np.nanmean(s)
    t = R.trend_of(s)
    return (t[0] / m * 100, t[1] / m * 100, t[2] / m * 100, t[3]) if m else (np.nan,) * 4


def cell_area_weights(lat):
    """Relative area of the full-resolution MERRA-2 cells per latitude row (cos lat), km2 scale not needed: only ratios."""
    return np.cos(np.radians(lat))


def merra_area_series(var, hemi):
    """Annual hemispheric area (million km2) covered by a percent variable (snow cover, sea ice): sum of fraction x cell
    area over the hemisphere's cells; a cell with no data (never snow / never ice, or the other surface) counts as 0."""
    g = np.nan_to_num(products.load_grid(var), nan=0.0) / 100.0
    lat = np.load(os.path.join(config.CACHE_DIR, "lat.npy")).astype(np.float64)
    dlat, dlon = 0.5, 0.625
    earth = 6371.0088
    area = (earth ** 2) * np.radians(dlat) * np.radians(dlon) * np.cos(np.radians(lat))  # km2 per cell, per row
    sel = lat >= 0 if hemi == "north" else lat < 0
    # polar caps: the pole row (|lat| = 90) is a half cell
    a = area.copy()
    a[np.abs(lat) == 90] = (earth ** 2) * np.radians(dlon) * (1 - math.cos(np.radians(dlat / 2)))
    return (g[:, sel, :] * a[sel][None, :, None]).sum(axis=(1, 2)) / 1e6


def hemi_row(name, merra, rec, out=print, unit="million km2"):
    """One line pair for a single hemispheric series: MERRA-2 and the record, level and relative trend."""
    ok = np.isfinite(rec)
    m = np.where(ok, merra, np.nan)
    tm, tr = rel_trend(m), rel_trend(rec)
    overlap = R.ci_overlap(tm[1], tm[2], tr[1], tr[2])
    sig = lambda p: "significant" if p < 0.05 else "not significant"  # noqa: E731
    out(f"  {name}: years {int(ok.sum())}; mean MERRA-2 {np.nanmean(m):.2f} vs record {np.nanmean(rec):.2f} {unit} "
        f"(ratio {np.nanmean(m) / np.nanmean(rec):.2f})")
    out(f"    trend, percent of own mean per decade: MERRA-2 {tm[0]:+.2f} [{tm[1]:+.2f}, {tm[2]:+.2f}] p={tm[3]:.4f} ({sig(tm[3])})"
        f"   record {tr[0]:+.2f} [{tr[1]:+.2f}, {tr[2]:+.2f}] p={tr[3]:.4f} ({sig(tr[3])})   CIs overlap: {overlap}; "
        f"same sign: {np.sign(tm[0]) == np.sign(tr[0])}")
    cm = np.corrcoef(*(R.sen_residual(x[ok], YEARS[ok]) for x in (m, rec)))[0, 1] if ok.sum() > 5 else np.nan
    out(f"    detrended year-to-year correlation {cm:.2f}")


# ---------------------------------------------------------------- the whole report

TEMP_RECORDS = [("ghcncams", "t2", "GHCN-CAMS 0.5 deg averaged to 2 deg boxes")]
RAIN_RECORDS = [("gpcc", "GPCC v2025"), ("cmap", "CMAP standard"), ("precl", "PREC/L")]


def fetch_all(log=print):
    for k in S.GRID_RECORDS:
        S.fetch_grid(k, log)
    S.fetch_hadisst(log)
    S.fetch_rutgers(log)
    S.fetch_nsidc("north", log)
    S.fetch_nsidc("south", log)
    S.fetch_sbuv(log)


def hr(t, out=print):
    out(f"\n{'=' * 110}\n{t}\n{'=' * 110}")


def report(out=print):
    # ---------------- air temperature
    hr("AIR TEMPERATURE (T2M, deg C per decade)", out)
    gis = load_cached_reference("T2M")
    landt = gis["land"]
    out("\nReference record already used by the site: GISTEMP v4, land boxes (from reference.py's cache)")
    describe("GISTEMP land", gis, landt, "C/decade", out=out)
    cams = run_gridded("T2M", "ghcncams", "t2")
    out("\nGHCN-CAMS (0.5 deg, land only; averaged to 2 deg boxes, a box needs >= half of its cell weight valid)")
    describe("GHCN-CAMS land", cams, landt, "C/decade", out=out)
    blat, _ = box_centres(GRIDS["t2"])
    w2 = np.cos(np.radians(blat))
    # both records on the identical 2 degree boxes
    both = {"used": gis["used"] & cams["used"]}
    pt = pair_table({**gis, "used": both["used"]}, {**cams, "used": both["used"]}, landt, False, w2)
    out("\n  GISTEMP and GHCN-CAMS on the same 2 deg land boxes, over the area where MERRA-2 is significant "
        f"({pt['boxes']} boxes):")
    out(f"    confirmed by both {pt['both']:.4f}   by exactly one {pt['one']:.4f} (GISTEMP only {pt['a_only_conf']:.4f}, "
        f"GHCN-CAMS only {pt['b_only_conf']:.4f})   by neither {pt['neither']:.4f}   same class in both records {pt['same_class']:.4f}")
    dgc = cams["refSlope"] - gis["refSlope"]
    ok = both["used"] & landt
    out(f"    GHCN-CAMS - GISTEMP trend difference (C/decade), area-weighted: median {f(R.wquant(dgc[ok], w2[ok], .5))} "
        f"p5 {f(R.wquant(dgc[ok], w2[ok], .05))} p95 {f(R.wquant(dgc[ok], w2[ok], .95))}")
    noaa = run_gridded("T2M", "noaagt", "g5")
    land5 = noaa["land"]
    out("\nNOAAGlobalTemp v5.1 (5 deg, land SAT + ocean SST anomalies, from 1850)")
    describe("NOAAGlobalTemp land", noaa, land5, "C/decade", out=out)
    describe("NOAAGlobalTemp ocean (MERRA-2 air temperature vs the record's SST)", noaa, ~land5, "C/decade", out=out)
    out("\n  places (box of each record's own grid; trends per decade):")
    places_rows({**gis, "grid": "t2"}, "GISTEMP 2 deg", "C/decade", out)
    places_rows(cams, "GHCN-CAMS 2 deg", "C/decade", out)
    places_rows(noaa, "NOAAGlobalTemp 5 deg", "C/decade", out)

    # ---------------- rainfall
    hr("RAINFALL (PRECTOTCORR, mm/day per decade; the site's rain rule: boxes poleward of 60 degrees are not eligible)", out)
    gpcp = load_cached_reference("PRECTOTCORR")
    blat5, _ = box_centres(GRIDS["r25"])
    w25 = np.cos(np.radians(blat5))
    land25 = land_boxes(GRIDS["r25"])
    allbox = np.ones(len(land25), dtype=bool)
    out("\nReference record already used by the site: GPCP v2.3 (all boxes, then land / ocean)")
    describe("GPCP all", gpcp, allbox, "mm/day/decade", True, out)
    describe("GPCP land", gpcp, land25, "mm/day/decade", True, out)
    rain = {"gpcp": gpcp}
    for key, name in RAIN_RECORDS:
        o = run_gridded("PRECTOTCORR", key, "r25")
        rain[key] = o
        out(f"\n{name} (2.5 deg, same boxes as GPCP; years valid {o['nyears']})")
        if key == "cmap":
            describe(f"{name} all", o, allbox, "mm/day/decade", True, out)
        describe(f"{name} land", o, land25, "mm/day/decade", True, out)
        if key == "cmap":
            describe(f"{name} ocean", o, ~land25, "mm/day/decade", True, out)
    out("\n  Pairs of records on the same 2.5 deg land boxes, over the area where MERRA-2 is significant and both are used:")
    keys = ["gpcp", "gpcc", "cmap", "precl"]
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = rain[keys[i]], rain[keys[j]]
            u = a["used"] & b["used"]
            pt = pair_table({**a, "used": u}, {**b, "used": u}, land25, True, w25)
            if pt:
                out(f"    {keys[i]:5s} x {keys[j]:5s} ({pt['boxes']:4d} boxes): both confirm {pt['both']:.4f}  exactly one {pt['one']:.4f}"
                    f"  neither {pt['neither']:.4f}  same class in both {pt['same_class']:.4f}")
    u = np.all([rain[k]["used"] for k in keys], axis=0)
    cl = np.array([classes({**rain[k], "used": u}, land25, True) for k in keys])
    m = (cl > 0).all(axis=0)
    out(f"    all four records used ({int(m.sum())} boxes, MERRA-2 significant): share of area confirmed by 4/4: "
        + ", ".join(f"{n}/4 {w25[m & ((cl == 1).sum(0) == n)].sum() / w25[m].sum():.4f}" for n in (4, 3, 2, 1, 0)))
    out("\n  places (trends per decade, mm/day):")
    for k, lab in (("gpcp", "GPCP"), ("gpcc", "GPCC"), ("cmap", "CMAP"), ("precl", "PREC/L")):
        places_rows(rain[k], lab + " 2.5 deg", "mm/day/decade", out)

    # ---------------- other variables
    hr("SEA ICE (FRSEAICE, percentage points per decade; ocean boxes)", out)
    land2 = land_boxes(GRIDS["t2"])
    for key, label in (("hadisst", "HadISST1 sea ice (1 deg -> 2 deg boxes)"), ("oisst_ice", "NOAA OISST v2 ice (1 deg -> 2 deg boxes)")):
        o = run_gridded("FRSEAICE", key, "t2")
        out(f"\n{label}; years valid {o['nyears']}")
        describe(key + " ocean", o, ~land2, "pct-points/decade", out=out)
        places_rows(o, key, "pct-points/decade", out)
    for hemi in ("north", "south"):
        ext, area = S.fetch_nsidc(hemi)
        out(f"\nNSIDC Sea Ice Index v4, {hemi}ern hemisphere, ice AREA (million km2) vs MERRA-2 sum of fraction x cell area")
        hemi_row(f"{hemi} hemisphere", merra_area_series("FRSEAICE", hemi), area, out)

    hr("SNOW COVER (FRSNO)", out)
    out("\nRutgers Global Snow Lab, Northern Hemisphere land snow-cover extent (million km2) vs MERRA-2 sum of fraction x area")
    hemi_row("NH land snow", merra_area_series("FRSNO", "north"), S.fetch_rutgers(), out)

    hr("WIND SPEED (WS2M, m/s per decade; ocean boxes, ICOADS ship winds)", out)
    ow = run_gridded("WS2M", "icoads_wspd", "t2")
    out(f"\nICOADS 2.5 enhanced wind speed 2 deg (years valid {ow['nyears']}, a box needs {ow['min_valid']})")
    describe("ICOADS ocean", ow, ~land2, "m/s/decade", out=out)
    places_rows(ow, "ICOADS", "m/s/decade", out)

    hr("HUMIDITY (RH2M, percentage points per decade; ocean boxes, ICOADS ship relative humidity)", out)
    oh = run_gridded("RH2M", "icoads_rhum", "t2")
    out(f"\nICOADS 2.5 enhanced relative humidity 2 deg (years valid {oh['nyears']}, a box needs {oh['min_valid']})")
    describe("ICOADS RH ocean", oh, ~land2, "pct-points/decade", out=out)

    hr("TOTAL OZONE (TO3, Dobson units per decade; 5 degree zonal bands)", out)
    sb = S.fetch_sbuv()
    Mz = merra_boxes("TO3", "zonal5").reshape(NY, 36)
    ok = np.isfinite(sb).sum(0) >= 36
    oz = compare(Mz, sb, min_valid=36)
    oz["land"] = np.ones(36, dtype=bool)
    oz["grid"] = "zonal5"
    bl, _ = box_centres(GRIDS["zonal5"])
    out(f"\nSBUV merged zonal means (v87 MOD v14): bands with >= 36 of 45 valid annual values: {int(oz['used'].sum())} of 36")
    describe("SBUV zonal", oz, np.ones(36, dtype=bool), "DU/decade", out=out)
    out("    band centre  MERRA-2 DU/dec (p)    SBUV DU/dec (p)    agree")
    for b in np.flatnonzero(oz["used"]):
        out(f"    {bl[b]:7.1f}   {oz['merraSlope'][b]:8.2f} ({oz['merraP'][b]:.3f})   {oz['refSlope'][b]:8.2f} ({oz['refP'][b]:.3f})   "
            f"{'yes' if oz['agree'][b] == 1 else 'NO'}")


SANITY_POINTS = {  # (year, lat, lon): land points for land records, open-ocean / polar points for the others
    "ghcncams": [(1990, 41.01, 28.97), (2005, 31.22, 121.43), (2020, -8.76, -63.90)],
    "noaagt": [(1990, 41.0, 28.9), (2005, 0.0, -140.0), (2020, -8.7, -63.9)],
    "gpcc": [(1990, 41.01, 28.97), (2005, 10.32, 123.89), (2020, -8.76, -63.90)],
    "cmap": [(1990, 41.01, 28.97), (2005, 10.32, 123.89), (2020, 0.0, -140.0)],
    "precl": [(1990, 41.01, 28.97), (2005, 31.22, 121.43), (2020, -8.76, -63.90)],
    "icoads_wspd": [(1990, 0.0, -140.0), (2000, 40.0, -30.0), (2010, 45.0, -30.0)],
    "icoads_rhum": [(1990, 0.0, -140.0), (2000, 41.0, -31.0), (2010, 45.0, -31.0)],
    "oisst_ice": [(1990, 75.0, 0.0), (2005, -65.0, -30.0), (2020, 80.0, -150.0)],
}


def sanity(out=print):
    """For each gridded record: three annual values from the cache (binary .dods requests) next to the same value recomputed
    from a separate .ascii request to the source."""
    for key, pts in SANITY_POINTS.items():
        ann, lat, lon = S.fetch_grid(key)
        out(f"  {key}: cached annual value vs separate .ascii request (12 monthly values -> annual)")
        for year, la, lo in pts:
            v, gla, glo, _ = S.dap_point_annual(key, year, la, lo, log=lambda *a: None)
            i, j = int(np.argmin(np.abs(lat - gla))), int(np.argmin(np.abs(lon - glo)))
            c = float(ann[year - 1981, i, j])
            out(f"    {year} grid point ({gla:7.2f},{glo:8.2f}): cache {c:10.4f}   ascii {v:10.4f}   "
                + ("match" if (np.isnan(c) and np.isnan(v)) or abs(c - v) < 1e-4 * max(1, abs(v)) else "MISMATCH"))

    # text / CSV records: the raw file is requested a second time and parsed again
    chk = lambda a, b: "match" if (np.isnan(a) and np.isnan(b)) or abs(a - b) < 1e-4 else "MISMATCH"  # noqa: E731
    out("  Rutgers NH land snow extent (million km2): cache vs a fresh download of the file")
    fresh = S.annual_of_months(S.parse_rutgers(S.http_get(S.RUTGERS_URL).decode("latin1")))
    cached = S.fetch_rutgers()
    for y in (1990, 2005, 2020):
        out(f"    {y}: cache {cached[y - 1981]:8.4f}   fresh {fresh[y - 1981]:8.4f}   {chk(cached[y - 1981], fresh[y - 1981])}")
    out("  NSIDC Sea Ice Index v4 north, September ice area (million km2): cache vs a fresh download of N_09 file")
    fresh = S.parse_nsidc(S.http_get(S.NSIDC_URL.format(hemi="north", h="N", mm=9)).decode("latin1"))
    cached = S.parse_nsidc(S.cached_text(S.NSIDC_URL.format(hemi="north", h="N", mm=9), "src_nsidc_N_09.csv"))
    for y in (1990, 2005, 2020):
        out(f"    {y}-09: cache {cached[(y, 9)][1]:6.2f}   fresh {fresh[(y, 9)][1]:6.2f}   {chk(cached[(y, 9)][1], fresh[(y, 9)][1])}")
    out("  SBUV zonal total ozone (DU), annual mean of the band: cache vs a fresh download")
    yrs, m = S.parse_sbuv(S.http_get(S.SBUV_URL).decode("latin1"))
    cached = S.fetch_sbuv()
    for y, b in ((1990, 20), (2005, 24), (2020, 12)):
        fresh = S.annual_from_monthly(np.moveaxis(m[list(yrs).index(y)], 1, 0))[b]
        out(f"    {y} band {-90 + 5 * b:4d}..{-85 + 5 * b:4d}: cache {cached[y - 1981, b]:8.3f}   fresh {fresh:8.3f}   {chk(cached[y - 1981, b], fresh)}")
    out("  HadISST sea ice (percent): cache vs the file read directly by scipy, no cache (same downloaded file; the Met Office")
    out("  serves only the 17 MB gzip, so a second request would return the same bytes)")
    from scipy.io import netcdf_file
    f_ = netcdf_file(os.path.join(config.CACHE_DIR, "HadISST_ice.nc"), mmap=True)
    ann, lat, lon = S.fetch_hadisst()
    for y, la, lo in ((1990, 75.5, 0.5), (2005, -65.5, -30.5), (2020, 80.5, -150.5)):
        i0 = (y - 1870) * 12
        ilat = int(np.argmin(np.abs(np.array(f_.variables["latitude"][:]) - la)))
        ilon = int(np.argmin(np.abs(np.array(f_.variables["longitude"][:]) - lo)))
        a = np.array(f_.variables["sic"][i0:i0 + 12])[:, ilat, ilon]
        d = float(np.where(a < -1, np.nan, a).mean() * 100)
        c = float(ann[y - 1981, int(np.argmin(np.abs(lat - la))), int(np.argmin(np.abs(lon - lo)))])
        out(f"    {y} ({la},{lo}): cache {c:8.3f}   direct {d:8.3f}   {chk(c, d)}")


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "report"
    if cmd == "fetch":
        fetch_all()
    elif cmd == "report":
        report()
    elif cmd == "sanity":
        sanity()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
