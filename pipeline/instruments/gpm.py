"""GPM IMERG monthly precipitation as served by NASA POWER's public zarr store (anonymous S3), 1 deg yearly record.

Run from pipeline/:  .venv/bin/python instruments/gpm.py
Raw zarr chunks (one month each) are mirrored to cache/inst_raw/gpm/ so a second run is offline.
"""
import calendar
import os
import sys
import concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import numpy as np  # noqa: E402
import config  # noqa: E402,F401
import sources  # noqa: E402,F401

BUCKET = "nasa-power/imerg/spatial/power_imerg_monthly_spatial_utc.zarr"
VAR = "IMERG_PRECTOT"
RAW = os.path.join(ROOT, "cache", "inst_raw", "gpm")
OUT = os.path.join(ROOT, "cache", "inst_gpm.npz")
Y0, Y1 = 2001, 2025
T0_YEAR = 1998  # time index 0 = 1998-01


def tindex(y, m):
    return (y - T0_YEAR) * 12 + (m - 1)


def mirror():
    import s3fs
    fs = s3fs.S3FileSystem(anon=True, config_kwargs={"user_agent": "trend-detective-pipeline (research, non-commercial)"})
    os.makedirs(os.path.join(RAW, VAR), exist_ok=True)
    for name in [".zgroup", ".zattrs", ".zmetadata"] + [f"{d}/{f}" for d in ("lat", "lon", "time", VAR)
                                                       for f in (".zarray", ".zattrs")]:
        p = os.path.join(RAW, name)
        if not os.path.exists(p):
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "wb").write(fs.cat(f"{BUCKET}/{name}"))
    for d in ("lat", "lon", "time"):
        p = os.path.join(RAW, d, "0")
        if not os.path.exists(p):
            open(p, "wb").write(fs.cat(f"{BUCKET}/{d}/0"))

    def get(i):
        p = os.path.join(RAW, VAR, f"{i}.0.0")
        if os.path.exists(p):
            return 0
        for k in range(6):
            try:
                b = fs.cat(f"{BUCKET}/{VAR}/{i}.0.0")
                open(p + ".part", "wb").write(b)
                os.replace(p + ".part", p)
                return len(b)
            except Exception as e:  # noqa: BLE001
                print("retry", i, e)
                import time
                time.sleep(2 * (k + 1))
        raise RuntimeError(f"chunk {i}")
    idx = [tindex(y, m) for y in range(Y0, Y1 + 1) for m in range(1, 13)]
    with cf.ThreadPoolExecutor(4) as ex:
        n = sum(ex.map(get, idx))
    print(f"downloaded {n/1e6:.1f} MB")


def build():
    import xarray as xr
    ds = xr.open_zarr(RAW, consolidated=False)
    lat = ds["lat"].values.astype(np.float64)
    lon = ds["lon"].values.astype(np.float64)
    tt = ds["time"].values
    assert str(tt[0])[:7] == "1998-01" and lat[0] < lat[-1] and lon[0] < lon[-1]
    w = np.cos(np.deg2rad(lat))[:, None] * np.ones((1, lon.size))
    nlat, nlon = 180, 360
    ny = Y1 - Y0 + 1
    annual = np.full((ny, nlat, nlon), np.nan, np.float32)
    nmon = np.zeros((ny, nlat, nlon), np.int8)
    for yi, y in enumerate(range(Y0, Y1 + 1)):
        acc = np.zeros((nlat, nlon))
        dsum = np.zeros((nlat, nlon))
        for m in range(1, 13):
            assert str(tt[tindex(y, m)])[:7] == f"{y:04d}-{m:02d}"
            a = ds[VAR].isel(time=tindex(y, m)).values.astype(np.float64)
            ok = np.isfinite(a) & (a >= 0)
            wv = (w * ok).reshape(nlat, 10, nlon, 10).sum(axis=(1, 3))
            wt = w.reshape(nlat, 10, nlon, 10).sum(axis=(1, 3))
            sv = (w * np.where(ok, a, 0)).reshape(nlat, 10, nlon, 10).sum(axis=(1, 3))
            valid = wv >= 0.5 * wt
            mm = np.where(valid, sv / np.where(wv > 0, wv, 1), np.nan)
            d = calendar.monthrange(y, m)[1]
            good = np.isfinite(mm)
            acc += np.where(good, mm * d, 0)
            dsum += np.where(good, d, 0)
            nmon[yi] += good
        full = nmon[yi] == 12
        annual[yi] = np.where(full, acc / np.where(dsum > 0, dsum, 1), np.nan)
        print(y, "valid cells", int(full.sum()), flush=True)
    np.savez_compressed(
        OUT, annual=annual, years=np.arange(Y0, Y1 + 1, dtype=np.int32),
        lat=np.arange(-89.5, 90, 1.0), lon=np.arange(-179.5, 180, 1.0), n_months=nmon,
        units="mm/day",
        source="NASA POWER v10 IMERG monthly (GPM IMERG, mm/day, no conversion) from anonymous S3 zarr: "
               "s3://nasa-power/imerg/spatial/power_imerg_monthly_spatial_utc.zarr/IMERG_PRECTOT/<t>.0.0 "
               "(t = month index from 1998-01); yearly mean of 12 monthly means weighted by days in month",
        native="0.1 deg x 0.1 deg (1800x3600, lat -89.95..89.95, lon -179.95..179.95), POWER IMERG_PRECTOT; "
               "regridded to 1 deg by cos(lat)-weighted mean of valid 10x10 native cells, valid if >=50% area valid")


if __name__ == "__main__":
    mirror()
    build()
