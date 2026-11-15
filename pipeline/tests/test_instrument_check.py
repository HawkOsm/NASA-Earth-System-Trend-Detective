"""Satellite check (instrument_check.py): box means over valid cells, classes, and the shipped files."""
import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import instrument_check as IC  # noqa: E402


def one_degree(value=1.0, years=3):
    lat = -89.5 + np.arange(180)
    lon = -179.5 + np.arange(360)
    return np.full((years, 180, 360), value, dtype=np.float64), lat, lon


def test_box_mean_of_a_constant_field_is_the_constant():
    g, lat, lon = one_degree(7.0)
    out = IC.box_mean_valid(g, lat, lon)
    assert out.shape == (3, IC.NLAT, IC.NLON)
    assert np.allclose(out, 7.0)


def test_box_mean_uses_valid_cells_and_needs_half_the_area():
    g, lat, lon = one_degree(0.0, years=1)
    # box centred 1 N, 1 E holds the four cells 0.5 / 1.5 N x 0.5 / 1.5 E
    i, j = IC.box_index(1.0, 1.0)
    cells = [(90, 180), (90, 181), (91, 180), (91, 181)]
    for (a, b), v in zip(cells, (2.0, 4.0, 6.0, 8.0)):
        g[0, a, b] = v
    assert IC.box_mean_valid(g, lat, lon)[0, i, j] == pytest.approx(5.0, abs=1e-3)
    g[0, 90, 180] = np.nan                      # three of four cells: still valid, mean of the three
    assert IC.box_mean_valid(g, lat, lon)[0, i, j] == pytest.approx(6.0, abs=2e-3)
    g[0, 90, 181] = np.nan
    g[0, 91, 180] = np.nan                      # one of four: below half
    assert np.isnan(IC.box_mean_valid(g, lat, lon)[0, i, j])


def test_merra_grid_cells_on_a_box_edge_go_to_the_upper_box():
    lat = -90 + 0.5 * np.arange(361)
    lon = -180 + 0.625 * np.arange(576)
    g = np.zeros((1, 361, 576))
    g[0, lat == 0.0, :] = 10.0                 # the equator row is the lower edge of the box centred 1 N
    out = IC.box_mean_valid(g, lat, lon)
    i_n, _ = IC.box_index(1.0, 0.0)
    i_s, _ = IC.box_index(-1.0, 0.0)
    assert out[0, i_n, 0] > 0 and out[0, i_s, 0] == 0


def test_classes():
    f = lambda *a: int(IC.classify(*[np.array([x]) for x in a])[0])  # noqa: E731
    assert IC.CLASSES[f(0.6, 0.001, 0.6, 0.006)] == "agree"
    assert IC.CLASSES[f(0.7, 0.016, 0.4, 0.2)] == "not_confirmed"
    assert IC.CLASSES[f(0.7, 0.016, -0.4, 0.02)] == "contradicted"
    assert IC.CLASSES[f(0.1, 0.3, 0.4, 0.02)] == "instrument"
    assert IC.CLASSES[f(0.1, 0.3, -0.1, 0.4)] == "neither"
    assert IC.CLASSES[f(0.1, 0.05, 0.1, 0.05)] == "neither"
    assert IC.CLASSES[f(np.nan, 0.01, 0.1, 0.01)] == "none"


def test_box_index_matches_the_browser():
    assert IC.box_index(-90, -180) == (0, 0)
    assert IC.box_index(31.22, 121.43) == (60, 150)
    assert IC.box_index(90, 0) == (89, 90)
    assert IC.box_index(0, 180) == IC.box_index(0, -180)


@pytest.mark.parametrize("var", list(IC.INSTRUMENTS))
def test_shipped_file_is_consistent(var):
    path = os.path.join(config.WEB_DATA_DIR, "instruments", f"{var}.json")
    if not os.path.exists(path):
        pytest.skip("not built")
    d = json.load(open(path))
    n = d["nlat"] * d["nlon"]
    assert all(len(d[k]) == n for k in ("merraSlope", "merraP", "instSlope", "instP"))
    arr = {k: np.array([np.nan if x is None else x for x in d[k]]) for k in ("merraSlope", "merraP", "instSlope", "instP")}
    cls = IC.classify(arr["merraSlope"], arr["merraP"], arr["instSlope"], arr["instP"])
    assert int((cls > 0).sum()) == d["summary"]["nBoxes"]
    blat = np.repeat(d["lat0"] + d["dlat"] * np.arange(d["nlat"]), d["nlon"])
    w = np.cos(np.radians(blat))
    sig = (cls > 0) & (arr["merraP"] < 0.05)
    assert w[sig & (cls == 1)].sum() / w[sig].sum() == pytest.approx(d["summary"]["agree"], abs=2e-3)
    limit = IC.INSTRUMENTS[var]["lat_limit"]
    assert not np.any((cls > 0) & (np.abs(blat) >= limit))
