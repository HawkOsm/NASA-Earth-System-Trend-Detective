"""Province / state outlines for the country view.

Input (offline, NOT stored in the repository): the Natural Earth admin-1 states and provinces file
ne_10m_admin_1_states_provinces.geojson (public domain), passed as the first argument:
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
It also needs the files written by countries.py (country_mask.bin, countries.json) and the world-atlas outlines.

Output: web/public/data/provinces/{country idx}.json for every country with at least two provinces:
  { "provinces": [ { "name", "type", "centre": [lat, lng], "rings": [[[lng, lat], ...], ...], "cells": [k, ...] } ] }
`cells` are indices into the country's cell list in mask order (the order of countries/{VAR}/{idx}.bin).
Rings are simplified (Douglas-Peucker, 0.02 degrees) and rounded to 3 decimals; each ring is continuous in longitude
(it may reach past +-180); the browser shifts a ring into the longitude frame of its country.

Run from the pipeline directory:  .venv/bin/python -m areas.provinces /path/to/ne_10m_admin_1_states_provinces.geojson
"""
import json
import os
import sys

import numpy as np

from maps import basemap
from core import config
from areas import countries as C

OUT_DIR = os.path.join(config.WEB_DATA_DIR, "provinces")
TOLERANCE = 0.02
MIN_BBOX = 0.05
DECIMALS = 3


# ---- geometry ------------------------------------------------------------------------------------------------------

def douglas_peucker(pts, tol):
    """Indices kept by Douglas-Peucker on an open polyline pts [n][2] (endpoints always kept)."""
    n = len(pts)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        seg = pts[a + 1:b]
        d = q - p
        L = float(np.hypot(d[0], d[1]))
        if L < 1e-12:
            dist = np.hypot(seg[:, 0] - p[0], seg[:, 1] - p[1])
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = a + 1 + k
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return np.nonzero(keep)[0]


def simplify_ring(ring, tol=TOLERANCE):
    """Simplify a closed ring (first point == last). Split at the point farthest from the start so that both halves
    are open polylines. Returns the closed simplified ring (may have fewer than 4 points)."""
    pts = ring[:-1] if np.allclose(ring[0], ring[-1]) else ring
    if len(pts) < 3:
        return np.vstack([pts, pts[:1]])
    far = int(np.argmax(np.hypot(pts[:, 0] - pts[0, 0], pts[:, 1] - pts[0, 1])))
    first = pts[:far + 1]
    second = np.vstack([pts[far:], pts[:1]])
    i1 = douglas_peucker(first, tol)
    i2 = douglas_peucker(second, tol)
    out = np.vstack([first[i1], second[i2][1:]])
    return out  # ends at pts[0] again, so it is closed


def clean_rings(rings):
    """Simplify, round, and drop tiny / degenerate rings. -> list of [[lng, lat], ...] (closed)."""
    out = []
    for r in rings:
        s = simplify_ring(r)
        if len(s) < 4:
            continue
        s = np.round(s, DECIMALS)
        s[-1] = s[0]
        if (s[:, 0].max() - s[:, 0].min()) < MIN_BBOX and (s[:, 1].max() - s[:, 1].min()) < MIN_BBOX:
            continue
        out.append([[float(x), float(y)] for x, y in s])
    return out


def geom_polys(geom):
    """GeoJSON geometry -> [[ring (continuous longitudes, closed), hole, ...], ...] as float arrays."""
    if geom is None:
        return []
    if geom["type"] == "Polygon":
        parts = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        parts = geom["coordinates"]
    else:
        return []
    polys = []
    for poly in parts:
        rings = []
        for r in poly:
            a = np.asarray(r, dtype=np.float64)[:, :2]
            if len(a) < 4:
                continue
            rings.append(C.continuous_lon(a))
        if rings:
            polys.append(rings)
    return polys


# ---- assignment ----------------------------------------------------------------------------------------------------

def owner_country(cpolys, boxes, mask, lng, lat):
    """Country idx whose polygon contains the point; else the nearest mask cell within one grid cell; else None."""
    for idx, polys in enumerate(cpolys):
        for poly, (x0, y0, x1, y1) in zip(polys, boxes[idx]):
            if not (y0 <= lat <= y1):
                continue
            for L in (lng, lng + 360.0):
                if x0 <= L <= x1 and C.contains(poly, np.array([[L, lat]]))[0]:
                    return idx
    i, j = C.nearest_cell(lat, lng)
    best = None
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ii, jj = i + di, (j + dj) % C.NLON
            if 0 <= ii < C.NLAT and mask[ii, jj] != C.NONE:
                d = (C.LATS[ii] - lat) ** 2 + (((C.LONS[jj] - lng + 180) % 360 - 180) * np.cos(np.radians(lat))) ** 2
                if best is None or d < best[0]:
                    best = (d, int(mask[ii, jj]))
    return best[1] if best else None


def cells_in_province(polys, clat, clng):
    """Boolean over the cell arrays (clat, clng): the cell centre lies in the province (holes respected)."""
    hit = np.zeros(len(clat), dtype=bool)
    for poly in polys:
        x0, y0, x1, y1 = C._bbox(poly[0])
        for sh in (0.0, 360.0, -360.0):
            L = clng + sh
            cand = np.nonzero((L >= x0) & (L <= x1) & (clat >= y0) & (clat <= y1) & ~hit)[0]
            if cand.size:
                ins = C.contains(poly, np.column_stack([L[cand], clat[cand]]))
                hit[cand[ins]] = True
    return hit


def in_country_box(ring, rec, pad=1.0):
    """A ring entirely outside the country's bounding box (+- pad degrees) is a remote island that the country piece
    would clip away anyway (the 50 m country outline lacks it); it is left out. Longitude is only tested for a country
    that does not wrap the antimeridian."""
    s, n, w, e = rec["bbox"]
    if ring[:, 1].max() < s - pad or ring[:, 1].min() > n + pad:
        return False
    if rec.get("wraps"):
        return True
    for sh in (0.0, 360.0, -360.0):
        if ring[:, 0].max() + sh >= w - pad and ring[:, 0].min() + sh <= e + pad:
            return True
    return False


def prop_name(pr):
    for k in ("name", "name_en", "gn_name"):
        v = pr.get(k)
        if v and str(v).strip():
            return str(v).strip()
    return None


def build(geojson_path, out_dir=OUT_DIR):
    with open(geojson_path) as f:
        feats = json.load(f)["features"]
    with open(os.path.join(config.WEB_DATA_DIR, "countries.json")) as f:
        recs = json.load(f)
    mask = np.fromfile(os.path.join(config.WEB_DATA_DIR, "country_mask.bin"), dtype=np.uint8).reshape(C.NLAT, C.NLON)
    countries = C.load_countries()
    cpolys = [c["polys"] for c in countries]
    boxes = [[C._bbox(p[0]) for p in polys] for polys in cpolys]

    by_country, dropped, noname = {}, 0, 0
    for ft in feats:
        pr = ft["properties"]
        name = prop_name(pr)
        if name is None:
            noname += 1
            continue
        polys = geom_polys(ft["geometry"])
        if not polys:
            dropped += 1
            continue
        big = max(polys, key=lambda p: basemap.ring_area(p[0]))
        px, py = C.inside_point(big)
        lng = (px + 180.0) % 360.0 - 180.0
        owner = owner_country(cpolys, boxes, mask, lng, py)
        if owner is None:
            dropped += 1
            continue
        by_country.setdefault(owner, []).append({
            "name": name, "type": (pr.get("type_en") or pr.get("type") or "").strip(), "centre": (py, lng),
            "polys": polys,
        })

    os.makedirs(out_dir, exist_ok=True)
    for fn in os.listdir(out_dir):
        if fn.endswith(".json"):
            os.remove(os.path.join(out_dir, fn))
    summary, total_bytes, files = {}, 0, 0
    for idx in sorted(by_country):
        lst = by_country[idx]
        if len(lst) < 2:
            continue
        rec = recs[idx]
        ci, cj = C.country_cell_indices(mask, rec)
        clat, clng = C.LATS[ci], C.LONS[cj]
        covered = np.zeros(len(clat), dtype=bool)
        out = []
        for pv in lst:
            hit = cells_in_province(pv["polys"], clat, clng)
            cells = [int(k) for k in np.nonzero(hit)[0]]
            if not cells:
                d = (clat - pv["centre"][0]) ** 2 + (((clng - pv["centre"][1] + 180) % 360 - 180) * np.cos(np.radians(pv["centre"][0]))) ** 2
                cells = [int(np.argmin(d))]
            covered[cells] = True
            rings = clean_rings([r for poly in pv["polys"] for r in poly if in_country_box(r, rec)])
            if not rings:
                continue
            out.append({"name": pv["name"], "type": pv["type"],
                        "centre": [round(pv["centre"][0], 3), round(pv["centre"][1], 3)], "rings": rings, "cells": cells})
        if len(out) < 2:
            continue
        path = os.path.join(out_dir, f"{idx}.json")
        with open(path, "w") as f:
            json.dump({"provinces": out}, f, separators=(",", ":"), ensure_ascii=False)
        total_bytes += os.path.getsize(path)
        files += 1
        summary[rec["name"]] = (len(out), int((~covered).sum()), len(clat))
    return {"files": files, "bytes": total_bytes, "dropped": dropped, "noname": noname, "n_features": len(feats),
            "summary": summary}


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: provinces.py /path/to/ne_10m_admin_1_states_provinces.geojson")
    r = build(sys.argv[1])
    print(f"{r['n_features']} admin-1 features; {r['dropped']} dropped (no country), {r['noname']} skipped (no name)")
    print(f"{r['files']} files, {r['bytes']} bytes ({r['bytes'] / 1e6:.2f} MB)")
    for name in ("Turkey", "Brazil", "Germany", "India", "United States of America", "Russia"):
        if name in r["summary"]:
            n, unc, nc = r["summary"][name]
            print(f"{name}: {n} provinces, {unc} of {nc} country cells not in any province")
        else:
            print(f"{name}: no file")


if __name__ == "__main__":
    main()
