import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config  # noqa: E402
from areas import countries as C  # noqa: E402
from core import products  # noqa: E402
from areas import regions as R  # noqa: E402
from core.trendstats import trend_1d  # noqa: E402

D = config.WEB_DATA_DIR


@pytest.fixture(scope="module")
def recs():
    return R.load_country_records()


@pytest.fixture(scope="module")
def mapping():
    return R.load_mapping()


@pytest.fixture(scope="module")
def cmask():
    return R.load_country_mask()


@pytest.fixture(scope="module")
def rmask():
    return np.load(R.MASK_NPY)


@pytest.fixture(scope="module")
def data():
    with open(R.REGIONS_JSON) as f:
        return json.load(f)


def region_near(rmask, cmask, lat, lng):
    """Region name of the nearest LAND cell within one cell of the point (a coastal city's own cell can be water)."""
    i0, j0 = C.nearest_cell(lat, lng)
    best = None
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            i, j = i0 + di, (j0 + dj) % C.NLON
            if 0 <= i < C.NLAT and cmask[i, j] != R.NONE:
                d = (C.LATS[i] - lat) ** 2 + (C.LONS[j] - lng) ** 2
                if best is None or d < best[0]:
                    best = (d, rmask[i, j])
    return None if best is None or best[1] == R.NONE else R.CONTINENTS[best[1]]


def test_mapping_covers_every_country_with_a_known_continent(recs, mapping):
    assert set(mapping) == {r["name"] for r in recs}
    assert set(mapping.values()) <= set(R.CONTINENTS)
    non_tiny = [r["name"] for r in recs if not r["tiny"]]
    assert len(non_tiny) > 150 and all(n in mapping for n in non_tiny)


@pytest.mark.parametrize("name,continent", [
    ("Germany", "Europe"), ("Turkey", "Asia"), ("Japan", "Asia"), ("Egypt", "Africa"), ("Brazil", "South America"),
    ("Mexico", "North America"), ("Australia", "Oceania"), ("Antarctica", "Antarctica"), ("Greenland", "North America")])
def test_country_continents(mapping, name, continent):
    assert mapping[name] == continent


@pytest.mark.parametrize("name,lat,lng,continent", [
    ("Paris", 48.85, 2.35, "Europe"), ("Moscow", 55.75, 37.62, "Europe"), ("Novosibirsk", 55.03, 82.92, "Asia"),
    ("Ankara", 39.93, 32.86, "Asia"), ("Tokyo", 35.68, 139.69, "Asia"), ("Cayenne", 4.9, -52.3, "South America"),
    ("Nuuk", 64.18, -51.72, "North America"), ("Sydney", -33.87, 151.21, "Oceania"), ("Nairobi", -1.29, 36.82, "Africa"),
    ("Anadyr", 64.73, 177.5, "Asia"), ("Kaliningrad", 54.71, 20.51, "Europe"), ("Reykjavik", 64.15, -21.94, "Europe"),
    ("Saint-Denis, Reunion", -20.88, 55.45, "Africa"), ("Las Palmas", 28.12, -15.43, "Africa"),
    ("McMurdo", -77.85, 166.67, "Antarctica")])
def test_cities_in_the_right_region(rmask, cmask, name, lat, lng, continent):
    assert region_near(rmask, cmask, lat, lng) == continent


def test_region_mask_basics(rmask, cmask):
    assert rmask.shape == cmask.shape and rmask.dtype == np.uint8
    assert ((rmask == R.NONE) == (cmask == R.NONE)).all()  # nothing is dropped in the shipped data; the rule is tested below
    assert set(np.unique(rmask)) - {R.NONE} == set(range(len(R.CONTINENTS)))


def test_overseas_rules(mapping):
    assert R.cell_continent("France", 4.9, -52.3, mapping)[0] == "South America"
    assert R.cell_continent("France", 16.2, -61.5, mapping)[0] == "North America"
    assert R.cell_continent("France", -21.1, 55.5, mapping)[0] == "Africa"
    assert R.cell_continent("France", 48.8, 2.3, mapping) == ("Europe", "")
    assert R.cell_continent("France", -60.0, 100.0, mapping)[0] is None  # nowhere obvious: dropped
    assert R.cell_continent("Russia", 59.99, 60.0, mapping)[0] == "Asia"
    assert R.cell_continent("Russia", 59.9, 59.9, mapping)[0] == "Europe"
    assert R.cell_continent("Russia", 66.0, -170.0, mapping)[0] == "Asia"
    assert R.cell_continent("Russia", 66.0, 179.9, mapping)[0] == "Asia"


def test_russia_is_split(rmask, cmask, recs):
    ru = next(r["idx"] for r in recs if r["name"] == "Russia")
    ii, jj = np.nonzero(cmask == ru)
    for i, j in zip(ii, jj):
        lng = C.LONS[j]
        assert R.CONTINENTS[rmask[i, j]] == ("Asia" if (lng >= 60 or lng < -168) else "Europe")


@pytest.mark.parametrize("var,name", [("T2M", "Europe"), ("T2M_MAX", "Africa"), ("PRECTOTCORR", "Asia"), ("FRSNO", "North America"),
                                      ("GWETROOT", "World")])
def test_region_equals_independent_trend(data, rmask, cmask, var, name):
    cells = (cmask != R.NONE) if name == "World" else (rmask == R.CONTINENTS.index(name))
    grid = products.load_grid(var)
    ok = cells & ~np.isnan(grid).any(axis=0)
    lat = np.broadcast_to(C.LATS[:, None], cells.shape)[ok]
    w = np.cos(np.radians(lat))
    series = np.array([(grid[y][ok] * w).sum() / w.sum() for y in range(grid.shape[0])])
    t = trend_1d(series, np.array(config.YEARS, dtype=float))
    reg = next(r for r in data["regions"] if r["name"] == name)["variables"][var]
    assert reg["nWithData"] == int(ok.sum())
    assert reg["slopePerDecade"] == pytest.approx(10 * t["slope"], rel=1e-5, abs=1e-9)
    assert reg["ciLow"] == pytest.approx(10 * t["ci_low"], rel=1e-5, abs=1e-9)
    assert reg["ciHigh"] == pytest.approx(10 * t["ci_high"], rel=1e-5, abs=1e-9)
    assert reg["p"] == pytest.approx(t["p"], rel=1e-5, abs=1e-12)
    # map shares: independent recount from the trend file
    tr = np.load(os.path.join(config.CACHE_DIR, f"{var}_trend.npz"))
    q, s = tr["q"][ok], tr["slope_decade"][ok]
    assert reg["fracRising"] == pytest.approx(w[(q < 0.05) & (s > 0)].sum() / w.sum(), abs=1e-5)
    assert reg["fracFalling"] == pytest.approx(w[(q < 0.05) & (s < 0)].sum() / w.sum(), abs=1e-5)


def test_cells_with_data_are_the_cells_the_map_has(data, rmask):
    """nWithData (no missing year) equals the number of region cells the trend map has a value for."""
    for var in ("T2M", "FRSNO", "GWETROOT"):
        tr = np.load(os.path.join(config.CACHE_DIR, f"{var}_trend.npz"))
        has = np.isfinite(tr["q"])
        for k, name in enumerate(R.CONTINENTS):
            reg = next(r for r in data["regions"] if r["name"] == name)["variables"][var]
            n = int((has & (rmask == k)).sum())
            assert (reg is None and n == 0) or reg["nWithData"] == n


def test_json_shape(data):
    names = [r["name"] for r in data["regions"]]
    assert names == R.CONTINENTS + ["World"]
    assert data["years"] == [1981, 2025]
    for r in data["regions"]:
        assert 1.6 <= r["altitude"] <= 2.4 and len(r["centre"]) == 2
        assert set(r["variables"]) == set(config.VARIABLES)
        assert r["variables"]["FRSEAICE"] is None  # a sea variable has no value for a land region
    assert next(r for r in data["regions"] if r["name"] == "Europe")["topCountries"][:2] == ["Russia", "Germany"]
    assert os.path.getsize(R.REGIONS_JSON) < 40000


def test_fixture_matches_shipped_file(data):
    with open(R.FIXTURE) as f:
        fx = json.load(f)
    assert [r["name"] for r in fx["regions"]] == ["Europe", "Africa"]
    for r in fx["regions"]:
        shipped = next(x for x in data["regions"] if x["name"] == r["name"])
        # the shipped file also carries the evaluation layer's "quality" per variable (export_quality.py); the rest is the fixture
        stripped = {**shipped, "variables": {v: (None if e is None else {k: x for k, x in e.items() if k != "quality"})
                                              for v, e in shipped["variables"].items()}}
        assert r == stripped
