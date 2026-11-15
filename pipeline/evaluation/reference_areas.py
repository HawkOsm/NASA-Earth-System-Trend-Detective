"""Independent check for areas (countries, seas, continents, World): the point check of reference.py averaged over an area.

Definitions (fixed by the task). For a variable V and an area A (a set of full-resolution MERRA-2 cells):
  ELIGIBLE box   reference.eligible_mask: used and (T2M: land | rain: |box centre latitude| < 60)
  CONTRIBUTES    eligible and its reference series R has all 45 years
  w_b            sum of cos(latitude) over the cells of A whose centre lies in box b (lower edges inclusive; a cell outside
                 every box, i.e. latitude 90 for the 2-degree T2M boxes, belongs to no box and counts nowhere)
  coverage       sum of w_b over contributing boxes / sum of w_b over ALL boxes holding a cell of A; CHECKED if >= 0.5
                 (T2M over a sea: never checked, reason "sea"; no cell or no box: reason "coverage")
  R_A, M_A       w_b-weighted mean over the contributing boxes of the reference series R and of the box-mean MERRA-2 M
                 (both over the same footprint; a box whose M is missing in one year drops out of that year's mean)
  refSlope, refP trend_1d(R_A); merraSlope = trend_1d(M_A); sizeDiffers = the two 95% ranges do not overlap;
  badYears       reference.bad_years(V, M_A, R_A)
  records        the same for every further independent record (reference_multi): R_A of the record over ITS contributing
                 boxes (eligible, all 45 years there), coverage rule per record as above; a record that meets the rule is
                 listed in the area's `records` ({short, refSlope, refP, coverage}), the first record always (it is the
                 area's own check), the others only when they cover at least half of the area.
Output: web/public/data/reference/areas_{VAR}.json  (4 significant digits; checked areas only in countries/seas/regions).

Run from the pipeline directory:  .venv/bin/python -m evaluation.reference_areas
"""
import json
import os
import sys

import numpy as np

from core import config
from evaluation import reference as X
from areas import regions as RG

OUT_DIR = X.OUT_DIR
MIN_COVERAGE = 0.5
NLAT, NLON = 361, 576


def cell_boxes(var):
    """int [361][576]: index (ilat * nlon + ilon) of the reference box holding each cell centre, -1 outside every box.
    Same edges as reference.box_means (box i covers [lat0 - dlat/2 + i*dlat, + dlat), lower edge inclusive)."""
    lat0, dlat, nlat, lon0, dlon, nlon = X.reference_grid(var)
    # The stored coordinates carry rounding noise (the equator is -1.8e-13, not 0). Snap them, or a cell exactly on
    # a box edge lands in the wrong box and "lower edge inclusive" is not what actually happens.
    lat = np.round(np.load(os.path.join(config.CACHE_DIR, "lat.npy")).astype(np.float64), 6)
    lon = np.round(np.load(os.path.join(config.CACHE_DIR, "lon.npy")).astype(np.float64), 6)
    i = np.floor((lat - (lat0 - dlat / 2)) / dlat).astype(int)
    j = np.floor((lon - (lon0 - dlon / 2)) / dlon).astype(int)
    i = np.where((i >= 0) & (i < nlat), i, -1)
    j = np.where((j >= 0) & (j < nlon), j, -1)
    b = i[:, None] * nlon + j[None, :]
    return np.where((i[:, None] >= 0) & (j[None, :] >= 0), b, -1), lat


def box_weights(cells, boxidx, lat, nbox):
    """[nbox] w_b = sum of cos(lat) over the cells of the area (bool [361][576]) whose centre lies in box b."""
    w = np.cos(np.radians(lat))[:, None] * np.ones(cells.shape[1])[None, :]
    sel = cells & (boxidx >= 0)
    return np.bincount(boxidx[sel], weights=w[sel], minlength=nbox)


def contributing(var, R, used, land):
    """[nbox] bool: eligible and the reference series has all years."""
    el = X.eligible_mask(var, used, land) == 1
    return el & (np.isfinite(R).sum(0) == R.shape[0])


def record_entry(wb, contrib, R):
    """(refSlope, refP, coverage) of one record's area mean over its own contributing boxes, or None (coverage < 1/2)."""
    tot = float(wb.sum())
    use = contrib & (wb > 0)
    if tot <= 0 or float(wb[use].sum() / tot) < MIN_COVERAGE:
        return None
    w = wb[use]
    r = (R[:, use] * w).sum(1) / w.sum()
    rs, _, _, rp = X.trend_of(r)
    if not np.isfinite(rs):
        return None
    return rs, rp, float(wb[use].sum() / tot)


def area_entry(var, wb, contrib, R, M, others=None):
    """(entry dict, None) for a checked area, (None, reason) for an unchecked one. wb [nbox], R, M [years][nbox]."""
    tot = float(wb.sum())
    if tot <= 0:
        return None, "coverage"
    use = contrib & (wb > 0)
    cov = float(wb[use].sum() / tot)
    if cov < MIN_COVERAGE:
        return None, "coverage"
    w = wb[use]
    r = (R[:, use] * w).sum(1) / w.sum()
    Mu = M[:, use]
    fin = np.isfinite(Mu)
    m = (np.where(fin, Mu, 0.0) * w).sum(1) / (fin * w).sum(1)
    m = np.where(fin.any(1), m, np.nan)
    rs, rlo, rhi, rp = X.trend_of(r)
    ms, mlo, mhi, mp = X.trend_of(m)
    if not np.isfinite(rs) or not np.isfinite(ms):
        return None, "coverage"
    bad, _, _ = X.bad_years(var, m, r)
    entry = {"refSlope": rs, "refP": rp, "merraSlope": ms, "sizeDiffers": not X.ci_overlap(mlo, mhi, rlo, rhi),
             "coverage": cov, "badYears": [int(y) for y in X.YEARS[bad]]}
    if others is not None:   # [(short, contrib, R)] of the further records; the first record comes first in `records`
        recs = [{"short": others[0][0], "refSlope": rs, "refP": rp, "coverage": cov}]
        for short, c_i, R_i in others[1:]:
            e = record_entry(wb, c_i, R_i)
            if e is not None:
                recs.append({"short": short, "refSlope": e[0], "refP": e[1], "coverage": e[2]})
        entry["records"] = recs
    return entry, None


def _sig(x):
    return float(f"{x:.4g}")


def _clean(e):
    out = {"refSlope": _sig(e["refSlope"]), "refP": _sig(e["refP"]), "merraSlope": _sig(e["merraSlope"]),
           "sizeDiffers": bool(e["sizeDiffers"]), "coverage": _sig(e["coverage"]), "badYears": e["badYears"]}
    if "records" in e:
        out["records"] = [{"short": r["short"], "refSlope": _sig(r["refSlope"]), "refP": _sig(r["refP"]),
                           "coverage": _sig(r["coverage"])} for r in e["records"]]
    return out


def area_sets():
    """{'countries': {idx: cells}, 'seas': {...}, 'regions': {name: cells}} as bool [361][576]."""
    cmask = np.fromfile(os.path.join(config.WEB_DATA_DIR, "country_mask.bin"), dtype=np.uint8).reshape(NLAT, NLON)
    smask = np.fromfile(os.path.join(config.WEB_DATA_DIR, "sea_mask.bin"), dtype=np.uint8).reshape(NLAT, NLON)
    rmask = np.load(RG.MASK_NPY)
    with open(os.path.join(config.WEB_DATA_DIR, "countries.json")) as f:
        cidx = [r["idx"] for r in json.load(f)]
    with open(os.path.join(config.WEB_DATA_DIR, "seas.json")) as f:
        sidx = [r["idx"] for r in json.load(f)]
    return {"countries": {i: cmask == i for i in cidx}, "seas": {i: smask == i for i in sidx},
            "regions": {**{n: rmask == k for k, n in enumerate(RG.CONTINENTS)}, RG.WORLD: cmask != RG.NONE}}


def compute_var(var, sets=None):
    z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
    R, M = z["R"], z["M"]
    lat0, dlat, nlat, lon0, dlon, nlon = X.reference_grid(var)
    nbox = nlat * nlon
    boxidx, lat = cell_boxes(var)
    contrib = contributing(var, R, z["used"], z["land"])
    from evaluation import reference_multi as MM
    mrecs, el = MM.records_for(var)
    # [(short, contributing boxes, series)] per record: eligible boxes where that record has all 45 years
    others = [(mrecs[0]["short"], contrib, R)]
    for r in mrecs[1:]:
        Rr = MM._series_of(var, r["key"])
        others.append((r["short"], el & (np.isfinite(Rr).sum(0) == Rr.shape[0]), Rr))
    sets = area_sets() if sets is None else sets
    doc = {"source": X.SOURCES[var], "records": [{"short": r["short"], "name": r["name"], "what": r["what"]} for r in mrecs],
           "countries": {}, "seas": {}, "regions": {}, "unchecked": {"countries": {}, "seas": {}, "regions": {}}}
    raw = {}
    for kind, d in sets.items():
        for key, cells in d.items():
            if var == "T2M" and kind == "seas":
                entry, why = None, "sea"
            else:
                entry, why = area_entry(var, box_weights(cells, boxidx, lat, nbox), contrib, R, M, others)
            if entry is None:
                doc["unchecked"][kind][str(key)] = why
            else:
                doc[kind][str(key)] = _clean(entry)
                raw[(kind, str(key))] = entry
    return doc, raw


TABLE = [("Turkey", "countries"), ("Brazil", "countries"), ("Philippines", "countries"), ("Russia", "countries"),
         ("United States of America", "countries"), ("Australia", "countries"), ("Black Sea", "seas"),
         ("Mediterranean Sea", "seas"), ("North Pacific Ocean", "seas"), ("Europe", "regions"), ("Africa", "regions"),
         ("South America", "regions"), ("World", "regions")]


def main():
    with open(os.path.join(config.WEB_DATA_DIR, "countries.json")) as f:
        cname = {r["name"]: str(r["idx"]) for r in json.load(f)}
    with open(os.path.join(config.WEB_DATA_DIR, "seas.json")) as f:
        sname = {r["name"]: str(r["idx"]) for r in json.load(f)}
    sets = area_sets()
    os.makedirs(OUT_DIR, exist_ok=True)
    for var in X.VARS:
        doc, _ = compute_var(var, sets)
        with open(os.path.join(OUT_DIR, f"areas_{var}.json"), "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        print(f"\n{var}: checked countries {len(doc['countries'])}/{len(sets['countries'])}, seas {len(doc['seas'])}/{len(sets['seas'])}, "
              f"regions {len(doc['regions'])}/{len(sets['regions'])}")
        print(f"  {'area':26s} {'refSlope':>9s} {'refP':>8s} {'merraSlope':>10s} {'coverage':>8s}  badYears")
        for name, kind in TABLE:
            key = cname.get(name) if kind == "countries" else sname.get(name) if kind == "seas" else name
            e = doc[kind].get(key)
            if e is None:
                print(f"  {name:26s} unchecked: {doc['unchecked'][kind].get(key)}")
            else:
                print(f"  {name:26s} {e['refSlope']:9.4g} {e['refP']:8.4g} {e['merraSlope']:10.4g} {e['coverage']:8.4g}  {e['badYears']}")
        reasons = {}
        for kind in ("countries", "seas", "regions"):
            for v in doc["unchecked"][kind].values():
                reasons[(kind, v)] = reasons.get((kind, v), 0) + 1
        print("  unchecked:", dict(sorted(reasons.items())))


if __name__ == "__main__":
    main()
