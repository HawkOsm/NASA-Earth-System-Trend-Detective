import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from maps import basemap  # noqa: E402
from core import config  # noqa: E402
from maps.export import legend_stops, overlay_rgb  # noqa: E402

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "overlay_cases.json")


@pytest.fixture(scope="module")
def img():
    with open(basemap.LAND_JSON) as f:
        return basemap.render(json.load(f))


def test_basemap_self_check(img):
    assert img.shape == (1152, 2304, 3)
    assert basemap.self_check(img) == []
    assert (img[-1] == np.array(config.BASEMAP_LAND)).all()  # Antarctica reaches the bottom edge


def test_basemap_only_two_colours_mostly(img):
    ocean = np.array(config.BASEMAP_OCEAN)
    land = np.array(config.BASEMAP_LAND)
    pure = (img == ocean).all(-1) | (img == land).all(-1)
    assert pure.mean() > 0.93  # the rest is anti-aliased coast (measured 0.959)
    assert 0.2 < (img == land).all(-1).mean() < 0.4  # about 29 % of the globe is land


def test_overlay_fixture_reproduces():
    with open(FIX) as f:
        d = json.load(f)
    assert len(d["cases"]) >= 30
    for c in d["cases"]:
        out = overlay_rgb(np.array([c["t"]]), np.array([c["w"]]), 1.0, c["colormap_stops"], np.array([c["base"]]))[0]
        assert list(map(int, out)) == c["expected"]


def test_overlay_rule_properties():
    stops = [f"#{i * 20:02x}{i * 10:02x}{255 - i * 20:02x}" for i in range(11)]
    base = np.array([[176, 205, 150]] * 4, dtype=np.uint8)
    s = np.array([0.0, 0.8, 0.8, np.nan])
    w = np.array([1.0, 0.0, 1.0, 1.0])
    out = overlay_rgb(s, w, 1.0, stops, base)
    assert (out[0] == base[0]).all() and (out[1] == base[1]).all() and (out[3] == base[3]).all()
    assert not (out[2] == base[2]).all()
    # alpha is monotone in |slope| and the strongest cloud is nearly solid
    ls = legend_stops(stops)
    assert len(ls) == 21 and ls[10]["alpha"] == 0 and ls[0]["alpha"] == ls[20]["alpha"] == config.ALPHA_MAX
    al = [x["alpha"] for x in ls[10:]]
    assert al == sorted(al)
