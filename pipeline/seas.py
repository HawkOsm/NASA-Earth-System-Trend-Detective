"""Sea and ocean view data: which sea each water cell belongs to, each sea's cell series and outline.

Inputs (offline): Natural Earth marine areas (pipeline/data/ne_50m_geography_marine_polys.geojson, public domain),
web/public/data/country_mask.bin (a cell is WATER where it is 255) and the cached annual grids
(cache/{VAR}_annual.npy). Nothing in the country data is changed.

Outputs in web/public/data:
  sea_mask.bin                  Uint8 [361 lat ascending][576 lon], sea index or 255 (land, or water in no polygon)
  seas.json                     one record per GeoJSON feature (idx = index in the features array)
  seas/{idx}.cells.bin          Float32 LE pairs [lat, lng] per cell (lat ascending, then lng ascending)
  seas/{VAR}/{idx}.bin          Int16 LE [nCells][45], value = round(v * 100), NaN = -32768
  seas/outlines.json            {idx: [polygon: [ring: [[lng, lat], ...]]]}, Douglas-Peucker 0.05 deg, 3 decimals
and tests/fixtures/sea_cases.json (reference sea means for the browser tests).

A sea with at most FULL_MAX full-resolution cells keeps those cells (0.5 x 0.625 deg). A larger one (the oceans) is
stored on the coarse 1.0 x 1.25 deg grid of export_annual_grid.py (same block averaging).

Run from the pipeline directory:  .venv/bin/python seas.py
"""
import json
import os

import numpy as np

import basemap
import config
import countries as C
import products
from export_wind import DLAT as CDLAT, DLON as CDLON, NLAT as CNLAT, NLON as CNLON
from trendstats import trend_1d

MARINE_JSON = os.path.join(config.PIPELINE_DIR, "data", "ne_50m_geography_marine_polys.geojson")
FIXTURE = os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "sea_cases.json")
OUT = os.path.join(config.WEB_DATA_DIR)

NLAT, NLON, LAT0, DLAT, LON0, DLON, NONE, MISSING = C.NLAT, C.NLON, C.LAT0, C.DLAT, C.LON0, C.DLON, C.NONE, C.MISSING
FULL_MAX = 4000
SIMPLIFY_DEG = 0.05
FIXTURE_SEAS = ["Black Sea", "Mediterranean Sea", "North Pacific Ocean", "Southern Ocean"]
TITLE_CASE = {"SOUTHERN OCEAN": "Southern Ocean", "INDIAN OCEAN": "Indian Ocean"}


# ---- outlines ----------------------------------------------------------------------------------------------------

def load_seas():
    """[ {name, kind, polys: [[outer, hole, ...] as float arrays (lng, lat)], area} ] in features-array order.
    The polygons are already cut at +-180 (each part lies inside -180..180), so no unwrapping is needed."""
    with open(MARINE_JSON) as f:
        feats = json.load(f)["features"]
    out = []
    for ft in feats:
        g = ft["geometry"]
        parts = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        polys = [[np.array(r, dtype=np.float64) for r in poly] for poly in parts]
        area = sum(basemap.ring_area(p[0]) - sum(basemap.ring_area(h) for h in p[1:]) for p in polys)
        name = ft["properties"]["name"]
        out.append({"name": TITLE_CASE.get(name, name), "kind": ft["properties"]["featurecla"], "polys": polys, "area": float(area)})
    return out


def build_sea_mask(seas, country_mask):
    """Uint8 [lat][lon]: for every water cell (country mask 255) the sea whose polygon contains the cell centre; where
    several do, the one with the smallest area. Everything else 255."""
    water = country_mask == NONE
    mask = np.full((NLAT, NLON), NONE, dtype=np.uint8)
    # Largest first, so that a smaller polygon overwrites the larger one it lies in.
    for idx in sorted(range(len(seas)), key=lambda k: (-seas[k]["area"], k)):
        for poly in seas[idx]["polys"]:
            x0, y0 = poly[0][:, 0].min(), poly[0][:, 1].min()
            x1, y1 = poly[0][:, 0].max(), poly[0][:, 1].max()
            i0, i1 = max(int(np.ceil((y0 - LAT0) / DLAT)), 0), min(int(np.floor((y1 - LAT0) / DLAT)), NLAT - 1)
            j0, j1 = max(int(np.ceil((x0 - LON0) / DLON)), 0), min(int(np.floor((x1 - LON0) / DLON)), NLON - 1)
            if i1 < i0 or j1 < j0:
                continue
            gi, gj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1), indexing="ij")
            # A centre exactly on the -180 edge is tested a hair inside, so the cut polygons cover it.
            pts = np.column_stack([np.maximum(C.LONS[gj.ravel()], LON0 + 1e-6), C.LATS[gi.ravel()]])
            ins = C.contains(poly, pts).reshape(gi.shape)
            sub = mask[i0:i1 + 1, j0:j1 + 1]
            sub[ins & water[i0:i1 + 1, j0:j1 + 1]] = idx
    return mask


def sea_at(mask, lat, lng):
    i, j = C.nearest_cell(lat, lng)
    return int(mask[i, j])


def douglas_peucker(pts, eps):
    """Douglas-Peucker on an open polyline [n][2]; returns the kept points (ends always kept)."""
    n = len(pts)
    if n <= 2:
        return pts
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        seg = q - p
        d2 = float(seg @ seg)
        mid = pts[a + 1:b] - p
        if d2 < 1e-18:
            dist = np.hypot(mid[:, 0], mid[:, 1])
        else:
            dist = np.abs(mid[:, 0] * seg[1] - mid[:, 1] * seg[0]) / np.sqrt(d2)
        k = int(np.argmax(dist))
        if dist[k] > eps:
            keep[a + 1 + k] = True
            stack.append((a, a + 1 + k))
            stack.append((a + 1 + k, b))
    return pts[keep]


def simplify_ring(ring, eps=SIMPLIFY_DEG):
    """A closed ring simplified; split at the point farthest from the start so the closing edge is not degenerate."""
    r = ring[:-1] if np.allclose(ring[0], ring[-1]) else ring
    if len(r) < 4:
        return np.vstack([r, r[:1]])
    far = int(np.argmax(np.hypot(*(r - r[0]).T)))
    a = douglas_peucker(r[:far + 1], eps)
    b = douglas_peucker(np.vstack([r[far:], r[:1]]), eps)
    out = np.vstack([a, b[1:]])  # ends at r[0] again
    return out if len(out) >= 4 else np.vstack([r, r[:1]])


def outlines_json(seas):
    out = {}
    for idx, s in enumerate(seas):
        out[str(idx)] = [[np.round(simplify_ring(r), 3).tolist() for r in poly] for poly in s["polys"]]
    return out


# ---- cells ---------------------------------------------------------------------------------------------------------

def sea_cells(sea_mask, idx):
    """(lat, lng, dlat, dlng, coarse) of one sea's cells, lat ascending then lng ascending."""
    i, j = np.nonzero(sea_mask == idx)
    if len(i) <= FULL_MAX:
        return C.LATS[i], C.LONS[j], DLAT, DLON, False
    # Coarse grid point (ci, cj) sits at full-resolution row 2*ci, column 2*cj (lat -90 + ci, lng -180 + 1.25 cj).
    ci, cj = np.nonzero(sea_mask[0::2, 0::2][:CNLAT, :CNLON] == idx)
    return -90.0 + CDLAT * ci, -180.0 + CDLON * cj, CDLAT, CDLON, True


def frame_info(lng, dlng):
    """(wraps, [lngMin, lngMax] in the unwrapped frame). A sea with cells in the first and the last column sits on
    both sides of +-180; its frame starts after its largest longitude gap. A sea that goes right round the globe
    has no gap to cut at, so it is not 'wrapping' and keeps -180..180."""
    u = np.unique(lng)
    both = u.min() <= LON0 + 0.5 * dlng and u.max() >= 180.0 - 1.5 * dlng
    if not both:
        return False, [float(u.min()), float(u.max())]
    gaps = np.diff(np.concatenate([u, [u[0] + 360.0]]))
    k = int(np.argmax(gaps))
    if gaps[k] <= 3 * dlng:
        return False, [float(u.min()), float(u.max())]
    start = u[(k + 1) % len(u)]
    return True, [float(start), float(u[k] + 360.0)]


def build_records(seas, sea_mask):
    recs, cells = [], []
    for idx, s in enumerate(seas):
        lat, lng, dlat, dlng, coarse = sea_cells(sea_mask, idx)
        n = len(lat)
        rec = {"idx": idx, "name": s["name"], "kind": s["kind"], "nCells": int(n), "dlat": dlat, "dlng": dlng}
        if n == 0:
            allp = np.concatenate([p[0] for p in s["polys"]])
            b = [float(allp[:, 1].min()), float(allp[:, 1].max()), float(allp[:, 0].min()), float(allp[:, 0].max())]
            rec.update(bbox=[round(v, 4) for v in b], centre=[round((b[0] + b[1]) / 2, 4), round((b[2] + b[3]) / 2, 4)], wraps=False)
        else:
            wraps, (l0, l1) = frame_info(lng, dlng)
            ulng = np.where(lng < l0, lng + 360.0, lng) if wraps else lng
            la0, la1 = float(lat.min()), float(lat.max())
            # A water cell near the middle of the frame.
            d = (lat - 0.5 * (la0 + la1)) ** 2 + ((ulng - 0.5 * (l0 + l1)) * np.cos(np.radians(0.5 * (la0 + la1)))) ** 2
            k = int(np.argmin(d))
            rec.update(bbox=[la0, la1, l0, l1], centre=[float(lat[k]), float((lng[k] + 180.0) % 360.0 - 180.0)], wraps=wraps)
        recs.append(rec)
        cells.append((lat, lng, coarse))
    return recs, cells


# ---- series --------------------------------------------------------------------------------------------------------

def series_for(var, grid, mask_cells):
    """Int16-ready values [n][45] (float, rounded to 2 decimals) for one sea; coarse seas use block means."""
    lat, lng, coarse = mask_cells
    if not coarse:
        i = np.rint((lat - LAT0) / DLAT).astype(int)
        j = np.rint((lng - LON0) / DLON).astype(int)
        return grid[:, i, j].T
    i = np.rint((lat + 90.0) / CDLAT).astype(int)
    j = np.rint((lng + 180.0) / CDLON).astype(int)
    return np.round(coarse_grid(grid)[:, i, j].T, 2)


_coarse = {}


def coarse_grid(grid):
    key = id(grid)
    if key not in _coarse:
        _coarse.clear()
        _coarse[key] = products.coarse_stack(grid)  # missing-aware block mean, shared with export_annual_grid.py
    return _coarse[key]


def write_all(recs, cells, sea_mask, outlines):
    os.makedirs(os.path.join(OUT, "seas"), exist_ok=True)
    sea_mask.tofile(os.path.join(OUT, "sea_mask.bin"))
    with open(os.path.join(OUT, "seas.json"), "w") as f:
        json.dump(recs, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(OUT, "seas", "outlines.json"), "w") as f:
        json.dump(outlines, f, separators=(",", ":"))
    for idx, (lat, lng, _) in enumerate(cells):
        if len(lat):
            np.column_stack([lat, lng]).astype("<f4").tofile(os.path.join(OUT, "seas", f"{idx}.cells.bin"))
    for var in config.VARIABLES:
        if not products.has_pieces(var, sea=True):
            print(f"{var}: surface '{products.surface(var)}', skipping the sea pieces (no data over open water)")
            continue
        d = os.path.join(OUT, "seas", var)
        os.makedirs(d, exist_ok=True)
        grid = C.load_grid(var)
        offset = products.rules(var)[1]
        for idx, mc in enumerate(cells):
            if len(mc[0]):
                C.to_int16(series_for(var, grid, mc), offset).tofile(os.path.join(d, f"{idx}.bin"))


def read_values(var, rec):
    raw = np.fromfile(os.path.join(OUT, "seas", var, f"{rec['idx']}.bin"), dtype="<i2").reshape(rec["nCells"], 45)
    return products.from_int16(raw, products.rules(var)[1])


def read_cells(rec):
    return np.fromfile(os.path.join(OUT, "seas", f"{rec['idx']}.cells.bin"), dtype="<f4").reshape(rec["nCells"], 2)


def build_fixture(recs):
    years = list(range(1981, 2026))
    cases = []
    for name in FIXTURE_SEAS:
        rec = next(r for r in recs if r["name"] == name)
        lat = read_cells(rec)[:, 0].astype(np.float64)
        for var in config.FIXTURE_VARIABLES:  # fixed list: the committed expected values do not change
            ser, nk = C.weighted_mean_series(lat, read_values(var, rec))
            t = trend_1d(ser, np.array(years, dtype=np.float64)) if nk else None
            cases.append({
                "variable": var, "idx": rec["idx"], "name": rec["name"], "nCells": rec["nCells"], "nCellsUsed": nk,
                "dlat": rec["dlat"], "dlng": rec["dlng"],
                "series": [float(v) for v in ser],
                "trend": None if t is None else {"slopeDecade": 10.0 * t["slope"], "ciLowDecade": 10.0 * t["ci_low"],
                                                  "ciHighDecade": 10.0 * t["ci_high"], "p": t["p"]},
            })
    with open(FIXTURE, "w") as f:
        json.dump({"years": years, "cases": cases}, f)
    print(f"wrote {FIXTURE} ({len(cases)} cases: {FIXTURE_SEAS})")


def main():
    seas = load_seas()
    cmask = np.fromfile(os.path.join(OUT, "country_mask.bin"), dtype=np.uint8).reshape(NLAT, NLON)
    sea_mask = build_sea_mask(seas, cmask)
    recs, cells = build_records(seas, sea_mask)
    water = int((cmask == NONE).sum())
    in_sea = int((sea_mask != NONE).sum())
    print(f"{len(seas)} seas; {water} water cells, {in_sea} in a sea, {water - in_sea} in no sea; "
          f"{sum(r['nCells'] == 0 for r in recs)} seas with no cell; {sum(r['wraps'] for r in recs)} wrapping")
    for r in recs:
        if r["dlat"] != DLAT:
            print(f"  coarse: {r['name']}: {r['nCells']} cells ({int((sea_mask == r['idx']).sum())} full-res), bbox {r['bbox']}, wraps {r['wraps']}")
    write_all(recs, cells, sea_mask, outlines_json(seas))
    build_fixture(recs)
    tot, files = 0, 0
    for root, _, names in os.walk(os.path.join(OUT, "seas")):
        for n in names:
            tot += os.path.getsize(os.path.join(root, n))
            files += 1
    for n in ("sea_mask.bin", "seas.json"):
        tot += os.path.getsize(os.path.join(OUT, n))
        files += 1
    print(f"total new data: {tot} bytes ({tot / 1e6:.2f} MB) in {files} files")


if __name__ == "__main__":
    main()
