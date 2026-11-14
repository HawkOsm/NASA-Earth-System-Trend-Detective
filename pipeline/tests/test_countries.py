import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import countries as C  # noqa: E402

D = config.WEB_DATA_DIR


@pytest.fixture(scope="module")
def mask():
    m = np.fromfile(os.path.join(D, "country_mask.bin"), dtype=np.uint8)
    assert m.size == 361 * 576
    return m.reshape(361, 576)


@pytest.fixture(scope="module")
def recs():
    with open(os.path.join(D, "countries.json")) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def cities():
    with open(os.path.join(D, "cities.json")) as f:
        return json.load(f)


def idx_of(recs, name):
    return next(r["idx"] for r in recs if r["name"] == name)


@pytest.mark.parametrize("name,lat,lng", [
    ("Turkey", 39.93, 32.86), ("Brazil", -15.79, -47.88), ("Australia", -35.28, 149.13), ("Kenya", -1.29, 36.82),
    ("France", 48.85, 2.35), ("Japan", 35.68, 139.65)  # 139.69 (Tokyo centre) snaps to a sea cell centre,
])
def test_mask_lookup_capitals(mask, recs, name, lat, lng):
    assert C.country_at(mask, lat, lng) == idx_of(recs, name)


@pytest.mark.parametrize("lat,lng", [(0, -150), (42, 51)])
def test_mask_lookup_water(mask, lat, lng):
    assert C.country_at(mask, lat, lng) == 255


def test_mask_reproducible_from_outlines(mask):
    assert np.array_equal(C.build_mask(C.load_countries()), mask)


def test_antimeridian_and_antarctica(mask, recs):
    assert C.country_at(mask, -17.8, 178.0) == idx_of(recs, "Fiji")        # Viti Levu
    assert C.country_at(mask, 66.0, 179.0) == idx_of(recs, "Russia")       # Chukotka, east of the 180 jump
    assert C.country_at(mask, -80.0, 0.0) == idx_of(recs, "Antarctica")
    assert idx_of(recs, "Fiji") in {r["idx"] for r in recs if r.get("wraps")}


def test_records_and_counts(mask, recs):
    assert [r["idx"] for r in recs] == list(range(len(recs))) and len(recs) == 241
    counts = np.bincount(mask.ravel(), minlength=256)
    for r in recs:
        if r["tiny"]:
            assert counts[r["idx"]] == 0 and r["nCells"] == 1 and r["tinyCell"] is not None
        else:
            assert r["nCells"] == counts[r["idx"]] > 0 and r["tinyCell"] is None
        assert -90 <= r["centre"][0] <= 90 and -180 <= r["centre"][1] <= 180
    assert sum(r["tiny"] for r in recs) > 0


def test_turkey_bin_and_first_cell(mask, recs):
    r = next(x for x in recs if x["name"] == "Turkey")
    path = os.path.join(D, "countries", "T2M", f"{r['idx']}.bin")
    assert os.path.getsize(path) == r["nCells"] * 45 * 2
    arr = np.fromfile(path, dtype="<i2").reshape(r["nCells"], 45)
    i, j = np.nonzero(mask == r["idx"])
    cache = np.round(np.load(os.path.join(config.CACHE_DIR, "T2M_annual.npy")).astype(np.float64), 2)
    assert np.array_equal(arr[0], np.rint(cache[:, i[0], j[0]] * 100).astype(np.int16))
    assert np.array_equal(arr[-1], np.rint(cache[:, i[-1], j[-1]] * 100).astype(np.int16))


def test_all_bins_exist_with_right_size(recs):
    for var in config.VARIABLES:
        if config.VARIABLES[var].get("surface") == "sea":  # sea-only variable: no country files (products.has_pieces)
            assert not os.path.exists(os.path.join(D, "countries", var))
            continue
        for r in recs:
            assert os.path.getsize(os.path.join(D, "countries", var, f"{r['idx']}.bin")) == r["nCells"] * 90


@pytest.mark.parametrize("name,country", [("Istanbul", "Turkey"), ("São Paulo", "Brazil"), ("Sydney", "Australia")])
def test_cities(recs, cities, name, country):
    ci = idx_of(recs, country)
    assert any(c["name"] == name and c["country"] == ci for c in cities)


def test_city_rules(recs, cities):
    assert [c["id"] for c in cities] == list(range(len(cities)))
    per = {}
    for c in cities:
        per.setdefault(c["country"], []).append(c)
    for lst in per.values():
        assert len(lst) <= 12
        caps = [c["capital"] for c in lst]
        assert caps == sorted(caps, reverse=True)  # capitals first
    ankara = next(c for c in cities if c["name"] == "Ankara")
    assert ankara["capital"] and per[ankara["country"]][0]["capital"]
    for var in config.VARIABLES:
        assert os.path.getsize(os.path.join(D, f"{var}_cities.bin")) == len(cities) * 90


def test_city_series_is_its_cell(cities):
    c = next(x for x in cities if x["name"] == "Istanbul")
    i, j = C.nearest_cell(c["lat"], c["lng"])
    assert c["cell"] == [C.LATS[i], C.LONS[j]]
    arr = np.fromfile(os.path.join(D, "T2M_cities.bin"), dtype="<i2").reshape(len(cities), 45)
    cache = np.round(np.load(os.path.join(config.CACHE_DIR, "T2M_annual.npy")).astype(np.float64), 2)
    assert np.array_equal(arr[c["id"]], np.rint(cache[:, i, j] * 100).astype(np.int16))


def test_fixture_present():
    with open(C.FIXTURE) as f:
        fx = json.load(f)
    assert len(fx["cases"]) == 12 and fx["years"][0] == 1981 and len(fx["years"]) == 45
