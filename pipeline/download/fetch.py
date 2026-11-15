"""Download the 45-year annual global field of one POWER variable to pipeline/cache/."""
import argparse
import os
import time

import numpy as np

from core import config


def download(var):
    import xarray as xr
    ds = xr.open_zarr(config.STORE, storage_options={"anon": True}, consolidated=True)
    da = ds[var].sel(time=slice(config.TIME_START, config.TIME_END)).transpose("time", "lat", "lon")
    data = da.values.astype(np.float32)
    lat = ds["lat"].values.astype(np.float64)
    lon = ds["lon"].values.astype(np.float64)
    years = da["time"].dt.year.values.astype(np.int64)
    return data, lat, lon, years


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("var", choices=sorted(config.VARIABLES))
    ap.add_argument("--force", action="store_true", help="re-download even if cached")
    args = ap.parse_args()

    os.makedirs(config.CACHE_DIR, exist_ok=True)
    out = os.path.join(config.CACHE_DIR, f"{args.var}_annual.npy")
    if os.path.exists(out) and not args.force:
        print(f"{out} exists, skipping (use --force to re-download)")
        return

    t0 = time.time()
    for attempt in range(5):
        try:
            data, lat, lon, years = download(args.var)
            break
        except Exception as exc:  # network / S3 errors
            if attempt == 4:
                raise
            wait = 2 ** attempt
            print(f"attempt {attempt + 1} failed ({type(exc).__name__}: {exc}); retrying in {wait} s")
            time.sleep(wait)

    if list(years) != config.YEARS:
        raise SystemExit(f"unexpected years: {years}")
    np.save(out, data)
    np.save(os.path.join(config.CACHE_DIR, "lat.npy"), lat)
    np.save(os.path.join(config.CACHE_DIR, "lon.npy"), lon)
    np.save(os.path.join(config.CACHE_DIR, "years.npy"), years)
    print(f"variable: {args.var}")
    print(f"shape: {data.shape}")
    print(f"min: {np.nanmin(data):.4f}  max: {np.nanmax(data):.4f}")
    print(f"NaN count: {int(np.isnan(data).sum())}")
    print(f"lat: {lat[0]}..{lat[-1]} ({len(lat)})  lon: {lon[0]}..{lon[-1]} ({len(lon)})  "
          f"years: {years[0]}..{years[-1]} ({len(years)})")
    print(f"seconds: {time.time() - t0:.1f}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
