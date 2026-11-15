"""Continents and "the world" as places: which region every land cell belongs to and the trend of each region.

Inputs (offline once the mapping exists):
  data/country_continents.json   {country name in countries.json -> continent}, derived ONCE from Natural Earth
                                 admin-0 countries 50m (public domain) with `python -m areas.regions --build-mapping FILE`
  data/country_population.json  {country name -> estimated population} from the same file (only used to name the
                                 most populous countries of a region; never shown as a number)
  web/public/data/country_mask.bin, countries.json     (countries.py)
  cache/{VAR}_annual.npy, cache/{VAR}_trend.npz        (compute.py)

Outputs:
  cache/region_mask.npy               uint8 (361, 576), 0..6 = REGION_NAMES index of the continent, 255 = none (review)
  web/public/data/regions.json        per region and variable: slope per decade, Sen CI, p, cell counts, map shares
  tests/fixtures/region_cases.json    the Europe and Africa numbers, for the browser test

A region's trend is trendstats.trend_1d of the cos(latitude)-weighted mean annual series over the region's cells that
have no missing year (that is what "nWithData" counts). `fracRising` / `fracFalling` are area-weighted shares of the
region's cells WITH DATA that the map (cache/{VAR}_trend.npz, BH-adjusted q < 0.05) shows as a significant rise / fall.
Sea-only variables (FRSEAICE) have no value for a region (null).

Run from the pipeline directory:  .venv/bin/python -m areas.regions
"""
import json
import os
import sys

import numpy as np

from core import config
from areas import countries as C
from core import products
from core.trendstats import trend_1d

DATA_DIR = os.path.join(config.PIPELINE_DIR, "data")
MAPPING_JSON = os.path.join(DATA_DIR, "country_continents.json")
POP_JSON = os.path.join(DATA_DIR, "country_population.json")
MASK_NPY = os.path.join(config.CACHE_DIR, "region_mask.npy")
REGIONS_JSON = os.path.join(config.WEB_DATA_DIR, "regions.json")
FIXTURE = os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "region_cases.json")

CONTINENTS = ["Europe", "Asia", "Africa", "North America", "South America", "Oceania", "Antarctica"]
WORLD = "World"
NONE = 255
ALPHA = 0.05

# Where the camera goes ([lat, lng], altitude in globe radii; hand-chosen so the whole region is in view).
VIEW = {
    "Europe": ([52.0, 15.0], 1.7),
    "Asia": ([42.0, 90.0], 2.4),
    "Africa": ([2.0, 20.0], 2.2),
    "North America": ([48.0, -100.0], 2.3),
    "South America": ([-18.0, -60.0], 2.1),
    "Oceania": ([-25.0, 140.0], 2.2),
    "Antarctica": ([-80.0, 0.0], 2.4),
    WORLD: ([20.0, 10.0], 2.4),
}

# Natural Earth files these under "Seven seas (open ocean)": islands that belong to no continent. Assigned by hand
# (country name in countries.json -> continent). Every other country is matched by ISO_N3 (then ISO_N3_EH, then by name:
# Somaliland, Kosovo, N. Cyprus, Indian Ocean Ter. and Siachen Glacier have no ISO number and matched by name).
HAND_CONTINENT = {
    # NE says "Seven seas (open ocean)": islands that belong to no continent. Placed by the nearest one.
    "Fr. S. Antarctic Lands": "Antarctica",  # Kerguelen, Crozet, Amsterdam I.: sub-Antarctic
    "Heard I. and McDonald Is.": "Antarctica",
    "S. Geo. and the Is.": "Antarctica",     # South Georgia and the South Sandwich Is.
    "Saint Helena": "Africa",
    "Br. Indian Ocean Ter.": "Asia",         # Chagos
    "Seychelles": "Africa",                  # UN / AU usage
    "Mauritius": "Africa",
    "Maldives": "Asia",
}

# Overseas parts of a "Europe" country (French Guiana, Reunion, the Canaries, Madeira ...): a land cell whose country is
# European but which lies outside the European box is not Europe. It goes to the continent whose box (lat0, lat1, lng0,
# lng1) holds it, else it is dropped. Boxes are checked in this order.
EUROPE_BOX = (34.0, 82.0, -32.0, 60.0)
OVERSEAS_BOXES = [
    ("South America", (-5.0, 15.0, -60.0, -50.0)),     # French Guiana
    ("North America", (10.0, 20.0, -65.0, -58.0)),     # Guadeloupe, Martinique, St Barthelemy
    ("Africa", (-26.0, 36.0, -26.0, 58.0)),            # Canaries, Madeira, Reunion, Mayotte
]


def _inside(lat, lng, box):
    return box[0] <= lat <= box[1] and box[2] <= lng <= box[3]


# ---- mapping country -> continent ----------------------------------------------------------------------------------

def build_mapping(ne_geojson_path):
    """Read Natural Earth admin-0 countries (GeoJSON) and write data/country_continents.json and
    data/country_population.json for every country of countries.json. Prints every country not matched by ISO."""
    with open(ne_geojson_path) as f:
        feats = json.load(f)["features"]
    with open(os.path.join(config.WEB_DATA_DIR, "countries.json")) as f:
        recs = json.load(f)
    by_iso, by_name = {}, {}
    for ft in feats:
        p = ft["properties"]
        for key in ("ISO_N3", "ISO_N3_EH"):
            v = p.get(key)
            if v not in (None, "-99", -99):
                by_iso.setdefault(int(v), p)
        by_name.setdefault(p["NAME"], p)
    cont, pop, unmatched = {}, {}, []
    for r in recs:
        p = by_iso.get(int(r["iso"])) if r["iso"] else None
        if p is None:
            p = by_name.get(r["name"])
        if p is not None and p["CONTINENT"] in CONTINENTS:
            cont[r["name"]] = p["CONTINENT"]
            pop[r["name"]] = int(p.get("POP_EST") or 0)
        else:
            unmatched.append((r["name"], r["iso"], None if p is None else p["CONTINENT"]))
    print("not matched to a Natural Earth continent by ISO number or name (assigned by hand in HAND_CONTINENT):")
    for name, iso, ne in unmatched:
        print(f"  {name!r:32} iso={iso} NE says {ne}  -> {HAND_CONTINENT.get(name)}")
        cont[name] = HAND_CONTINENT[name]
        pop[name] = 0
    os.makedirs(DATA_DIR, exist_ok=True)
    out = {r["name"]: cont[r["name"]] for r in recs}
    with open(MAPPING_JSON, "w") as f:
        json.dump(out, f, indent=0, ensure_ascii=False, sort_keys=True)
    with open(POP_JSON, "w") as f:
        json.dump({r["name"]: pop[r["name"]] for r in recs}, f, indent=0, ensure_ascii=False, sort_keys=True)
    counts = {}
    for v in out.values():
        counts[v] = counts.get(v, 0) + 1
    print(f"wrote {MAPPING_JSON} ({len(out)} countries): {counts}")


def load_mapping():
    with open(MAPPING_JSON) as f:
        return json.load(f)


# ---- cell -> region --------------------------------------------------------------------------------------------------

def load_country_mask():
    m = np.fromfile(os.path.join(config.WEB_DATA_DIR, "country_mask.bin"), dtype=np.uint8)
    return m.reshape(C.NLAT, C.NLON)


def load_country_records():
    with open(os.path.join(config.WEB_DATA_DIR, "countries.json")) as f:
        return json.load(f)


def russia_continent(lng):
    """Russian cell: Asia from 60 E to 180 E and west of 168 W (Chukotka), Europe otherwise."""
    return "Asia" if (60.0 <= lng <= 180.0 or lng < -168.0) else "Europe"


def cell_continent(country, lat, lng, mapping):
    """Continent of one land cell given its country's name, or None when the cell is dropped. Also returns a reason
    string for a changed cell ('moved:<continent>', 'dropped', 'russia:<continent>', or '' when plain)."""
    cont = mapping[country]
    if country == "Russia":
        c = russia_continent(lng)
        return c, ("russia:" + c)
    if cont == "Europe" and not _inside(lat, lng, EUROPE_BOX):
        for name, box in OVERSEAS_BOXES:
            if _inside(lat, lng, box):
                return name, "moved:" + name
        return None, "dropped"
    return cont, ""


def build_region_mask(mask=None, recs=None, mapping=None):
    """(uint8 (361, 576) region index or 255, change log {country: {reason: n cells}}, plain counts {country: n})."""
    mask = load_country_mask() if mask is None else mask
    recs = load_country_records() if recs is None else recs
    mapping = load_mapping() if mapping is None else mapping
    out = np.full(mask.shape, NONE, dtype=np.uint8)
    log, kept = {}, {}
    for idx, r in enumerate(recs):
        ii, jj = np.nonzero(mask == idx)
        for i, j in zip(ii, jj):
            c, why = cell_continent(r["name"], float(C.LATS[i]), float(C.LONS[j]), mapping)
            if c is not None:
                out[i, j] = CONTINENTS.index(c)
            if why:
                log.setdefault(r["name"], {}).setdefault(why, 0)
                log[r["name"]][why] += 1
            else:
                kept[r["name"]] = kept.get(r["name"], 0) + 1
    return out, log, kept


# ---- statistics ------------------------------------------------------------------------------------------------------

def land_cells(region_mask, country_mask, name):
    """Boolean (361, 576) of the cells of a region; World is every land cell (country mask), dropped overseas cells too."""
    if name == WORLD:
        return country_mask != NONE
    return region_mask == CONTINENTS.index(name)


def area_weights():
    """cos(latitude) of every grid row, as a (361, 1) column."""
    return np.cos(np.radians(C.LATS))[:, None]


def region_variable(var, cells, grid, trend):
    """One variable of one region (dict), or None when the variable has no value over land or no cell has all 45 years.
    grid: products.load_grid(var); trend: np.load of cache/{var}_trend.npz."""
    if products.surface(var) == "sea":
        return None
    ok = cells & ~np.isnan(grid).any(axis=0)
    n_ok = int(ok.sum())
    if n_ok == 0:
        return None
    w = np.broadcast_to(area_weights(), cells.shape)[ok]
    series = (grid[:, ok] * w).sum(axis=1) / w.sum()
    t = trend_1d(series, np.array(config.YEARS, dtype=np.float64))
    q = trend["q"][ok]
    slope = trend["slope_decade"][ok]
    sig = np.isfinite(q) & (q < ALPHA)
    return {
        "slopePerDecade": 10.0 * t["slope"], "ciLow": 10.0 * t["ci_low"], "ciHigh": 10.0 * t["ci_high"], "p": t["p"],
        "nCells": int(cells.sum()), "nWithData": n_ok,
        "fracRising": float(w[sig & (slope > 0)].sum() / w.sum()),
        "fracFalling": float(w[sig & (slope < 0)].sum() / w.sum()),
    }


ALSO_LISTED = {("Russia", "Europe")}  # most Russians live in the European part, although most of its land is Asian


def top_countries(name, recs, pops, region_mask, country_mask, n=3):
    """Names (as in countries.json) of the n most populous countries of a region. A country belongs to the region that
    holds most of its cells (so France is not a "South American" country because of French Guiana), plus the
    ALSO_LISTED pairs; Antarctica lists none."""
    if name == "Antarctica":
        return []  # nobody lives there permanently; "Lift Antarctica" would repeat the region itself
    out = []
    for r in recs:
        if pops.get(r["name"], 0) <= 0:
            continue
        cells = country_mask == r["idx"]
        if not cells.any():
            continue
        if name == WORLD:
            out.append(r["name"])
            continue
        counts = np.bincount(region_mask[cells][region_mask[cells] != NONE], minlength=len(CONTINENTS))
        if counts.sum() and (int(np.argmax(counts)) == CONTINENTS.index(name) or (r["name"], name) in ALSO_LISTED):
            out.append(r["name"])
    return sorted(out, key=lambda c: (-pops.get(c, 0), c))[:n]


def sig6(x):
    return None if x is None else float(f"{x:.6g}")


def build_all(region_mask=None, country_mask=None, recs=None, mapping=None):
    country_mask = load_country_mask() if country_mask is None else country_mask
    recs = load_country_records() if recs is None else recs
    mapping = load_mapping() if mapping is None else mapping
    if region_mask is None:
        region_mask = build_region_mask(country_mask, recs, mapping)[0]
    with open(POP_JSON) as f:
        pops = json.load(f)
    out = []
    names = CONTINENTS + [WORLD]
    for name in names:
        out.append({"name": name, "cells": land_cells(region_mask, country_mask, name), "variables": {}})
    for var in config.VARIABLES:
        grid = products.load_grid(var)
        trend = np.load(os.path.join(config.CACHE_DIR, f"{var}_trend.npz"))
        for reg in out:
            reg["variables"][var] = region_variable(var, reg["cells"], grid, trend)
    result = []
    for reg in out:
        name = reg["name"]
        centre, alt = VIEW[name]
        variables = {v: None if d is None else {k: (x if isinstance(x, int) else sig6(x)) for k, x in d.items()}
                     for v, d in reg["variables"].items()}
        result.append({"name": name, "centre": centre, "altitude": alt, "nCells": int(reg["cells"].sum()),
                       "topCountries": top_countries(name, recs, pops, region_mask, country_mask),
                       "variables": variables})
    return {"years": [config.YEARS[0], config.YEARS[-1]], "regions": result}


def main():
    country_mask = load_country_mask()
    recs = load_country_records()
    mapping = load_mapping()
    region_mask, log, kept = build_region_mask(country_mask, recs, mapping)
    np.save(MASK_NPY, region_mask)
    print(f"wrote {MASK_NPY}: {int((region_mask != NONE).sum())} region cells of {int((country_mask != NONE).sum())} land cells")
    print("countries with any moved / dropped / split cell (country, continent in the mapping, cells kept, cells moved/dropped):")
    for country in sorted(log):
        print(f"  {country:28} {mapping[country]:14} kept={kept.get(country, 0):5}  " +
              ", ".join(f"{why}={n}" for why, n in sorted(log[country].items())))
    data = build_all(region_mask, country_mask, recs, mapping)
    with open(REGIONS_JSON, "w") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {REGIONS_JSON} ({os.path.getsize(REGIONS_JSON)} bytes)")
    cases = {"years": data["years"], "regions": [r for r in data["regions"] if r["name"] in ("Europe", "Africa")]}
    with open(FIXTURE, "w") as f:
        json.dump(cases, f, indent=1)
    print(f"wrote {FIXTURE}")
    print("region x variable: slope/decade  p  nWithData/nCells  fracRising  fracFalling")
    for r in data["regions"]:
        print(f"{r['name']} (nCells {r['nCells']}, top {r['topCountries']})")
        for v, d in r["variables"].items():
            print(f"   {v:12}", "no data" if d is None else
                  f"{d['slopePerDecade']:+.4f}  p={d['p']:.4g}  {d['nWithData']}/{d['nCells']}  rise={d['fracRising']:.3f}  fall={d['fracFalling']:.3f}")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--build-mapping":
        build_mapping(sys.argv[2])
    else:
        main()
