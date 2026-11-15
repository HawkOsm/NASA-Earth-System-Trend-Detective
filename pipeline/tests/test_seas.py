import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config  # noqa: E402
from areas import countries as C  # noqa: E402
from areas import seas as S  # noqa: E402

D = config.WEB_DATA_DIR


@pytest.fixture(scope="module")
def mask():
    m = np.fromfile(os.path.join(D, "sea_mask.bin"), dtype=np.uint8)
    assert m.size == 361 * 576
    return m.reshape(361, 576)


@pytest.fixture(scope="module")
def recs():
    with open(os.path.join(D, "seas.json")) as f:
        return json.load(f)


def idx_of(recs, name):
    return next(r["idx"] for r in recs if r["name"] == name)


@pytest.mark.parametrize("name,lat,lng", [
    ("Black Sea", 43, 34), ("Mediterranean Sea", 35, 18), ("North Pacific Ocean", 30, -170),
    ("North Pacific Ocean", 30, 170), ("Bay of Biscay", 45.5, -4), ("Bering Sea", 58.5, -179.375),
    ("Bering Sea", 58.5, 175),
])
def test_sea_lookup(mask, recs, name, lat, lng):
    assert S.sea_at(mask, lat, lng) == idx_of(recs, name)


def test_biscay_is_not_north_atlantic(mask, recs):
    assert S.sea_at(mask, 45.5, -4) != idx_of(recs, "North Atlantic Ocean")


def test_land_is_not_a_sea(mask):
    assert S.sea_at(mask, 39.93, 32.86) == 255  # Ankara


def test_sea_cells_are_water_cells(mask):
    cm = np.fromfile(os.path.join(D, "country_mask.bin"), dtype=np.uint8).reshape(361, 576)
    assert (cm[mask != 255] == 255).all()


def test_names_and_indices(recs):
    assert [r["idx"] for r in recs] == list(range(len(recs))) == list(range(118))
    names = {r["name"] for r in recs}
    assert "Southern Ocean" in names and "Indian Ocean" in names
    assert "SOUTHERN OCEAN" not in names and "INDIAN OCEAN" not in names
    for r in recs:
        if r["nCells"]:
            assert r["wraps"] in (True, False) and r["bbox"][0] <= r["centre"][0] <= r["bbox"][1]


def test_mask_reproducible(mask):
    cm = np.fromfile(os.path.join(D, "country_mask.bin"), dtype=np.uint8).reshape(361, 576)
    assert np.array_equal(S.build_sea_mask(S.load_seas(), cm), mask)


def test_file_sizes_match_ncells(recs):
    for r in recs:
        n = r["nCells"]
        cells = os.path.join(D, "seas", f"{r['idx']}.cells.bin")
        if n == 0:
            assert not os.path.exists(cells)
            continue
        assert os.path.getsize(cells) == n * 8
        for var in config.VARIABLES:
            if config.VARIABLES[var].get("surface") == "land":  # land-only variable: no sea files (products.has_pieces)
                assert not os.path.exists(os.path.join(D, "seas", var))
                continue
            assert os.path.getsize(os.path.join(D, "seas", var, f"{r['idx']}.bin")) == n * 45 * 2


def test_resolutions(mask, recs):
    big = [r for r in recs if r["dlat"] == 1.0]
    assert {r["name"] for r in big} >= {"North Pacific Ocean", "Southern Ocean", "Indian Ocean"}
    for r in recs:
        full = int((mask == r["idx"]).sum())
        assert (r["dlat"], r["dlng"]) == ((1.0, 1.25) if full > S.FULL_MAX else (0.5, 0.625)) or full == 0
    npac = next(r for r in recs if r["name"] == "North Pacific Ocean")
    assert npac["dlat"] == 1.0 and npac["dlng"] == 1.25 and npac["wraps"] and npac["bbox"][3] > 180
    cells = S.read_cells(npac)
    assert np.allclose(cells[:, 0] % 1.0, 0) and np.allclose((cells[:, 1] + 180.0) / 1.25 % 1.0, 0)
    # coarse cell membership = full-resolution mask at the same point
    i = np.rint(cells[:, 0] + 90).astype(int) * 2
    j = np.rint((cells[:, 1] + 180) / 0.625).astype(int)
    assert (mask[i, j] == npac["idx"]).all()
    small = next(r for r in recs if r["name"] == "Black Sea")
    assert small["dlat"] == 0.5 and small["nCells"] == int((mask == small["idx"]).sum())


def test_coarse_values_are_block_means(recs):
    npac = next(r for r in recs if r["name"] == "North Pacific Ocean")
    cells = S.read_cells(npac)
    grid = C.load_grid("T2M")
    k = 1234
    ci, cj = int(round(cells[k, 0] + 90)), int(round((cells[k, 1] + 180) / 1.25))
    from maps.export_wind import block_average
    want = np.round(np.array([block_average(grid[y], None, None)[ci, cj] for y in range(45)]), 2)
    got = S.read_values("T2M", npac)[k]
    assert np.allclose(got, want, atol=1e-9)


def test_outlines(recs):
    with open(os.path.join(D, "seas", "outlines.json")) as f:
        o = json.load(f)
    assert len(o) == len(recs)
    for polys in o.values():
        for poly in polys:
            for ring in poly:
                assert len(ring) >= 4 and ring[0] == ring[-1]


def test_fixture_reproduces_from_files(recs):
    with open(os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "sea_cases.json")) as f:
        fx = json.load(f)
    assert len(fx["cases"]) == 12
    for case in fx["cases"]:
        rec = recs[case["idx"]]
        lat = S.read_cells(rec)[:, 0].astype(np.float64)
        ser, nk = C.weighted_mean_series(lat, S.read_values(case["variable"], rec))
        assert nk == case["nCellsUsed"] and rec["nCells"] == case["nCells"]
        assert np.allclose(ser, case["series"], atol=1e-9)
