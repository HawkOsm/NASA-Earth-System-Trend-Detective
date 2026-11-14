import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import export_summary as E  # noqa: E402
from trendstats import trend_1d  # noqa: E402

D = config.WEB_DATA_DIR
NCELL = 181 * 288


@pytest.fixture(scope="module")
def meta():
    with open(os.path.join(D, "summary.json")) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def raw():
    with open(os.path.join(D, "summary.bin"), "rb") as f:
        return f.read()


def read_block(meta, raw, rec):
    nb = (NCELL + 7) // 8
    bits = np.unpackbits(np.frombuffer(raw, np.uint8, nb, rec["bitmapOffset"]), bitorder="little")[:NCELL].astype(bool)
    n = rec["count"]
    s = np.frombuffer(raw, "<f4", n, rec["slopeOffset"])
    p = np.frombuffer(raw, "<f4", n, rec["pOffset"])
    q = np.frombuffer(raw, "<u2", n, rec["qOffset"])
    return bits, s, p, q


def test_layout_and_size(meta, raw):
    assert meta["bytes"] == len(raw)
    assert [v["variable"] for v in meta["variables"]] == list(config.VARIABLES)
    assert (meta["nlat"], meta["nlon"], meta["dlat"], meta["dlon"], meta["cellKm"]) == (181, 288, 1.0, 1.25, 100)
    end = 0
    for v in meta["variables"]:
        offs = [v["bitmapOffset"], v["slopeOffset"], v["pOffset"], v["qOffset"]]
        assert offs == sorted(offs) and all(o % 4 == 0 for o in offs)
        assert v["bitmapOffset"] == end
        end = v["qOffset"] + (v["count"] * 2 + 3) // 4 * 4
    assert end == len(raw)


@pytest.mark.parametrize("var", ["T2M_MAX", "GWETROOT", "FRSEAICE", "TO3"])
def test_values_equal_trend_grid_on_the_coarse_grid(meta, raw, var):
    rec = next(v for v in meta["variables"] if v["variable"] == var)
    bits, s, p, q = read_block(meta, raw, rec)
    slope, pv, qv = E.coarse_trends(var)
    ok = np.isfinite(slope) & np.isfinite(pv)
    assert (bits == ok.ravel()).all()  # missing cells absent, present cells exactly the cells with a trend
    assert rec["count"] == int(ok.sum()) == len(s)
    assert np.abs(s.astype(np.float64) - slope.ravel()[ok.ravel()]).max() < 1e-6
    assert np.abs(p.astype(np.float64) - pv.ravel()[ok.ravel()]).max() < 1e-6
    assert np.abs(q / 65535.0 - qv.ravel()[ok.ravel()]).max() <= 1 / 65535
    assert not np.isnan(s).any() and not np.isnan(p).any()
    assert rec["spread"] == pytest.approx(float(np.percentile(np.abs(slope[np.isfinite(slope)]), 98)))


def test_land_and_sea_variables_store_only_their_cells(meta):
    by = {v["variable"]: v for v in meta["variables"]}
    assert by["T2M"]["count"] == NCELL
    assert by["GWETROOT"]["count"] < 0.4 * NCELL and by["FRSNO"]["count"] < 0.3 * NCELL
    assert by["FRSEAICE"]["count"] < 0.3 * NCELL
    assert {v: by[v]["surface"] for v in ("GWETROOT", "FRSEAICE", "T2M")} == {"GWETROOT": "land", "FRSEAICE": "sea", "T2M": "any"}


def test_float32_is_accurate_enough_for_every_variable(meta):
    for v in meta["variables"]:
        slope, _, _ = E.coarse_trends(v["variable"])
        assert np.nanmax(np.abs(slope)) < 16  # float32 spacing below 16 is <= 9.6e-7, rounding error <= 4.8e-7


def test_fixture_matches_independent_trend_1d_for_one_cell(meta):
    """One cell recomputed straight from the cache with trend_1d (not trend_grid)."""
    import products
    var = "T2M_MAX"
    lat, lng = E.PLACES["Istanbul"]
    i, j = E.nearest_cell(lat, lng)
    off = products.rules(var)[1]
    series = np.array([products.block_average_valid(products.load_grid(var, exact=True)[k])[i, j] for k in range(45)])
    series = products.from_int16(products.to_int16(series, off), off)
    t = trend_1d(series, np.array(config.YEARS, dtype=np.float64))
    with open(E.FIXTURE) as f:
        fx = json.load(f)["places"]["Istanbul"]["variables"][var]
    assert abs(10 * t["slope"] - fx["slope"]) < 1e-9 and abs(t["p"] - fx["p"]) < 1e-9
