"""Evaluation-layer products: the quality checks of quality.py for every grid cell, region and variable.

  a) cache/{VAR}_quality.npz          full-resolution (361 x 576), full 1981-2025 period: flags (bit0 STEP, bit1 ONE_YEAR,
                                      bit2 REVERSAL, bit3 END_SENSITIVE), grade (0 none, 1 robust, 2 caution, 3 doubtful,
                                      255 no data), stepYear and outlierYear (uint16, 0 = none; only where the flag is set).
  b) web/public/data/{VAR}_meta.json  gains "caveat" (config.py) and "quality": {robust, caution, doubtful, stepYearMode}:
                                      area-weighted (cos latitude) shares of the area where the MAP shows a significant trend
                                      (BH q < 0.05 in {VAR}_trend.npz), by grade; stepYearMode = most common stepYear among the
                                      STEP-flagged significant cells (null if under 1% of the significant area is flagged).
                                      Nothing else in the file changes (the key order is kept).
  c) web/public/data/quality.bin + quality.json  the same on the COARSE grid of summary.bin (same loader, same rows):
                                      per variable, for the cells with data in summary.bin's bitmap order,
                                        flags       Uint8[n]   bit0 STEP, bit1 ONE_YEAR, bit2 REVERSAL, bit3 END_SENSITIVE,
                                                               bits 4-5 grade (0 none, 1 robust, 2 caution, 3 doubtful)
                                        stepYear    Uint16[n]  0 = none (set only where STEP is flagged)
                                        outlierYear Uint16[n]  0 = none (set only where ONE_YEAR is flagged)
                                      each array padded to a multiple of 4 bytes; offsets in quality.json.
  d) web/public/data/regions.json     every region variable gains quality: {step, oneYear, reversal, endSensitive, grade,
                                      stepYear, outlierYear} computed on the same weighted-mean series regions.py uses.

Run from the pipeline directory:  .venv/bin/python -m evaluation.export_quality
"""
import json
import os

import numpy as np

from core import config
from maps import export_summary as ES
from core import products
from areas import regions as RG
from evaluation.quality import CODE_GRADE, GRADE_CODE, NODATA, quality_1d, quality_grid

T = np.array(config.YEARS, dtype=np.float64)
DATA = config.WEB_DATA_DIR
BITS = {"step": 1, "oneYear": 2, "reversal": 4, "endSensitive": 8}


def flag_bits(q):
    return (q["step"] * 1 + q["oneYear"] * 2 + q["reversal"] * 4 + q["endSensitive"] * 8).astype(np.uint8)


def year_arrays(q):
    """stepYear / outlierYear as uint16, set only where the flag is."""
    return (np.where(q["step"], q["stepYear"], 0).astype(np.uint16),
            np.where(q["oneYear"], q["outlierYear"], 0).astype(np.uint16))


def full_resolution(var):
    """Compute and cache the full-resolution quality of one variable; returns (quality dict, flags, step, outlier)."""
    q = quality_grid(products.load_grid(var), T)
    step_year, out_year = year_arrays(q)
    flags = flag_bits(q)
    lat, lon = np.load(os.path.join(config.CACHE_DIR, "lat.npy")), np.load(os.path.join(config.CACHE_DIR, "lon.npy"))
    np.savez(os.path.join(config.CACHE_DIR, f"{var}_quality.npz"), flags=flags, grade=q["grade"], stepYear=step_year,
             outlierYear=out_year, lat=lat, lon=lon)
    return q, step_year, lat


def meta_quality(var, q, step_year, lat):
    """The "quality" block of {VAR}_meta.json."""
    tr = np.load(os.path.join(config.CACHE_DIR, f"{var}_trend.npz"))
    sig = np.isfinite(tr["q"]) & (tr["q"] < config.ALPHA)
    grade = q["grade"]
    assert not np.any(sig & (grade == NODATA)), f"{var}: a map-significant cell without a quality result"
    assert not np.any(sig & (grade == GRADE_CODE["none"])), f"{var}: a map-significant cell whose raw kind is none"
    w = np.broadcast_to(np.cos(np.deg2rad(lat))[:, None], sig.shape)
    tot = float(w[sig].sum())
    share = {name: float(w[sig & (grade == code)].sum() / tot) for name, code in GRADE_CODE.items() if name != "none"}
    flagged = sig & q["step"]
    frac_step = float(w[flagged].sum() / tot)
    mode = None
    if frac_step >= 0.01:
        years, counts = np.unique(step_year[flagged], return_counts=True)
        mode = int(years[np.argmax(counts)])  # smallest year on a tie (np.unique sorts)
    return {"robust": round(share["robust"], 4), "caution": round(share["caution"], 4),
            "doubtful": round(share["doubtful"], 4), "stepYearMode": mode}


def write_meta(var, qblock):
    path = os.path.join(DATA, f"{var}_meta.json")
    with open(path) as f:
        old = json.load(f)
    new = {}
    for k, v in old.items():
        if k in ("caveat", "quality"):
            continue
        new[k] = v
        if k == "definition":
            new["caveat"] = config.VARIABLES[var]["caveat"]
    new["quality"] = qblock
    with open(path, "w") as f:
        json.dump(new, f, indent=2)


def coarse_files(summary_meta):
    """quality.bin + quality.json on the coarse grid; rows follow summary.bin's bitmaps (asserted)."""
    with open(os.path.join(DATA, "summary.bin"), "rb") as f:
        sbin = f.read()
    nc = summary_meta["nlat"] * summary_meta["nlon"]
    blobs, recs, offset = [], [], 0
    for rec in summary_meta["variables"]:
        var = rec["variable"]
        q = quality_grid(ES.coarse_values(var), T)
        ok = (q["grade"] != NODATA).ravel()
        bits = np.unpackbits(np.frombuffer(sbin, np.uint8, (nc + 7) // 8, rec["bitmapOffset"]), bitorder="little")[:nc].astype(bool)
        assert (bits == ok).all(), f"{var}: the quality cells differ from summary.bin's bitmap"
        assert int(ok.sum()) == rec["count"]
        flags = (flag_bits(q).ravel() | (q["grade"].ravel().astype(np.uint8) << 4))[ok].astype(np.uint8)
        step_year, out_year = year_arrays(q)
        arrays = {"flags": flags, "stepYear": step_year.ravel()[ok].astype("<u2"), "outlierYear": out_year.ravel()[ok].astype("<u2")}
        r = {"variable": var, "count": int(ok.sum())}
        for name, arr in arrays.items():
            raw = arr.tobytes()
            raw += b"\0" * (-len(raw) % 4)
            r[name + "Offset"] = offset
            blobs.append(raw)
            offset += len(raw)
        recs.append(r)
        g = q["grade"][q["grade"] != NODATA]
        print(f"coarse {var}: {int(ok.sum())} cells, grades none/robust/caution/doubtful = "
              f"{[int((g == c).sum()) for c in range(4)]}")
    with open(os.path.join(DATA, "quality.bin"), "wb") as f:
        f.write(b"".join(blobs))
    meta = {"nlat": summary_meta["nlat"], "nlon": summary_meta["nlon"], "bytes": offset, "variables": recs}
    with open(os.path.join(DATA, "quality.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"wrote quality.bin ({offset} bytes), quality.json")


def region_series(var, cells, grid):
    """The cos(latitude)-weighted mean annual series of regions.region_variable (same formula), or None."""
    if products.surface(var) == "sea":
        return None
    ok = cells & ~np.isnan(grid).any(axis=0)
    if not ok.any():
        return None
    w = np.broadcast_to(RG.area_weights(), cells.shape)[ok]
    return (grid[:, ok] * w).sum(axis=1) / w.sum()


def region_entries():
    """Add quality to every region variable of regions.json (existing keys and numbers are untouched)."""
    path = RG.REGIONS_JSON
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    data = json.loads(raw)
    assert json.dumps(data, separators=(",", ":"), ensure_ascii=False) == raw, "regions.json does not round-trip"
    region_mask = np.load(RG.MASK_NPY)
    country_mask = RG.load_country_mask()
    cells = {r["name"]: RG.land_cells(region_mask, country_mask, r["name"]) for r in data["regions"]}
    for var in config.VARIABLES:
        grid = products.load_grid(var)
        for reg in data["regions"]:
            ent = reg["variables"][var]
            if ent is None:
                continue
            ent.pop("quality", None)
            series = region_series(var, cells[reg["name"]], grid)
            from core.trendstats import trend_1d
            t1 = trend_1d(series, T)
            assert abs(10 * t1["slope"] - ent["slopePerDecade"]) <= 1e-5 * max(1.0, abs(ent["slopePerDecade"])), (var, reg["name"])
            assert abs(t1["p"] - ent["p"]) <= 1e-5 * max(abs(ent["p"]), 1e-12) + 1e-12, (var, reg["name"])
            d = quality_1d(series, T)
            f = d["flags"]
            ent["quality"] = {"step": f["step"], "oneYear": f["oneYear"], "reversal": f["reversal"],
                              "endSensitive": f["endSensitive"], "grade": d["grade"],
                              "stepYear": d["stepYear"] if f["step"] else None,
                              "outlierYear": d["outlierYear"] if f["oneYear"] else None}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {path} with quality for every region variable")
    for reg in data["regions"]:
        print(f"  {reg['name']:14}", " ".join(f"{v}:{(e['quality']['grade'] if e else '-')[:4]}" for v, e in reg["variables"].items()))


def main():
    with open(os.path.join(DATA, "summary.json")) as f:
        summary_meta = json.load(f)
    for var in config.VARIABLES:
        q, step_year, lat = full_resolution(var)
        block = meta_quality(var, q, step_year, lat)
        write_meta(var, block)
        print(f"{var}: quality {block}")
    coarse_files(summary_meta)
    region_entries()


if __name__ == "__main__":
    main()
