"""Export the annual 1981-2025 fields on the coarse 288 x 181 grid, for recomputing the trend map in the browser
for any chosen period.

Output (web/public/data/):
  {VAR}_annual.bin   Int16 little-endian, order [year][lat ascending][lon], value = round((block_mean - offset) * 100),
                     -32768 = no data
  {VAR}_annual.json  {nlat, nlon, lat0, dlat, lon0, dlon, years: [1981, 2025], scale: 0.01, units[, offset]}
The block averaging is the same as in export_wind.py (288 x 181, lon -180..178.75 step 1.25, lat -90..90 step 1.0).
"""
import json
import os

import numpy as np

import config
from export_wind import DLAT, DLON, NLAT, NLON
from products import MISSING, coarse_stack, load_grid, rules, to_int16


def main():
    for var, cfg in config.VARIABLES.items():
        a = load_grid(var, exact=True)  # missing values are NaN, percent variables in percent; unrounded as always (products.py)
        lat = np.load(os.path.join(config.CACHE_DIR, "lat.npy"))
        lon = np.load(os.path.join(config.CACHE_DIR, "lon.npy"))
        assert a.shape == (len(config.YEARS), 361, 576), a.shape
        assert abs(lat[0] + 90) < 1e-9 and abs(lon[0] + 180) < 1e-9
        coarse = coarse_stack(a)  # a coarse cell with less than half valid weight is NaN
        offset = rules(var)[1]
        data = to_int16(coarse, offset)  # raises on Int16 overflow; NaN -> -32768
        nmiss = int((data == MISSING).all(axis=0).sum())
        print(f"{var}: shape {coarse.shape}, offset {offset}, stored min/max "
              f"{int(data[data != MISSING].min())} / {int(data[data != MISSING].max())} (Int16 range -32768..32767), "
              f"{nmiss} of {NLAT * NLON} coarse cells without data")
        os.makedirs(config.WEB_DATA_DIR, exist_ok=True)
        bin_path = os.path.join(config.WEB_DATA_DIR, f"{var}_annual.bin")
        with open(bin_path, "wb") as f:
            f.write(data.tobytes())
        meta = {"nlat": NLAT, "nlon": NLON, "lat0": -90.0, "dlat": DLAT, "lon0": -180.0, "dlon": DLON,
                "years": [config.YEARS[0], config.YEARS[-1]], "scale": 0.01, "units": cfg["units"]}
        if offset:
            meta["offset"] = offset  # the browser adds it back: value = stored * scale + offset
        with open(os.path.join(config.WEB_DATA_DIR, f"{var}_annual.json"), "w") as f:
            json.dump(meta, f, indent=2)
        print(f"  wrote {bin_path} ({os.path.getsize(bin_path)} bytes)")


if __name__ == "__main__":
    main()
