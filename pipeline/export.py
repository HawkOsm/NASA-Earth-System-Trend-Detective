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


def hex_to_rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]


def stops_colour(stops_rgb, pos):
    """Linear interpolation between equally spaced colour stops (rows of 0..1 rgb); pos in [0, 1], any shape."""
    stops = np.asarray(stops_rgb, dtype=np.float64)
    n = len(stops) - 1
    p = np.clip(np.asarray(pos, dtype=np.float64), 0.0, 1.0) * n
    k = np.minimum(np.floor(p).astype(np.int64), n - 1)
    f = (p - k)[..., None]
    return stops[k] * (1 - f) + stops[k + 1] * f


def overlay_rgb(slope, w, vmax, stops_hex, base, floor=config.COLOR_FLOOR, alpha_max=config.ALPHA_MAX,
                alpha_full_at=config.ALPHA_FULL_AT):
    """THE overlay rule (mirrored by overlayPixels in web/src/rangeMap.ts, tied by tests/fixtures/overlay_cases.json).
    slope (any shape, per decade), significance weight w in [0, 1], base-map colour (..., 3) uint8 or 0..255 floats.
      x = min(|s|/vmax, 1);  t = sign(s) * (floor + (1 - floor) * x)  -> colormap position (t + 1) / 2
      alpha = alpha_max * w * min(x / alpha_full_at, 1);  out = (1 - alpha) * base + alpha * colour
    Colormap = linear interpolation between the stops. Non-finite slope -> base. Returns uint8 (..., 3)."""
    s = np.asarray(slope, dtype=np.float64)
    wt = np.nan_to_num(np.asarray(w, dtype=np.float64), nan=0.0)
    ok = np.isfinite(s)
    s = np.where(ok, s, 0.0)
    x = np.minimum(np.abs(s) / vmax, 1.0)
    t = np.sign(s) * (floor + (1.0 - floor) * x)
    colour = stops_colour([hex_to_rgb(h) for h in stops_hex], (t + 1.0) / 2.0) * 255.0
    alpha = np.where(ok, alpha_max * wt * np.minimum(x / alpha_full_at, 1.0), 0.0)[..., None]
    out = (1.0 - alpha) * np.asarray(base, dtype=np.float64) + alpha * colour
    return np.clip(np.floor(out + 0.5), 0, 255).astype(np.uint8)


def rgb_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*(int(v) for v in rgb))


def legend_stops(stops_hex, floor=config.COLOR_FLOOR, alpha_max=config.ALPHA_MAX, alpha_full_at=config.ALPHA_FULL_AT):
    """21 {t, rgb, alpha}: overlay colour and opacity at s = t * vmax with w = 1, for the web legend."""
    out = []
    for i in range(21):
        t = round(-1.0 + i / 10.0, 10)
        x = abs(t)
        pos = (math.copysign(floor + (1.0 - floor) * x, t) + 1.0) / 2.0 if t != 0 else 0.5
        c = stops_colour([hex_to_rgb(h) for h in stops_hex], pos) * 255.0
        out.append({"t": t, "rgb": rgb_hex(np.floor(c + 0.5)),
                    "alpha": round(alpha_max * min(x / alpha_full_at, 1.0), 4)})
    return out


def load_basemap():
    path = os.path.join(config.WEB_DATA_DIR, "basemap.png")
    if not os.path.exists(path):
        raise SystemExit("basemap.png missing: run basemap.py first")
    img = np.asarray(Image.open(path).convert("RGB"))
    if img.shape != (HEIGHT, WIDTH, 3):
        raise SystemExit(f"basemap.png has shape {img.shape}, expected {(HEIGHT, WIDTH, 3)}")
    return img


def write_overlay_fixture(path):
    """Test cases for the browser mirror: t = s / vmax (may exceed +-1), w, base colour, colormap, expected colour."""
    rng = np.random.default_rng(10)
    cmaps = {n: [to_hex(colormaps[v["colormap"]](q)) for q in np.linspace(0.0, 1.0, 11)]
             for n, v in config.VARIABLES.items()}
    names = sorted(cmaps)
    grid_t = [-1.6, -1.0, -0.75, -0.5, -0.25, -0.1, -0.01, 0.0, 0.01, 0.1, 0.25, 0.5, 0.75, 1.0, 1.6]
    cases = []
    for i in range(32):
        if i < len(grid_t):
            t, w = grid_t[i], 1.0
        else:
            t, w = float(np.round(rng.uniform(-1.4, 1.4), 3)), float(np.round(rng.uniform(0, 1), 3))
        base = list(config.BASEMAP_LAND if i % 2 == 0 else config.BASEMAP_OCEAN) if i < 24 else \
            [int(v) for v in rng.integers(0, 256, 3)]
        stops = cmaps[names[i % 3]]
        exp = overlay_rgb(np.array([t]), np.array([w]), 1.0, stops, np.array([base]))[0]
        cases.append({"t": t, "w": w, "base": [int(v) for v in base], "colormap_stops": stops,
                      "expected": [int(v) for v in exp]})
    with open(path, "w") as f:
        json.dump({"constants": {"color_floor": config.COLOR_FLOOR, "alpha_max": config.ALPHA_MAX,
                                 "alpha_full_at": config.ALPHA_FULL_AT}, "cases": cases}, f, indent=1)


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
    cmap = colormaps[meta_cfg["colormap"]]
    stops_hex = [to_hex(cmap(v)) for v in np.linspace(0.0, 1.0, 11)]
    rgb = overlay_rgb(bilinear_to_pixels(slope, lat, lon), bilinear_to_pixels(sig_field, lat, lon),
                      vmax, stops_hex, load_basemap())
    os.makedirs(config.WEB_DATA_DIR, exist_ok=True)
    img = Image.fromarray(rgb, "RGB")
    tex_path = os.path.join(config.WEB_DATA_DIR, f"{args.var}_trend.png")
    img.save(tex_path)

    sig = np.where(fin, (q < config.ALPHA).astype(np.float64), np.nan)
    meta = {
        "variable": args.var,
        "label": meta_cfg["label"],
        "units": meta_cfg["units"],
        "units_per_decade": meta_cfg["units_per_decade"],
        "definition": meta_cfg["definition"],
        "years": [config.YEARS[0], config.YEARS[-1]],
        "vmax": vmax,
        "colormap_stops": stops_hex,
        "grid": {"nlat": int(len(lat)), "nlon": int(len(lon)), "lat0": float(lat[0]),
                 "dlat": float(lat[1] - lat[0]), "lon0": float(lon[0]), "dlon": float(lon[1] - lon[0])},
        "render": {"basemap": "basemap.png", "color_floor": config.COLOR_FLOOR, "alpha_max": config.ALPHA_MAX,
                   "alpha_full_at": config.ALPHA_FULL_AT, "ocean": rgb_hex(config.BASEMAP_OCEAN),
                   "land": rgb_hex(config.BASEMAP_LAND)},
        "legend_stops": legend_stops(stops_hex),
        "frac_significant": coslat_mean(sig, lat),
        "global_mean_slope_decade": coslat_mean(slope, lat),
    }
    meta_path = os.path.join(config.WEB_DATA_DIR, f"{args.var}_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    write_overlay_fixture(os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "overlay_cases.json"))
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
