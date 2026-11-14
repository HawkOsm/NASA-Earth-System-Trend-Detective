import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import reference as X  # noqa: E402
import reference_areas as A  # noqa: E402

HAVE_BUILD = os.path.exists(os.path.join(config.CACHE_DIR, "reference_T2M.npz"))
needs_build = pytest.mark.skipif(not HAVE_BUILD, reason="run reference.py once to build the cache")

# Synthetic layout: 4 boxes (nbox = 4), 45 years. Area cells: box 0 holds two cells (lat 0 and 60), box 1 one cell (lat 60),
# box 2 one cell (lat 0), box 3 none.
LAT = np.array([0.0, 60.0])


def _layout():
    boxidx = np.array([[0, 1, 2], [0, 1, -1]])
    cells = np.ones((2, 3), dtype=bool)
    lat = LAT
    return boxidx, cells, lat


def test_weights_hand_computed():
    boxidx, cells, lat = _layout()
    wb = A.box_weights(cells, boxidx, lat, 4)
    # box 0: cos0 + cos60 = 1.5; box 1: cos0 + cos60 = 1.5; box 2: cos0 = 1; box 3: 0; the cell with box -1 counts nowhere
    assert np.allclose(wb, [1.5, 1.5, 1.0, 0.0])


def _series(level, slope=0.02, n=45):
    return level + slope * np.arange(n)


def test_coverage_and_weighted_mean_hand_computed():
    boxidx, cells, lat = _layout()
    wb = A.box_weights(cells, boxidx, lat, 4)
    R = np.stack([_series(1.0), _series(3.0), _series(10.0), _series(0.0)], axis=1)   # [45][4]
    M = R * 1.0
    contrib = np.array([True, True, False, False])       # box 2 is not eligible
    entry, why = A.area_entry("T2M", wb, contrib, R, M)
    assert why is None
    assert entry["coverage"] == pytest.approx(3.0 / 4.0)
    ra = (1.5 * R[:, 0] + 1.5 * R[:, 1]) / 3.0            # the hand-computed weighted mean
    assert entry["refSlope"] == pytest.approx(X.trend_of(ra)[0])
    assert entry["refSlope"] == pytest.approx(0.2)         # 0.02 per year = 0.2 per decade
    assert entry["merraSlope"] == pytest.approx(0.2)
    assert entry["badYears"] == [] and entry["sizeDiffers"] is False


def test_r_a_is_the_weighted_mean_not_the_plain_mean():
    boxidx, cells, lat = _layout()
    wb = A.box_weights(cells, boxidx, lat, 4)
    R = np.stack([_series(0.0, 0.01), _series(0.0, 0.03), _series(0.0, 0.0), _series(0.0, 0.0)], axis=1)
    contrib = np.array([True, True, True, False])
    entry, _ = A.area_entry("T2M", wb, contrib, R, R.copy())
    expect = (1.5 * 0.01 + 1.5 * 0.03 + 1.0 * 0.0) / 4.0 * 10
    assert entry["refSlope"] == pytest.approx(expect)


def test_area_in_ineligible_boxes_is_unchecked():
    boxidx, cells, lat = _layout()
    wb = A.box_weights(cells, boxidx, lat, 4)
    R = np.stack([_series(1.0)] * 4, axis=1)
    entry, why = A.area_entry("T2M", wb, np.zeros(4, dtype=bool), R, R.copy())
    assert entry is None and why == "coverage"
    # coverage just under a half is unchecked, exactly a half is checked
    contrib = np.array([False, False, True, False])      # 1.0 of 4.0
    assert A.area_entry("T2M", wb, contrib, R, R.copy())[1] == "coverage"
    contrib = np.array([True, False, False, False])      # 1.5 of 4.0
    assert A.area_entry("T2M", wb, contrib, R, R.copy())[1] == "coverage"
    contrib = np.array([True, False, True, False])       # 2.5 of 4.0
    assert A.area_entry("T2M", wb, contrib, R, R.copy())[0]["coverage"] == pytest.approx(0.625)


def test_empty_area_is_unchecked():
    wb = np.zeros(4)
    R = np.stack([_series(1.0)] * 4, axis=1)
    assert A.area_entry("T2M", wb, np.ones(4, dtype=bool), R, R.copy()) == (None, "coverage")


def test_box_with_missing_reference_year_does_not_contribute():
    # T2M layout: box 0 land and used, with a complete reference; box 1 has one missing reference year
    nb = 16200
    R = np.full((45, nb), 1.0)
    R[7, 1] = np.nan
    used = np.zeros(nb, dtype=bool)
    used[:3] = True
    land = used.copy()
    c = A.contributing("T2M", R, used, land)
    assert list(c[:4]) == [True, False, True, False]


def test_bad_year_found_on_area_series():
    boxidx, cells, lat = _layout()
    wb = A.box_weights(cells, boxidx, lat, 4)
    rng = np.random.default_rng(3)
    base = 5.0 + rng.normal(0, 0.05, 45)
    R = np.stack([base] * 4, axis=1)
    M = R + rng.normal(0, 0.05, R.shape)
    M[30, :] += 3.0
    contrib = np.ones(4, dtype=bool)
    entry, _ = A.area_entry("T2M", wb, contrib, R, M)
    assert entry["badYears"] == [int(X.YEARS[30])]


@needs_build
def test_real_turkey_t2m_coverage_above_90_percent():
    doc, _ = A.compute_var("T2M")
    with open(os.path.join(config.WEB_DATA_DIR, "countries.json")) as f:
        tr = [r["idx"] for r in json.load(f) if r["name"] == "Turkey"][0]
    e = doc["countries"][str(tr)]
    assert e["coverage"] > 0.9
    assert e["refSlope"] > 0 and e["refP"] < 0.05
    assert doc["unchecked"]["seas"] and all(v == "sea" for v in doc["unchecked"]["seas"].values())
    assert "World" in doc["regions"]
