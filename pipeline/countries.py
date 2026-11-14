"""Country view data: which country each grid cell belongs to, each country's cell series, and its cities.

Inputs (offline): the Natural Earth country outlines (npm package world-atlas, countries-50m.json, public domain),
the cached annual grids (cache/{VAR}_annual.npy) and Natural Earth populated places
(pipeline/data/ne_50m_populated_places_simple.geojson, public domain, treated as data only).

Outputs in web/public/data:
  country_mask.bin            Uint8 [361 lat ascending][576 lon], country index or 255
  countries.json              one record per country (ordered by its index in the TopoJSON geometries array)
  countries/{VAR}/{idx}.bin   Int16 LE [nCells][45], value = round(v * 100), NaN = -32768 (mask order)
  cities.json                 up to 12 cities per country
  {VAR}_cities.bin            Int16 LE [nCities][45], the series of the grid cell each city sits in
and tests/fixtures/country_cases.json (reference country means for the browser tests).

Run from the pipeline directory:  .venv/bin/python countries.py
"""
import json
import os

import numpy as np
from matplotlib.path import Path as MPath

import basemap
import config
from trendstats import trend_1d

COUNTRIES_JSON = os.path.join(os.path.dirname(config.PIPELINE_DIR), "web", "node_modules", "world-atlas",
                              "countries-50m.json")
PLACES_JSON = os.path.join(config.PIPELINE_DIR, "data", "ne_50m_populated_places_simple.geojson")
FIXTURE = os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "country_cases.json")

NLAT, NLON = 361, 576
LAT0, DLAT, LON0, DLON = -90.0, 0.5, -180.0, 0.625
NONE = 255
MISSING = -32768
MAX_CITIES = 12
FIXTURE_COUNTRIES = ["Turkey", "Brazil", "Fiji"]  # plus one tiny country, chosen in build_fixture

LATS = LAT0 + DLAT * np.arange(NLAT)
LONS = LON0 + DLON * np.arange(NLON)


# ---- outlines ----------------------------------------------------------------------------------------------------

def load_countries():
    """(topo, [ {name, iso, polys: [[ring, hole, ...], ...]} per geometry ]) in geometries-array order."""
    with open(COUNTRIES_JSON) as f:
        topo = json.load(f)
    arcs = basemap.decode_arcs(topo)
    out = []
    for g in topo["objects"]["countries"]["geometries"]:
        if g["type"] == "Polygon":
            parts = [g["arcs"]]
        elif g["type"] == "MultiPolygon":
            parts = g["arcs"]
        else:
            parts = []
        polys, moved = [], False
        for poly in parts:
            rings, m = normalise_polygon([basemap.ring_coords(arcs, r) for r in poly])
            polys.append(rings)
            moved = moved or m
        iso = g.get("id")
        out.append({"name": g["properties"]["name"], "iso": None if iso is None else str(iso), "polys": polys,
                    "moved": moved})
    return out


def continuous_lon(r):
    """Ring with longitudes made continuous (a jump across +-180 is replaced by the short way round)."""
    d = np.diff(r[:, 0])
    d = d - 360.0 * np.round(d / 360.0)
    return np.column_stack([np.concatenate([[r[0, 0]], r[0, 0] + np.cumsum(d)]), r[:, 1]])


def normalise_polygon(poly):
    """Make a TopoJSON polygon planar. The country outlines are NOT cut at +-180: a ring that crosses the
    antimeridian jumps by about 360 degrees, so its longitudes are unwrapped (the polygon then reaches past 180).
    Returns (rings, moved). The Antarctic polygon is special: its 'outer' ring runs along the pole and the coast is
    the hole; it is turned into the coast ring closed through the pole."""
    if len(poly) > 1 and poly[0][:, 1].max() <= -89.9:
        coast = continuous_lon(poly[1])
        return [np.vstack([coast, [[coast[-1, 0], -90.0], [coast[0, 0], -90.0]], coast[:1]])], False
    rings = [basemap.unwrap_ring(r) for r in poly]
    moved = any(m for _, m in rings)
    outer = rings[0][0]
    if moved:  # outer ring at lon >= -180, every hole in the same frame as the outer ring
        outer = outer + [360.0 * np.ceil((-180.0 - outer[:, 0].min()) / 360.0), 0.0]
    centre = 0.5 * (outer[:, 0].min() + outer[:, 0].max())
    out = [outer]
    for hole, _ in rings[1:]:
        c = 0.5 * (hole[:, 0].min() + hole[:, 0].max())
        out.append(hole + [360.0 * np.round((centre - c) / 360.0), 0.0] if moved else hole)
    return out, moved


def shifted(poly, sh):
    return [r + [sh, 0.0] for r in poly] if sh else poly


def _bbox(ring):
    return ring[:, 0].min(), ring[:, 1].min(), ring[:, 0].max(), ring[:, 1].max()


def contains(poly, pts):
    """Boolean array: which (lon, lat) points are inside the polygon (outer ring minus holes)."""
    ins = MPath(poly[0]).contains_points(pts)
    for hole in poly[1:]:
        ins &= ~MPath(hole).contains_points(pts)
    return ins


def build_mask(countries):
    """Uint8 [lat][lon]: the country whose polygon contains the grid-cell centre (lowest index wins), else 255."""
    mask = np.full((NLAT, NLON), NONE, dtype=np.uint8)
    for idx, c in enumerate(countries):
        for poly0 in c["polys"]:
            wide = poly0[0][:, 0].max() > 180.0  # reaches past +180: also test the polygon moved by -360
            for sh in ((0.0, -360.0) if wide else (0.0,)):
                poly = shifted(poly0, sh)
                x0, y0, x1, y1 = _bbox(poly[0])
                i0, i1 = max(int(np.ceil((y0 - LAT0) / DLAT)), 0), min(int(np.floor((y1 - LAT0) / DLAT)), NLAT - 1)
                j0, j1 = max(int(np.ceil((x0 - LON0) / DLON)), 0), min(int(np.floor((x1 - LON0) / DLON)), NLON - 1)
                if i1 < i0 or j1 < j0:
                    continue
                gi, gj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1), indexing="ij")
                pts = np.column_stack([LONS[gj.ravel()], LATS[gi.ravel()]])
                ins = contains(poly, pts).reshape(gi.shape)
                sub = mask[i0:i1 + 1, j0:j1 + 1]
                sub[ins & (sub == NONE)] = idx
    return mask


def nearest_cell(lat, lng):
    """(i, j) of the nearest grid cell; i clamps, j wraps."""
    i = int(min(max(round((lat - LAT0) / DLAT), 0), NLAT - 1))
    j = int(round((lng - LON0) / DLON)) % NLON
    return i, j


def country_at(mask, lat, lng):
    """Country index at the nearest grid cell, or 255."""
    i, j = nearest_cell(lat, lng)
    return int(mask[i, j])


def inside_point(poly):
    """A point (lon, lat) inside the polygon: its centroid if that is inside, else the middle of the longest inside
    stretch of the horizontal line through the mean latitude."""
    ring = poly[0]
    x, y = ring[:, 0], ring[:, 1]
    cr = x[:-1] * y[1:] - x[1:] * y[:-1]
    a = cr.sum() / 2.0
    if abs(a) > 1e-12:
        c = np.array([((x[:-1] + x[1:]) * cr).sum() / (6 * a), ((y[:-1] + y[1:]) * cr).sum() / (6 * a)])
        if contains(poly, c[None, :])[0]:
            return float(c[0]), float(c[1])
    x0, y0, x1, y1 = _bbox(ring)
    for ly in (y.mean(), 0.5 * (y0 + y1), 0.25 * y0 + 0.75 * y1, 0.75 * y0 + 0.25 * y1):
        xs = np.linspace(x0, x1, 2001)
        ins = contains(poly, np.column_stack([xs, np.full_like(xs, ly)]))
        best, run = (0, 0, -1), None
        for k, v in enumerate(ins):
            if v and run is None:
                run = k
            if (not v or k == len(ins) - 1) and run is not None:
                end = k if not v else k + 1
                if end - run > best[0]:
                    best = (end - run, run, end - 1)
                run = None
        if best[0] > 0:
            return float(0.5 * (xs[best[1]] + xs[best[2]])), float(ly)
    return float(0.5 * (x0 + x1)), float(0.5 * (y0 + y1))


def build_records(countries, mask):
    """countries.json records. A country with no mask cell is 'tiny': its one cell is the grid cell nearest to a
    point inside its largest polygon (the mask is left alone)."""
    recs = []
    counts = np.bincount(mask.ravel(), minlength=256)
    for idx, c in enumerate(countries):
        polys = c["polys"]
        big = max(polys, key=lambda p: basemap.ring_area(p[0]))
        cx, cy = inside_point(big)
        allpts = np.concatenate([p[0] for p in polys], axis=0)
        n = int(counts[idx])
        tiny = n == 0
        rec = {
            "idx": idx, "name": c["name"], "iso": c["iso"], "nCells": 1 if tiny else n, "tiny": tiny,
            "bbox": [round(float(allpts[:, 1].min()), 4), round(float(allpts[:, 1].max()), 4),
                     round(float(allpts[:, 0].min()), 4), round(float(allpts[:, 0].max()), 4)],
            "centre": [round(cy, 4), round((cx + 180.0) % 360.0 - 180.0, 4)], "tinyCell": None,
        }
        if tiny:
            i, j = nearest_cell(cy, (cx + 180.0) % 360.0 - 180.0)
            rec["tinyCell"] = [float(LATS[i]), float(LONS[j])]
        # Polygons on both sides of +-180 (after unwrapping), unless one polygon spans the whole globe (Antarctica).
        if max(p[0][:, 0].max() - p[0][:, 0].min() for p in polys) < 300 and (
                c["moved"] or (any(p[0][:, 0].max() > 170 for p in polys) and any(p[0][:, 0].min() < -170 for p in polys))):
            rec["wraps"] = True
        recs.append(rec)
    return recs


def country_cell_indices(mask, rec):
    """(i, j) arrays of a country's cells in mask order (lat ascending, then lon ascending)."""
    if rec["tiny"]:
        i, j = nearest_cell(*rec["tinyCell"])
        return np.array([i]), np.array([j])
    return np.nonzero(mask == rec["idx"])


# ---- cities --------------------------------------------------------------------------------------------------------

def assign_cities(countries, mask, recs):
    with open(PLACES_JSON) as f:
        feats = json.load(f)["features"]
    boxes = [[_bbox(p[0]) for p in c["polys"]] for c in countries]
    by_country = {}
    for ft in feats:
        pr = ft["properties"]
        lng, lat = ft["geometry"]["coordinates"]
        owner = None
        for idx, c in enumerate(countries):
            for poly, (x0, y0, x1, y1) in zip(c["polys"], boxes[idx]):
                for L in (lng, lng + 360.0):  # polygons may reach past +180
                    if x0 <= L <= x1 and y0 <= lat <= y1 and contains(poly, np.array([[L, lat]]))[0]:
                        owner = idx
                        break
                if owner is not None:
                    break
            if owner is not None:
                break
        if owner is None:  # nearest mask cell's country within one grid cell
            i, j = nearest_cell(lat, lng)
            best = None
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    ii, jj = i + di, (j + dj) % NLON
                    if 0 <= ii < NLAT and mask[ii, jj] != NONE:
                        d = (LATS[ii] - lat) ** 2 + (((LONS[jj] - lng + 180) % 360 - 180) * np.cos(np.radians(lat))) ** 2
                        if best is None or d < best[0]:
                            best = (d, int(mask[ii, jj]))
            owner = best[1] if best else None
        if owner is None:
            continue
        by_country.setdefault(owner, []).append({
            "name": pr["name"], "lat": round(lat, 4), "lng": round(lng, 4), "pop": int(pr.get("pop_max") or 0),
            "capital": bool(pr.get("adm0cap")),
        })
    cities = []
    for idx in sorted(by_country):
        lst = sorted(by_country[idx], key=lambda c: (not c["capital"], -c["pop"], c["name"]))[:MAX_CITIES]
        for c in lst:
            i, j = nearest_cell(c["lat"], c["lng"])
            cities.append({"id": len(cities), "name": c["name"], "country": idx, "lat": c["lat"], "lng": c["lng"],
                           "pop": c["pop"], "capital": c["capital"], "cell": [float(LATS[i]), float(LONS[j])]})
    return cities


# ---- series --------------------------------------------------------------------------------------------------------

def load_grid(var):
    """float64 [45][361][576], rounded to 2 decimals exactly as compute.py does."""
    return np.round(np.load(os.path.join(config.CACHE_DIR, f"{var}_annual.npy")).astype(np.float64), 2)


def to_int16(values):
    """values [n][45] float -> Int16 round(v*100), NaN -> -32768. Raises if anything would overflow."""
    v = np.asarray(values, dtype=np.float64)
    nan = np.isnan(v)
    q = np.rint(np.where(nan, 0.0, v) * 100.0)
    if np.abs(q).max() > 32767:
        raise ValueError("Int16 overflow")
    return np.where(nan, MISSING, q).astype("<i2")


def write_all(countries, mask, recs, cities):
    out = config.WEB_DATA_DIR
    os.makedirs(out, exist_ok=True)
    mask.tofile(os.path.join(out, "country_mask.bin"))
    with open(os.path.join(out, "countries.json"), "w") as f:
        json.dump(recs, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(out, "cities.json"), "w") as f:
        json.dump(cities, f, separators=(",", ":"), ensure_ascii=False)
    ci = np.array([c["cell"][0] for c in cities]), np.array([c["cell"][1] for c in cities])
    ci = (np.rint((ci[0] - LAT0) / DLAT).astype(int), np.rint((ci[1] - LON0) / DLON).astype(int))
    sizes = {}
    for var in config.VARIABLES:
        grid = load_grid(var)
        d = os.path.join(out, "countries", var)
        os.makedirs(d, exist_ok=True)
        total, files = 0, 0
        for rec in recs:
            i, j = country_cell_indices(mask, rec)
            arr = to_int16(grid[:, i, j].T)
            arr.tofile(os.path.join(d, f"{rec['idx']}.bin"))
            total += arr.nbytes
            files += 1
        carr = to_int16(grid[:, ci[0], ci[1]].T)
        carr.tofile(os.path.join(out, f"{var}_cities.bin"))
        sizes[var] = (files, total, carr.nbytes)
        print(f"{var}: {files} country files, {total} bytes ({total / 1e6:.2f} MB); "
              f"{var}_cities.bin {carr.nbytes} bytes; Int16 range OK")
    return sizes


def weighted_mean_series(lat, series):
    """cos(lat)-weighted mean per year over cells [n][45]; a cell with any NaN year is dropped. -> (series, n kept)"""
    ok = ~np.isnan(series).any(axis=1)
    w = np.cos(np.radians(lat[ok]))
    if not ok.any():
        return np.full(series.shape[1], np.nan), 0
    return np.array([sum(wk * vk for wk, vk in zip(w, series[ok][:, y])) / w.sum() for y in range(series.shape[1])]), int(ok.sum())


def build_fixture(recs, mask):
    tiny = [r for r in recs if r["tiny"]]
    pick = next((r for r in tiny if r["name"] == "Monaco"), None)
    cases = []
    names = FIXTURE_COUNTRIES + [pick["name"] if pick else tiny[0]["name"]]
    years = list(range(1981, 2026))
    for name in names:
        rec = next(r for r in recs if r["name"] == name)
        for var in config.VARIABLES:
            raw = np.fromfile(os.path.join(config.WEB_DATA_DIR, "countries", var, f"{rec['idx']}.bin"), dtype="<i2")
            raw = raw.reshape(rec["nCells"], 45)
            vals = np.where(raw == MISSING, np.nan, raw / 100.0)
            i, _ = country_cell_indices(mask, rec)
            lat = LATS[i]
            ser, nk = weighted_mean_series(lat, vals)
            t = trend_1d(ser, np.array(years, dtype=np.float64)) if nk else None
            cases.append({
                "variable": var, "idx": rec["idx"], "name": rec["name"], "nCells": rec["nCells"], "nCellsUsed": nk,
                "series": [float(v) for v in ser],
                "trend": None if t is None else {"slopeDecade": 10.0 * t["slope"], "ciLowDecade": 10.0 * t["ci_low"],
                                                  "ciHighDecade": 10.0 * t["ci_high"], "p": t["p"]},
            })
    with open(FIXTURE, "w") as f:
        json.dump({"years": years, "cases": cases}, f)
    print(f"wrote {FIXTURE} ({len(cases)} cases: {names})")


def main():
    countries = load_countries()
    mask = build_mask(countries)
    recs = build_records(countries, mask)
    cities = assign_cities(countries, mask, recs)
    print(f"{len(countries)} countries, {int((mask != NONE).sum())} land cells in the mask, "
          f"{sum(r['tiny'] for r in recs)} tiny, {sum(bool(r.get('wraps')) for r in recs)} wrapping, "
          f"{len(cities)} cities")
    sizes = write_all(countries, mask, recs, cities)
    tot_files = sum(v[0] for v in sizes.values()) + 3 * 1 + 3  # country files + 3 city bins + mask/countries/cities
    tot_bytes = sum(v[1] + v[2] for v in sizes.values())
    for name in ("country_mask.bin", "countries.json", "cities.json"):
        tot_bytes += os.path.getsize(os.path.join(config.WEB_DATA_DIR, name))
    print(f"total new data: {tot_bytes} bytes ({tot_bytes / 1e6:.2f} MB) in {tot_files} files")
    build_fixture(recs, mask)


if __name__ == "__main__":
    main()
