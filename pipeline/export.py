"""Export the trend texture, metadata and a landmark debug image for the web globe."""
import argparse
import json
import math
import os

import numpy as np
from matplotlib import colormaps
from matplotlib.colors import to_hex
from PIL import Image, ImageDraw, ImageFont

import config
from compute import coslat_mean

WIDTH, HEIGHT = 2304, 1152
NAN_RGB = (128, 128, 128)


def pixel_indices(lat, lon, width=WIDTH, height=HEIGHT):
    """Nearest grid indices for every pixel centre of an equirectangular image.
    Returns (lat_idx of shape (height,), lon_idx of shape (width,)). Row 0 is north."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    dlat = lat[1] - lat[0]
    dlon = lon[1] - lon[0]
    px_lon = -180.0 + (np.arange(width) + 0.5) * 360.0 / width
    px_lat = 90.0 - (np.arange(height) + 0.5) * 180.0 / height
    lon_idx = np.floor((px_lon - lon[0]) / dlon + 0.5).astype(np.int64) % len(lon)
    lat_idx = np.clip(np.floor((px_lat - lat[0]) / dlat + 0.5).astype(np.int64), 0, len(lat) - 1)
    return lat_idx, lon_idx


def map_to_pixels(grid, lat, lon, width=WIDTH, height=HEIGHT):
    """Resample a (nlat, nlon) grid to a (height, width) image by nearest grid cell."""
    lat_idx, lon_idx = pixel_indices(lat, lon, width, height)
    return np.asarray(grid)[lat_idx[:, None], lon_idx[None, :]]


def bilinear_to_pixels(grid, lat, lon, width=WIDTH, height=HEIGHT):
    """Resample a (nlat, nlon) grid to a (height, width) image by bilinear interpolation between the
    four surrounding grid points, evaluated at pixel centres. Longitude wraps, latitude clamps at the
    poles. Row 0 is north, column 0 starts at lon -180."""
    grid = np.asarray(grid, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    nlat, nlon = len(lat), len(lon)
    dlat = lat[1] - lat[0]
    dlon = lon[1] - lon[0]
    px_lon = -180.0 + (np.arange(width) + 0.5) * 360.0 / width
    px_lat = 90.0 - (np.arange(height) + 0.5) * 180.0 / height
    fi = np.clip((px_lat - lat[0]) / dlat, 0.0, nlat - 1.0)
    i0 = np.minimum(np.floor(fi).astype(np.int64), nlat - 2)
    wi = (fi - i0)[:, None]
    fj = (px_lon - lon[0]) / dlon
    j0f = np.floor(fj)
    wj = (fj - j0f)[None, :]
    j0 = j0f.astype(np.int64) % nlon
    j1 = (j0 + 1) % nlon
    i0c, i1c = i0[:, None], (i0 + 1)[:, None]
    top = grid[i0c, j0[None, :]] * (1 - wj) + grid[i0c, j1[None, :]] * wj
    bot = grid[i1c, j0[None, :]] * (1 - wj) + grid[i1c, j1[None, :]] * wj
    return top * (1 - wi) + bot * wi


def round_up_2sig(v):
    if not v > 0:
        return 1.0
    e = math.floor(math.log10(v)) - 1
    return round(math.ceil(round(v / 10 ** e, 9)) * 10 ** e, max(0, -e))


def colorize(slope, q, vmax, cmap_name, alpha=config.ALPHA):
    """RGB uint8 image for a slope field (any 2-D shape); non-significant cells desaturated."""
    return colorize_weighted(slope, (np.asarray(q) < alpha).astype(np.float64), vmax, cmap_name)


def colorize_weighted(slope, w, vmax, cmap_name):
    """Like colorize, but with a significance weight w in [0, 1] per pixel:
    rgb = w * full colour + (1 - w) * desaturated colour (w=1 significant, w=0 not)."""
    cmap = colormaps[cmap_name]
    x = np.clip((np.nan_to_num(slope) + vmax) / (2 * vmax), 0.0, 1.0)
    rgb = cmap(x)[..., :3]
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    grey = 0.6 * lum + 0.4 * 0.82
    pale = 0.25 * rgb + 0.75 * grey[..., None]
    w = np.asarray(w, dtype=np.float64)[..., None]
    rgb = w * rgb + (1.0 - w) * pale
    out = np.round(rgb * 255).astype(np.uint8)
    out[~np.isfinite(slope)] = NAN_RGB
    return out


def geo_to_pixel(lat, lon, width=WIDTH, height=HEIGHT):
    return (lon + 180.0) / 360.0 * width, (90.0 - lat) / 180.0 * height


def draw_landmarks(img):
    img = img.copy()
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=22)
    except TypeError:
        font = ImageFont.load_default()
    arm, half = 14, 1  # arm length, half thickness (3 px)
    positions = []
    for name, la, lo in config.LANDMARKS:
        fx, fy = geo_to_pixel(la, lo, img.width, img.height)
        x, y = int(math.floor(fx)), int(math.floor(fy))
        positions.append((name, la, lo, x, y))
        for o, colour in ((1, (0, 0, 0)), (0, (255, 0, 255))):
            d.rectangle([x - arm - o, y - half - o, x + arm + o, y + half + o], fill=colour)
            d.rectangle([x - half - o, y - arm - o, x + half + o, y + arm + o], fill=colour)
        d.text((x + arm + 4, y - 12), name, fill=(255, 0, 255), font=font,
               stroke_width=2, stroke_fill=(0, 0, 0))
    return img, positions


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("var", choices=sorted(config.VARIABLES))
    args = ap.parse_args()
    meta_cfg = config.VARIABLES[args.var]

    z = np.load(os.path.join(config.CACHE_DIR, f"{args.var}_trend.npz"))
    slope, q, lat, lon = z["slope_decade"], z["q"], z["lat"], z["lon"]

    fin = np.isfinite(slope)
    vmax = round_up_2sig(float(np.percentile(np.abs(slope[fin]), 98)))

    sig_field = (q < config.ALPHA).astype(np.float64)  # 1 where significant, else 0 (NaN q -> 0)
    rgb = colorize_weighted(bilinear_to_pixels(slope, lat, lon), bilinear_to_pixels(sig_field, lat, lon),
                            vmax, meta_cfg["colormap"])
    os.makedirs(config.WEB_DATA_DIR, exist_ok=True)
    img = Image.fromarray(rgb, "RGB")
    tex_path = os.path.join(config.WEB_DATA_DIR, f"{args.var}_trend.png")
    img.save(tex_path)

    sig = np.where(fin, (q < config.ALPHA).astype(np.float64), np.nan)
    cmap = colormaps[meta_cfg["colormap"]]
    meta = {
        "variable": args.var,
        "label": meta_cfg["label"],
        "units": meta_cfg["units"],
        "units_per_decade": meta_cfg["units_per_decade"],
        "definition": meta_cfg["definition"],
        "years": [config.YEARS[0], config.YEARS[-1]],
        "vmax": vmax,
        "colormap_stops": [to_hex(cmap(v)) for v in np.linspace(0.0, 1.0, 11)],
        "grid": {"nlat": int(len(lat)), "nlon": int(len(lon)), "lat0": float(lat[0]),
                 "dlat": float(lat[1] - lat[0]), "lon0": float(lon[0]), "dlon": float(lon[1] - lon[0])},
        "frac_significant": coslat_mean(sig, lat),
        "global_mean_slope_decade": coslat_mean(slope, lat),
    }
    meta_path = os.path.join(config.WEB_DATA_DIR, f"{args.var}_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    lm_img, positions = draw_landmarks(img)
    lm_path = os.path.join(config.WEB_DATA_DIR, f"{args.var}_landmarks.png")
    lm_img.save(lm_path)

    print(f"variable: {args.var}")
    print(f"vmax: {vmax} {meta_cfg['units_per_decade']}")
    print(f"frac_significant (q<{config.ALPHA}, cos-lat weighted): {meta['frac_significant']:.4f}")
    print(f"global_mean_slope_decade: {meta['global_mean_slope_decade']:.4f}")
    for name, la, lo, x, y in positions:
        print(f"landmark {name} ({la}, {lo}) -> pixel (x={x}, y={y})")
    print(f"wrote {tex_path} ({img.width}x{img.height})")
    print(f"wrote {meta_path}")
    print(f"wrote {lm_path}")


if __name__ == "__main__":
    main()
