"""Export web/public/data/summary.bin (+ summary.json): for every cell of the coarse annual grid and every variable the
Theil-Sen slope per decade, the Mann-Kendall p-value and the Benjamini-Hochberg adjusted p-value for the full
1981-2025 period. It feeds the "what is changing here?" ranking (web/src/whatsChanging.ts).

Grid and values are exactly what {VAR}_annual.bin ships (288 x 181, 1.25 x 1.0 deg; products.coarse_stack -> to_int16 ->
from_int16, so the Int16 quantisation of the shipped file is included). Statistics come from trendstats.py (trend_grid,
bh_adjust); BH is taken across the cells WITH data of that variable. Nothing is reimplemented here.

summary.bin (little endian), per variable in config.VARIABLES order, each block starting at the offset in summary.json:
  bitmap  ceil(nlat*nlon/8) bytes, bit k (LSB first of byte k>>3) = 1 when cell k = lat_index * nlon + lon_index has data
  slope   Float32[n]  Theil-Sen slope per decade, in the displayed unit (percent variables in percentage points)
  p       Float32[n]  Mann-Kendall p-value (two-sided, lag-1 Hamed-Rao corrected like everywhere else)
  q       Uint16[n]   round(BH-adjusted p * 65535)
  (n = number of set bits, rows in increasing cell order; every block is padded to a multiple of 4 bytes)
It also writes tests/fixtures/summary_cases.json: the float64 values of three places (the acceptance places), straight
from the arrays before any quantisation, for the browser test of the shipped file.
"""
import json
import os

import numpy as np

import config
from export_wind import DLAT, DLON, NLAT, NLON
from products import coarse_stack, from_int16, load_grid, rules, to_int16
from trendstats import bh_adjust, trend_grid

PLACES = {"Istanbul": (41.01, 28.97), "Cebu": (10.32, 123.89), "Porto Velho": (-8.76, -63.90)}
FIXTURE = os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "summary_cases.json")
SPREAD_PERCENTILE = 98.0
CELL_KM = 100


def coarse_values(var):
    """float64 [45][181][288] exactly as {var}_annual.bin decodes (NaN = no data)."""
    off = rules(var)[1]
    return from_int16(to_int16(coarse_stack(load_grid(var, exact=True)), off), off)


def coarse_trends(var):
    """(slope_decade, p, q) float64 (181, 288) arrays; NaN where the cell has no data."""
    t = np.array(config.YEARS, dtype=np.float64)
    res = trend_grid(coarse_values(var), t)
    return 10.0 * res["slope"], res["p"], bh_adjust(res["p"])


def nearest_cell(lat, lng):
    return int(round((lat + 90.0) / DLAT)), int(round((lng + 180.0) / DLON)) % NLON


def pack(slope, p, q):
    ok = np.isfinite(slope) & np.isfinite(p)
    flat = ok.ravel()
    bitmap = np.packbits(flat, bitorder="little").tobytes()
    s = slope.ravel()[flat].astype("<f4")
    pp = p.ravel()[flat].astype("<f4")
    qq = np.rint(q.ravel()[flat] * 65535.0).astype("<u2")
    return bitmap, s, pp, qq, int(flat.sum())


def main():
    meta_vars, blobs, offset, fixture = [], [], 0, {n: {} for n in PLACES}
    for var, cfg in config.VARIABLES.items():
        slope, p, q = coarse_trends(var)
        bitmap, s, pp, qq, n = pack(slope, p, q)
        spread = float(np.percentile(np.abs(slope[np.isfinite(slope)]), SPREAD_PERCENTILE))
        rec = {"variable": var, "label": cfg["label"], "units": cfg["units"], "unitsPerDecade": cfg["units_per_decade"],
               "unitsShort": cfg.get("units_short", cfg["units"]), "group": cfg["group"], "surface": cfg.get("surface", "any"),
               "count": n, "spread": spread}
        for name, arr in (("bitmap", np.frombuffer(bitmap, dtype=np.uint8)), ("slope", s), ("p", pp), ("q", qq)):
            raw = arr.tobytes()
            raw += b"\0" * (-len(raw) % 4)
            rec[name + "Offset"] = offset
            blobs.append(raw)
            offset += len(raw)
        meta_vars.append(rec)
        for name, (la, lo) in PLACES.items():
            i, j = nearest_cell(la, lo)
            ok = bool(np.isfinite(slope[i, j]))
            fixture[name][var] = {"slope": float(slope[i, j]), "p": float(p[i, j]), "q": float(q[i, j])} if ok else None
        print(f"{var}: {n} of {NLAT * NLON} cells with data, spread (p{SPREAD_PERCENTILE:g} of |slope|/decade) {spread:.4g}, "
              f"max |slope| {np.nanmax(np.abs(slope)):.4g}")
    os.makedirs(config.WEB_DATA_DIR, exist_ok=True)
    with open(os.path.join(config.WEB_DATA_DIR, "summary.bin"), "wb") as f:
        f.write(b"".join(blobs))
    meta = {"nlat": NLAT, "nlon": NLON, "lat0": -90.0, "dlat": DLAT, "lon0": -180.0, "dlon": DLON,
            "years": [config.YEARS[0], config.YEARS[-1]], "cellKm": CELL_KM, "bytes": offset,
            "spreadPercentile": SPREAD_PERCENTILE, "variables": meta_vars}
    with open(os.path.join(config.WEB_DATA_DIR, "summary.json"), "w") as f:
        json.dump(meta, f, indent=1)
    cases = {"grid": {"nlat": NLAT, "nlon": NLON, "dlat": DLAT, "dlon": DLON},
             "places": {n: {"lat": PLACES[n][0], "lng": PLACES[n][1], "cell": list(nearest_cell(*PLACES[n])),
                            "variables": v} for n, v in fixture.items()}}
    with open(FIXTURE, "w") as f:
        json.dump(cases, f, indent=1)
    print(f"wrote summary.bin ({offset} bytes = {offset / 1e6:.2f} MB), summary.json, {os.path.relpath(FIXTURE, config.PIPELINE_DIR)}")


if __name__ == "__main__":
    main()
