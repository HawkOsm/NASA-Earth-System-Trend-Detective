"""Export the "confirmed only" map texture: {VAR}_confirmed.png and reference/confirmed_{VAR}.json (T2M, PRECTOTCORR).

Definition (fixed). For every full-resolution MERRA-2 cell with its own slope s and map significance (BH q < ALPHA, as export.py):
  box         the reference box containing the cell centre (lower edges inclusive, as reference.py; the top row clamps)
  CONFIRMED   map-significant AND the box is ELIGIBLE (reference.eligible_mask) AND refP < 0.05 AND sign(refSlope) == sign(s)
  UNCHECKABLE map-significant but the box is not eligible
  NOT CONFIRMED  the other map-significant cells
The texture is made exactly like {VAR}_trend.png (export.bilinear_to_pixels, export.overlay_rgb, same vmax, colormap, base map)
except that the significance field (1 where q < ALPHA) is replaced by 1 on CONFIRMED cells and 0 elsewhere (NaN where q is NaN).

Run from the pipeline directory:  .venv/bin/python export_confirmed.py
"""
import json
import os

import numpy as np
from matplotlib import colormaps
from matplotlib.colors import to_hex
from PIL import Image

import config
import export
import reference

P_REF = 0.05
OUT_DIR = reference.OUT_DIR


def box_index(lat, lon, grid):
    """Box index (ilat * nlon + ilon) of every cell centre; lat (nlat,), lon (nlon,) -> (nlat, nlon) int array.
    Lower edges inclusive, longitude wraps, the top row clamps (the lookup of reference.py box_of / reference.ts boxAt)."""
    lat0, dlat, nlat, lon0, dlon, nlon = grid
    nlat, nlon = int(nlat), int(nlon)
    i = np.clip(np.floor((np.asarray(lat) - (lat0 - dlat / 2)) / dlat).astype(np.int64), 0, nlat - 1)
    j = np.floor((np.asarray(lon) - (lon0 - dlon / 2)) / dlon).astype(np.int64) % nlon
    return i[:, None] * nlon + j[None, :]


def classify(slope, q, lat, lon, grid, eligible, ref_slope, ref_p, alpha=config.ALPHA):
    """Boolean (nlat, nlon) masks: significant, confirmed, not_confirmed, uncheckable."""
    slope = np.asarray(slope, dtype=np.float64)
    q = np.asarray(q, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        sig = np.isfinite(q) & np.isfinite(slope) & (q < alpha)
    b = box_index(lat, lon, grid)
    el = np.asarray(eligible).astype(bool)[b]
    rs = np.asarray(ref_slope, dtype=np.float64)[b]
    rp = np.asarray(ref_p, dtype=np.float64)[b]
    with np.errstate(invalid="ignore"):
        agrees = (rp < P_REF) & (np.sign(rs) == np.sign(slope)) & np.isfinite(rs)
    confirmed = sig & el & agrees
    uncheckable = sig & ~el
    not_confirmed = sig & el & ~agrees
    return {"significant": sig, "confirmed": confirmed, "notConfirmed": not_confirmed, "uncheckable": uncheckable}


def shares(masks, lat):
    """cos-latitude weighted share of the whole grid for each class; significant == the sum of the three (asserted)."""
    w = np.cos(np.radians(np.asarray(lat, dtype=np.float64)))[:, None] * np.ones(masks["significant"].shape)
    tot = w.sum()
    out = {k: float((w * masks[k]).sum() / tot) for k in ("significant", "confirmed", "notConfirmed", "uncheckable")}
    assert abs(out["significant"] - (out["confirmed"] + out["notConfirmed"] + out["uncheckable"])) < 1e-9
    return out


def confirmed_field(masks, q):
    """1 on confirmed cells, 0 elsewhere, NaN where q is NaN (same no-data rule as export.py's significance field)."""
    return np.where(np.isfinite(q), masks["confirmed"].astype(np.float64), np.nan)


def texture(slope, field, lat, lon, vmax, stops_hex, base):
    return export.overlay_rgb(export.bilinear_to_pixels(slope, lat, lon), export.bilinear_to_pixels(field, lat, lon),
                              vmax, stops_hex, base)


def main():
    base = export.load_basemap()
    for var in reference.VARS:
        z = np.load(os.path.join(config.CACHE_DIR, f"{var}_trend.npz"))
        slope, q, lat, lon = z["slope_decade"], z["q"], z["lat"], z["lon"]
        r = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
        grid = reference.reference_grid(var)
        el = reference.eligible_mask(var, r["used"], r["land"])
        masks = classify(slope, q, lat, lon, grid, el, r["refSlope"], r["refP"])
        sh = shares(masks, lat)
        vmax = export.round_up_2sig(float(np.percentile(np.abs(slope[np.isfinite(slope)]), 98)))
        with open(os.path.join(config.WEB_DATA_DIR, f"{var}_meta.json")) as f:
            meta = json.load(f)
        assert vmax == meta["vmax"], (vmax, meta["vmax"])
        stops_hex = [to_hex(colormaps[config.VARIABLES[var]["colormap"]](v)) for v in np.linspace(0.0, 1.0, 11)]
        rgb = texture(slope, confirmed_field(masks, q), lat, lon, vmax, stops_hex, base)
        path = os.path.join(config.WEB_DATA_DIR, f"{var}_confirmed.png")
        Image.fromarray(rgb, "RGB").save(path)
        src = reference.SOURCES[var]
        os.makedirs(OUT_DIR, exist_ok=True)
        with open(os.path.join(OUT_DIR, f"confirmed_{var}.json"), "w") as f:
            json.dump({"texture": f"{var}_confirmed.png", "source": {"short": src["short"], "name": src["name"]},
                       "shares": sh}, f, indent=1)
        print(var, json.dumps(sh), "->", path, f"({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
