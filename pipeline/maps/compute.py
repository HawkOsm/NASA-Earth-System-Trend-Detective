"""Compute per-cell trend statistics for one cached variable."""
import argparse
import os
import time

import numpy as np

from core import config
from core.products import load_grid
from core.trendstats import bh_adjust, trend_grid


def coslat_mean(field, lat):
    w = np.broadcast_to(np.cos(np.deg2rad(lat))[:, None], field.shape)
    ok = np.isfinite(field)
    return float(np.sum(field[ok] * w[ok]) / np.sum(w[ok]))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("var", choices=sorted(config.VARIABLES))
    args = ap.parse_args()

    # Missing values (fill, land-only / ocean-only, 'never any snow / ice') are NaN: trend_grid leaves those cells NaN and
    # bh_adjust, the fractions and the means below use finite cells only. Fractions are in percent (products.py).
    data = load_grid(args.var)
    lat = np.load(os.path.join(config.CACHE_DIR, "lat.npy"))
    lon = np.load(os.path.join(config.CACHE_DIR, "lon.npy"))
    years = np.load(os.path.join(config.CACHE_DIR, "years.npy"))

    t0 = time.time()
    # The source is quantised to 0.01; rounding the float32 cache back to 2 decimals makes the
    # grid numerically identical to what the browser computes from the POWER point API.
    res = trend_grid(data, years.astype(np.float64))
    q = bh_adjust(res["p"])
    secs = time.time() - t0

    slope_decade = 10.0 * res["slope"]
    out = os.path.join(config.CACHE_DIR, f"{args.var}_trend.npz")
    np.savez(out, slope_decade=slope_decade, ci_low_decade=10.0 * res["ci_low"],
             ci_high_decade=10.0 * res["ci_high"], p=res["p"], q=q, r1=res["r1"],
             factor=res["factor"], lat=lat, lon=lon)

    fin = np.isfinite(res["p"])
    print(f"variable: {args.var}")
    print(f"seconds: {secs:.1f}")
    print(f"cells: {fin.sum()} finite of {fin.size}")
    print(f"cells with data (percent): {100.0 * fin.sum() / fin.size:.2f}")
    print(f"fraction p<0.05: {np.mean(res['p'][fin] < 0.05):.4f}")
    print(f"fraction q<0.05: {np.mean(q[fin] < 0.05):.4f}")
    print(f"fraction factor>1: {np.mean(res['factor'][fin] > 1):.4f}")
    sd = slope_decade[fin]
    print(f"slope_decade min/median/max: {sd.min():.4f} / {np.median(sd):.4f} / {sd.max():.4f} "
          f"{config.VARIABLES[args.var]['units_per_decade']}")
    print(f"cos(lat)-weighted global mean slope_decade: {coslat_mean(slope_decade, lat):.4f}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
