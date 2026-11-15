"""MODIS Terra monthly snow cover (MOD10CM-based, percent) from NASA GIBS WMTS tiles -> yearly 1-degree record.

Source: NASA GIBS layer MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct (public, no sign-in). The NEO site that used to
serve MOD10C1_M_SNOW as CSV was decommissioned in September 2026, and the NSIDC / LP DAAC files need an Earthdata login.
GIBS serves palette-indexed PNG tiles; the palette index of each pixel maps (through the layer's published colormap XML)
back to the stored data value: 0..100 = percent snow cover, 200 missing, 201 no decision, 211 night, 237 inland water,
239 ocean, 250 cloud, 254 detector saturated, 255 fill. No colour/quantisation guess is involved: every value 1..100 has
its own colour, and value 0 (snow-free land) is its own palette entry, distinct from water / no data.

URL pattern (tile matrix set 2km, level 2 = 0.140625 deg per pixel, 5 x 3 tiles of 512 px, only the top 1280 rows used):
  https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct/default/YYYY-MM-01/2km/2/ROW/COL.png

Run from R/pipeline:  .venv/bin/python instruments/modis_snow.py     (second run is offline from cache/inst_raw/modis_snow)
"""
import calendar
import http.client
import io
import os
import re
import sys
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PIPE = os.path.dirname(HERE)
RAW = os.path.join(PIPE, "cache", "inst_raw", "modis_snow")
OUT = os.path.join(PIPE, "cache", "inst_modis_snow.npz")
HOST = "gibs.earthdata.nasa.gov"
LAYER = "MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct"
CAPS = f"/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml"
CMAP = "/colormaps/v1.3/MODIS_NDSI_Snow_Cover.xml"
UA = {"User-Agent": "trend-detective-pipeline (research, non-commercial)"}
LEVEL = 2
NCOL, NROW = 5, 3          # tiles at level 2
TILE = 512
PIX = 360.0 / (NCOL * TILE)  # 0.140625 deg
NPX_LAT = int(round(180.0 / PIX))  # 1280
NPX_LON = NCOL * TILE              # 2560
Y0, Y1 = 2001, 2025

_tl = threading.local()


def _conn():
    c = getattr(_tl, "c", None)
    if c is None:
        c = _tl.c = http.client.HTTPSConnection(HOST, timeout=60)
    return c


def get(path, tries=6):
    last = None
    for k in range(tries):
        try:
            c = _conn()
            c.request("GET", path, headers=UA)
            r = c.getresponse()
            body = r.read()
            if r.status == 200:
                return body
            last = f"HTTP {r.status}"
            _tl.c = None
            if r.status == 404:
                raise FileNotFoundError(path)
        except FileNotFoundError:
            raise
        except Exception as e:  # noqa: BLE001
            last = repr(e)
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
            _tl.c = None
        time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"could not fetch {path}: {last}")


def cached(rel, path):
    f = os.path.join(RAW, rel)
    if os.path.exists(f):
        return open(f, "rb").read()
    os.makedirs(os.path.dirname(f), exist_ok=True)
    b = get(path)
    with open(f + ".part", "wb") as fh:
        fh.write(b)
    os.replace(f + ".part", f)
    return b


def available_months():
    """Months the layer offers, from its WMTS capabilities Time dimension (cached as a small text file)."""
    f = os.path.join(RAW, "time_values.txt")
    if not os.path.exists(f):
        caps = get(CAPS).decode("utf8")
        i = caps.index(f"<ows:Identifier>{LAYER}</ows:Identifier>")
        s = caps.rfind("<Layer>", 0, i)
        e = caps.index("</Layer>", i)
        vals = re.findall(r"<Value>([^<]*)</Value>", caps[s:e])
        os.makedirs(RAW, exist_ok=True)
        open(f, "w").write("\n".join(vals) + "\n")
    months = set()
    for v in open(f).read().split():
        a, b, _p = v.split("/")
        y, m = int(a[:4]), int(a[5:7])
        y2, m2 = int(b[:4]), int(b[5:7])
        while (y, m) <= (y2, m2):
            months.add((y, m))
            m += 1
            if m == 13:
                y, m = y + 1, 1
    return months


def code_lookup():
    """rgb -> stored data value, from the layer's colormap XML."""
    xml = cached("colormap_MODIS_NDSI_Snow_Cover.xml", CMAP)
    root = ET.fromstring(xml)
    lut = {}
    for el in root.iter("ColorMapEntry"):
        rgb = tuple(int(x) for x in el.get("rgb").split(","))
        v = int(el.get("sourceValue").strip("[]"))
        if rgb in lut and lut[rgb] != v:
            raise ValueError(f"colour {rgb} is ambiguous")
        lut[rgb] = v
    return lut


def tile_codes(png, lut):
    im = Image.open(io.BytesIO(png))
    if im.mode != "P":
        raise ValueError("expected a palette PNG, got " + im.mode)
    pal = np.array(im.getpalette(), dtype=np.int64).reshape(-1, 3)
    table = np.full(256, -1, dtype=np.int16)
    for k in range(len(pal)):
        table[k] = lut.get(tuple(int(x) for x in pal[k]), -1)
    a = np.array(im)
    used = np.unique(a)
    if np.any(table[used] < 0):
        raise ValueError(f"palette entries {used[table[used] < 0]} not in the colormap")
    return table[a]


def fetch_month(args):
    y, m = args
    ds = f"{y:04d}-{m:02d}-01"
    out = {}
    for r in range(NROW):
        for c in range(NCOL):
            rel = f"L{LEVEL}/{ds}/{r}_{c}.png"
            out[(r, c)] = cached(rel, f"/wmts/epsg4326/best/{LAYER}/default/{ds}/2km/{LEVEL}/{r}/{c}.png")
    return (y, m), out


def month_field(tiles, lut):
    """[1280][2560] int16 stored data values of one month."""
    full = np.empty((NROW * TILE, NCOL * TILE), dtype=np.int16)
    for (r, c), png in tiles.items():
        full[r * TILE:(r + 1) * TILE, c * TILE:(c + 1) * TILE] = tile_codes(png, lut)
    return full[:NPX_LAT]


def overlap(npx, pix, origin, ncell, cell):
    """[ncell][npx] fraction of each pixel's extent (pixel k covers origin+k*pix ...) lying in each output cell."""
    edges = origin + np.arange(npx + 1) * pix
    W = np.zeros((ncell, npx))
    for i in range(ncell):
        lo, hi = origin + i * cell, origin + (i + 1) * cell
        a = np.clip(np.minimum(edges[1:], hi) - np.maximum(edges[:-1], lo), 0, None)
        W[i] = a / pix
    return W


def main():
    os.makedirs(RAW, exist_ok=True)
    t0 = time.time()
    lut = code_lookup()
    avail = available_months()
    months = [(y, m) for y in range(Y0, Y1 + 1) for m in range(1, 13)]
    have = [ym for ym in months if ym in avail]
    gaps = [ym for ym in months if ym not in avail]
    print(f"months requested {len(months)}, offered by the layer {len(have)}, not offered {gaps}")

    # latitude of pixel rows runs 90 -> -90; build lat-ascending weights
    lat_px = 90.0 - (np.arange(NPX_LAT) + 0.5) * PIX
    cosw = np.cos(np.deg2rad(lat_px))
    Wlat = overlap(NPX_LAT, PIX, -90.0, 180, 1.0)[:, ::-1]   # rows of Wlat: ascending 1-deg cell; columns: pixel row top->bottom
    Wlon = overlap(NPX_LON, PIX, -180.0, 360, 1.0)
    Wlat_c = Wlat * cosw[None, :]
    tot_area = Wlat_c.sum(1)[:, None] * Wlon.sum(1)[None, :]  # [180][360]

    nyears = Y1 - Y0 + 1
    mval = np.full((nyears, 12, 180, 360), np.nan, dtype=np.float32)
    classes = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for k, ((y, m), tiles) in enumerate(ex.map(fetch_month, have)):
            f = month_field(tiles, lut)
            for v in np.unique(f):
                classes[int(v)] = classes.get(int(v), 0) + int((f == v).sum())
            valid = (f >= 0) & (f <= 100)
            val = np.where(valid, f, 0).astype(np.float64)
            num = Wlat_c @ (val * valid) @ Wlon.T
            den = Wlat_c @ valid.astype(np.float64) @ Wlon.T
            with np.errstate(invalid="ignore", divide="ignore"):
                mean = num / den
            ok = den >= 0.5 * tot_area
            mval[y - Y0, m - 1] = np.where(ok, mean, np.nan)
            if k % 24 == 0:
                print(f"  {y}-{m:02d} done ({k + 1}/{len(have)})  {time.time() - t0:.0f}s", flush=True)
    print("pixel counts by stored value class (all months, 0..100 merged):")
    snow = sum(n for v, n in classes.items() if v <= 100)
    names = {200: "missing", 201: "no decision", 211: "night", 237: "inland water", 239: "ocean", 250: "cloud",
             254: "saturated", 255: "fill"}
    print(f"  0..100 (land with observation): {snow}")
    for v in sorted(k for k in classes if k > 100):
        print(f"  {v} {names.get(v, '?')}: {classes[v]}")

    years = np.arange(Y0, Y1 + 1, dtype=np.int32)
    days = np.array([[calendar.monthrange(int(y), m)[1] for m in range(1, 13)] for y in years], dtype=np.float64)
    present = np.isfinite(mval)
    n_months = present.sum(1).astype(np.int8)
    d = days[:, :, None, None]
    s = np.where(present, mval, 0.0) * d
    dw = (present * d).sum(1)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean_any = s.sum(1) / dw
    annual = np.where(n_months == 12, mean_any, np.nan).astype(np.float32)
    annual_any = np.where(n_months >= 6, mean_any, np.nan).astype(np.float32)

    np.savez_compressed(
        OUT, annual=annual, annual_any=annual_any, years=years,
        lat=-89.5 + np.arange(180, dtype=np.float64), lon=-179.5 + np.arange(360, dtype=np.float64),
        n_months=n_months,
        units="percent of land cell covered by snow (0-100), yearly mean of monthly means weighted by days in month",
        source=("NASA GIBS WMTS layer MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct (MOD10CM-based Terra MODIS monthly snow "
                "cover, percent), palette PNG tiles decoded through the layer colormap "
                "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDSI_Snow_Cover.xml ; tiles: "
                "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct/default/"
                "YYYY-MM-01/2km/2/ROW/COL.png ; months the layer does not offer: " + ", ".join(f"{y}-{m:02d}" for y, m in gaps)),
        native=("GIBS tile matrix 2km level 2 (0.140625 deg pixels, resampled by GIBS from the 0.05 deg CMG grid of the "
                "monthly product; stored values 0-100 percent, 200 missing, 201 no decision, 211 night, 237 inland water, "
                "239 ocean, 250 cloud, 254 saturated, 255 fill); regridded to 1 deg by cos-lat area-weighted mean of "
                "observed-land pixels (fractional pixel overlap), cell valid if observed land covers >= half of the "
                "cell's native area (so cells that are mostly water are empty); annual = all 12 months present, "
                "annual_any = >= 6 months present"),
    )
    print(f"wrote {OUT}  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    sys.exit(main())
