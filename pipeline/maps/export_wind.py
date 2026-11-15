"""Export the 1981-2025 mean 2 m wind (U2M, V2M) on a coarse grid for the animated wind-flow layer.

Output (web/public/data/):
  wind_mean.bin  Int16 little-endian, u then v, each row-major [lat ascending][lon], value = round(m/s * 100)
  wind_mean.json grid description + metadata
Grid: 288 lon x 181 lat, 1.25 deg lon x 1.0 deg lat, lat -90..90, lon -180..178.75 (block averages of the
0.625 x 0.5 deg source grid).
"""
import json
import os

import numpy as np
import xarray as xr

from core import config

NLAT, NLON = 181, 288
DLAT, DLON = 1.0, 1.25


def block_average(a, lat, lon):
    """a: (361, 576) on lat -90..90 step .5, lon -180.. step .625 -> (181, 288).
    Lon: mean of 2 neighbouring source columns (centred at +0.3125 deg; the shift is negligible at this scale).
    Lat: the node at lat L averages source rows within +-0.5 deg (weights 1/4,1/2,1/4 -> in practice rows
    L-0.5, L, L+0.5), poles use available rows."""
    a = np.asarray(a, dtype=np.float64)
    lon_avg = 0.5 * (a[:, 0::2] + a[:, 1::2])  # (361, 288)
    out = np.empty((NLAT, NLON))
    nsrc = lon_avg.shape[0]
    for i in range(NLAT):
        c = 2 * i
        rows = [r for r in (c - 1, c, c + 1) if 0 <= r < nsrc]
        w = np.array([0.5 if r == c else 0.25 for r in rows])
        out[i] = (lon_avg[rows] * w[:, None]).sum(axis=0) / w.sum()
    return out


def main():
    ds = xr.open_zarr(config.STORE, storage_options={"anon": True}, consolidated=True)
    sel = ds[["U2M", "V2M"]].sel(time=slice(config.TIME_START, config.TIME_END))
    mean = sel.mean(dim="time", skipna=True).compute()
    lat = mean["lat"].values
    lon = mean["lon"].values
    assert lat.shape == (361,) and lon.shape == (576,), (lat.shape, lon.shape)
    assert abs(lat[0] + 90) < 1e-9 and abs(lon[0] + 180) < 1e-9
    u = block_average(mean["U2M"].values, lat, lon)
    v = block_average(mean["V2M"].values, lat, lon)
    assert np.isfinite(u).all() and np.isfinite(v).all(), "NaNs in mean wind"
    ui = np.round(u * 100).astype("<i2")
    vi = np.round(v * 100).astype("<i2")
    u, v = ui / 100.0, vi / 100.0  # what the browser will see

    os.makedirs(config.WEB_DATA_DIR, exist_ok=True)
    with open(os.path.join(config.WEB_DATA_DIR, "wind_mean.bin"), "wb") as f:
        f.write(ui.tobytes())
        f.write(vi.tobytes())
    speed = np.hypot(u, v)
    meta = {
        "nlat": NLAT, "nlon": NLON, "lat0": -90.0, "dlat": DLAT, "lon0": -180.0, "dlon": DLON,
        "scale": 0.01, "units": "m/s", "years": [1981, 2025],
        "source": "NASA POWER U2M/V2M annual means", "max_speed": round(float(speed.max()), 2),
    }
    with open(os.path.join(config.WEB_DATA_DIR, "wind_mean.json"), "w") as f:
        json.dump(meta, f, indent=2)

    lats = -90.0 + DLAT * np.arange(NLAT)
    lons = -180.0 + DLON * np.arange(NLON)
    westerlies = (lats >= -60) & (lats <= -40)
    pac = ((lons >= 160) | (lons <= -140))
    trades = (lats >= 10) & (lats <= 20)
    print("grid", u.shape, "max speed m/s", meta["max_speed"])
    print("mean u 40S-60S (westerlies, expect clearly >0): %.2f m/s" % u[westerlies].mean())
    print("mean u 10N-20N, 160E-140W (trades, expect clearly <0): %.2f m/s" % u[np.ix_(trades, pac)].mean())


if __name__ == "__main__":
    main()
