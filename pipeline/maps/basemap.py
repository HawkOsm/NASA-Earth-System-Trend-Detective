"""Rasterise the Natural Earth land outline (npm package world-atlas, land-50m.json, public domain) to an
equirectangular RGB base map: web/public/data/basemap.png, 2304 x 1152, left edge -180, top +90.

The TopoJSON is decoded here directly (quantised, delta-encoded arcs; negative arc indices are reversed arcs).
Run from the pipeline directory:  .venv/bin/python -m maps.basemap
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw

from core import config

WIDTH, HEIGHT = 2304, 1152
SS = 2  # supersampling factor
LAND_JSON = os.path.join(os.path.dirname(config.PIPELINE_DIR), "web", "node_modules", "world-atlas", "land-50m.json")

# (name, lat, lon, is_land)
CHECKS = [
    ("Sahara", 23, 10, True), ("central Australia", -25, 134, True), ("Greenland", 73, -40, True),
    ("Antarctica", -80, 30, True), ("Amazon", -5, -60, True), ("Siberia", 62, 100, True),
    ("mid-Pacific", 0, -150, False), ("North Atlantic", 35, -40, False), ("Mediterranean", 35, 18, False),
    ("Caspian Sea", 42, 51, False), ("Indian Ocean", -20, 80, False), ("Arctic Ocean", 86, -160, False),
]


def decode_arcs(topo):
    """List of (n, 2) float arrays of [lon, lat] for every arc."""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    out = []
    for arc in topo["arcs"]:
        a = np.cumsum(np.asarray(arc, dtype=np.float64), axis=0)
        out.append(np.column_stack([a[:, 0] * sx + tx, a[:, 1] * sy + ty]))
    return out


def ring_coords(arcs, indices):
    """Join the arcs of one ring (negative index i = arc ~i reversed), dropping duplicated joint points."""
    pts = []
    for i in indices:
        a = arcs[~i][::-1] if i < 0 else arcs[i]
        pts.append(a if not pts else a[1:])
    return np.concatenate(pts, axis=0)


def polygons(topo):
    """[[outer_ring, hole_ring, ...], ...] of (n, 2) lon/lat arrays for all land geometries."""
    arcs = decode_arcs(topo)
    polys = []
    for obj in topo["objects"].values():
        geoms = obj["geometries"] if obj["type"] == "GeometryCollection" else [obj]
        for g in geoms:
            if g["type"] == "Polygon":
                parts = [g["arcs"]]
            elif g["type"] == "MultiPolygon":
                parts = g["arcs"]
            else:
                continue
            for poly in parts:
                polys.append([ring_coords(arcs, r) for r in poly])
    return polys


def ring_area(r):
    x, y = r[:, 0], r[:, 1]
    return abs(0.5 * np.sum(x[:-1] * y[1:] - x[1:] * y[:-1]))


def unwrap_ring(r):
    """Make longitudes continuous across the antimeridian (e.g. 179.9 -> -180 becomes 179.9 -> 180). Rings that do not
    close afterwards (the Antarctic outline, which circles the pole) are returned unchanged."""
    d = np.diff(r[:, 0])
    d = d - 360.0 * np.round(d / 360.0)
    lon = np.concatenate([[r[0, 0]], r[0, 0] + np.cumsum(d)])
    if abs(lon[-1] - lon[0]) > 1e-6 or np.allclose(lon, r[:, 0]):
        return r, False
    return np.column_stack([lon, r[:, 1]]), True


def to_px(r, w, h):
    return [(float(x), float(y)) for x, y in zip((r[:, 0] + 180.0) / 360.0 * w, (90.0 - r[:, 1]) / 180.0 * h)]


def render(topo, width=WIDTH, height=HEIGHT, ss=SS):
    w, h = width * ss, height * ss
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    # Largest first, so an island inside a lake inside a continent ends up land again.
    for poly in sorted(polygons(topo), key=lambda p: -ring_area(p[0])):
        rings = [unwrap_ring(r) for r in poly]
        moved = any(m for _, m in rings)
        outer = rings[0][0]
        if moved:  # put the outer ring at lon >= -180 and every hole into the same frame as the outer ring
            outer = outer + [360.0 * np.ceil((-180.0 - outer[:, 0].min()) / 360.0), 0.0]
        centre = 0.5 * (outer[:, 0].min() + outer[:, 0].max())
        todo = [outer]
        for hole, _ in rings[1:]:
            c = 0.5 * (hole[:, 0].min() + hole[:, 0].max())
            todo.append(hole + [360.0 * np.round((centre - c) / 360.0), 0.0] if moved else hole)
        for sh in ((0.0, -360.0) if moved else (0.0,)):  # a polygon crossing the antimeridian appears on both edges
            for k, r in enumerate(todo):
                d.polygon(to_px(r + [sh, 0.0], w, h), fill=255 if k == 0 else 0)
    # The Antarctica polygon stops at about 85.2 S (its pole closure is a degenerate hole): in every column
    # south of 60 S that has land, fill from the southernmost land pixel down to the bottom edge.
    m = np.asarray(mask).copy()
    r0 = int((90 + 60) / 180 * h)
    south = m[r0:] > 127
    has = south.any(axis=0)
    last = south.shape[0] - 1 - np.argmax(south[::-1], axis=0)
    idx = np.nonzero(has)[0]
    for c in range(m.shape[1]):  # a column without land (the sliver at +180) copies its nearest land column
        src = c if has[c] else idx[np.argmin(np.minimum(np.abs(idx - c), m.shape[1] - np.abs(idx - c)))]
        m[r0 + last[src]:, c] = 255
    mask = Image.fromarray(m, "L").resize((width, height), Image.LANCZOS)
    a = (np.asarray(mask, dtype=np.float64) / 255.0)[..., None]
    ocean = np.array(config.BASEMAP_OCEAN, dtype=np.float64)
    land = np.array(config.BASEMAP_LAND, dtype=np.float64)
    return np.round(ocean * (1 - a) + land * a).astype(np.uint8)


def pixel_at(img, lat, lon):
    h, w = img.shape[:2]
    return img[min(int((90 - lat) / 180 * h), h - 1), min(int((lon + 180) / 360 * w), w - 1)]


def self_check(img):
    """Print and return failures: land pixels must be land-coloured, water pixels ocean-coloured."""
    land = np.array(config.BASEMAP_LAND)
    ocean = np.array(config.BASEMAP_OCEAN)
    bad = []
    for name, la, lo, is_land in CHECKS:
        px = pixel_at(img, la, lo)
        ok = np.array_equal(px, land if is_land else ocean)
        print(f"{'land ' if is_land else 'water'} {name:18s} ({la:4d}, {lo:5d}) -> rgb {tuple(int(v) for v in px)} "
              f"{'OK' if ok else 'FAIL'}")
        if not ok:
            bad.append(name)
    print(f"bottom row all land-coloured: {bool((img[-1] == land).all())}")
    return bad


def main():
    with open(LAND_JSON) as f:
        topo = json.load(f)
    img = render(topo)
    os.makedirs(config.WEB_DATA_DIR, exist_ok=True)
    path = os.path.join(config.WEB_DATA_DIR, "basemap.png")
    Image.fromarray(img, "RGB").save(path, optimize=True)
    print(f"wrote {path} ({img.shape[1]}x{img.shape[0]}, {os.path.getsize(path)} bytes)")
    bad = self_check(img)
    if bad:
        raise SystemExit(f"self-check failed: {bad}")


if __name__ == "__main__":
    main()
