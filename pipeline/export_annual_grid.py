"""Export the annual 1981-2025 fields on the coarse 288 x 181 grid, for recomputing the trend map in the browser
for any chosen period.

Output (web/public/data/):
  {VAR}_annual.bin   Int16 little-endian, order [year][lat ascending][lon], value = round(block_mean * 100)
  {VAR}_annual.json  {nlat, nlon, lat0, dlat, lon0, dlon, years: [1981, 2025], scale: 0.01, units}
The block averaging is the same as in export_wind.py (288 x 181, lon -180..178.75 step 1.25, lat -90..90 step 1.0).
"""
import json
import os

import numpy as np

import config
from export_wind import DLAT, DLON, NLAT, NLON, block_average


def main():
    for var, cfg in config.VARIABLES.items():
        a = np.load(os.path.join(config.CACHE_DIR, f"{var}_annual.npy"))
        lat = np.load(os.path.join(config.CACHE_DIR, "lat.npy"))
        lon = np.load(os.path.join(config.CACHE_DIR, "lon.npy"))
        assert a.shape == (len(config.YEARS), 361, 576), a.shape
        assert abs(lat[0] + 90) < 1e-9 and abs(lon[0] + 180) < 1e-9
        coarse = np.stack([block_average(a[k], lat, lon) for k in range(a.shape[0])])
        assert np.isfinite(coarse).all(), f"{var}: NaN in coarse grid"
        scaled = np.round(coarse * 100)
        lo, hi = float(scaled.min()), float(scaled.max())
        print(f"{var}: shape {coarse.shape}, scaled min/max {lo:.0f} / {hi:.0f} (Int16 range -32768..32767)")
        assert lo >= -32768 and hi <= 32767, f"{var}: Int16 overflow"
        data = scaled.astype("<i2")
        os.makedirs(config.WEB_DATA_DIR, exist_ok=True)
        bin_path = os.path.join(config.WEB_DATA_DIR, f"{var}_annual.bin")
        with open(bin_path, "wb") as f:
            f.write(data.tobytes())
        meta = {"nlat": NLAT, "nlon": NLON, "lat0": -90.0, "dlat": DLAT, "lon0": -180.0, "dlon": DLON,
                "years": [config.YEARS[0], config.YEARS[-1]], "scale": 0.01, "units": cfg["units"]}
        with open(os.path.join(config.WEB_DATA_DIR, f"{var}_annual.json"), "w") as f:
            json.dump(meta, f, indent=2)
        print(f"  wrote {bin_path} ({os.path.getsize(bin_path)} bytes)")


if __name__ == "__main__":
    main()
