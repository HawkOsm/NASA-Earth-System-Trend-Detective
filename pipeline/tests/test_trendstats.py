import json
import math
import os
import sys

import numpy as np
import pytest
from scipy.special import erfc
from scipy.stats import false_discovery_control, theilslopes

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from export import colorize, map_to_pixels, WIDTH, HEIGHT  # noqa: E402
from trendstats import KEYS, bh_adjust, trend_1d, trend_grid, verdict  # noqa: E402

T45 = np.arange(1981, 2026, dtype=np.float64)
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "stats_cases.json")
LAT = np.linspace(-90.0, 90.0, 361)
LON = -180.0 + 0.625 * np.arange(576)


def ar1(rng, n, phi):
    e = np.empty(n)
    e[0] = rng.normal(0, 1 / math.sqrt(1 - phi ** 2))
    for k in range(1, n):
        e[k] = phi * e[k - 1] + rng.normal()
    return e


def p_from_var(s, var):
    if var == 0 or s == 0:
        return 1.0
    z = (s - 1) / math.sqrt(var) if s > 0 else (s + 1) / math.sqrt(var)
    return float(erfc(abs(z) / math.sqrt(2)))


# 1
def test_known_slope():
    slopes, covered, sig = [], 0, 0
    for seed in range(200):
        rng = np.random.default_rng(seed)
        y = 0.03 * T45 + rng.normal(0, 0.2, 45)
        r = trend_1d(y, T45)
        slopes.append(r["slope"])
        covered += r["ci_low"] <= 0.03 <= r["ci_high"]
        sig += r["p"] < 0.05
    print(f"median slope {np.median(slopes):.5f}, CI coverage {covered / 200:.3f}, p<0.05 rate {sig / 200:.3f}")
    assert abs(np.median(slopes) - 0.03) < 0.002
    assert covered / 200 >= 0.90
    assert sig / 200 >= 0.95


# 2
def test_white_noise_false_positive_rate():
    hits = sum(trend_1d(np.random.default_rng(s).normal(0, 1, 45), T45)["p"] < 0.05 for s in range(2000))
    rate = hits / 2000
    print(f"white noise p<0.05 rate: {rate:.4f}")
    assert 0.02 <= rate <= 0.07


# 3
def test_ar1_correction_reduces_false_positives():
    corr = raw = 0
    for s in range(2000):
        r = trend_1d(ar1(np.random.default_rng(s), 45, 0.6), T45)
        corr += r["p"] < 0.05
        raw += p_from_var(r["s"], r["var0"]) < 0.05
    print(f"AR(1) phi=0.6 p<0.05 rate: corrected {corr / 2000:.4f}, uncorrected (var0) {raw / 2000:.4f}")
    assert corr < raw


# 4
def test_grid_matches_1d():
    rng = np.random.default_rng(7)
    arr = np.round(rng.normal(0, 0.05, (45, 7, 9)) + 0.003 * (T45 - T45.mean())[:, None, None], 2)
    zero = rng.random((45, 7, 9)) < 0.5
    arr[:, :2, :] = np.where(zero[:, :2, :], 0.0, np.abs(arr[:, :2, :]))  # zero-inflated rows
    arr[:, 3, 4] = 2.5                                                    # constant cell
    arr[:, 5, 5] = np.round(rng.normal(0, 0.02, 45), 1)                   # heavy ties
    arr[10, 6, 8] = np.nan                                                # NaN cell
    g = trend_grid(arr, T45, block_rows=3)
    for a in range(7):
        for b in range(9):
            r = trend_1d(arr[:, a, b], T45)
            for k in KEYS:
                assert np.isclose(g[k][a, b], r[k], rtol=0, atol=1e-9, equal_nan=True), (a, b, k)
    assert np.all(np.isnan([g[k][6, 8] for k in KEYS]))
    assert g["p"][3, 4] == 1.0 and g["slope"][3, 4] == 0.0


# 5
def test_matches_pymannkendall():
    import pymannkendall as mk
    checked = 0
    for seed in range(50):
        rng = np.random.default_rng(1000 + seed)
        y = np.round(rng.normal(0, 0.3, 45) + 0.004 * np.arange(45), 1)
        r = trend_1d(y, T45)
        if r["factor"] != 1.0:
            continue
        m = mk.original_test(y)
        checked += 1
        assert abs(r["s"] - m.s) <= 1e-9
        assert abs(r["var0"] - m.var_s) <= 1e-9
        assert abs(r["z"] - m.z) <= 1e-9
        assert abs(r["p"] - m.p) <= 1e-9
        assert abs(r["slope"] - m.slope) <= 1e-9
    print(f"compared {checked} factor==1 series with pymannkendall")
    assert checked > 0


# 6
def test_matches_theilslopes():
    for seed in range(50):
        rng = np.random.default_rng(2000 + seed)
        y = rng.normal(0, 1, 45) + 0.02 * T45
        assert abs(trend_1d(y, T45)["slope"] - theilslopes(y, T45)[0]) <= 1e-12


# 7
def test_bh_adjust():
    p = np.random.default_rng(3).random(1000) ** 3
    assert np.max(np.abs(bh_adjust(p) - false_discovery_control(p, method="bh"))) <= 1e-12
    p2 = np.random.default_rng(4).random((6, 8))
    p2[1, 2] = p2[4, 7] = np.nan
    q2 = bh_adjust(p2)
    assert q2.shape == p2.shape
    assert np.array_equal(np.isnan(q2), np.isnan(p2))
    fin = np.isfinite(p2)
    assert np.allclose(q2[fin], false_discovery_control(p2[fin], method="bh"), rtol=0, atol=1e-12)


# 8
def test_verdict():
    s = verdict(0.32, 0.01, "C")
    assert "significant" in s and "Rising" in s and "0.32" in s and "not" not in s
    s = verdict(-0.15, 0.07, "mm/day")
    assert "possible trend" in s.lower() and "needs more years" in s and "falling" in s and "0.15" in s
    s = verdict(-0.04, 0.5, "mm/day")
    assert s.startswith("No clear trend") and "falling" in s and "0.04 mm/day per decade" in s
    s = verdict(0.04, 0.5, "m/s")
    assert "rising" in s and "0.04 m/s per decade" in s


# 9
def test_fixtures():
    assert os.path.exists(FIXTURES)
    with open(FIXTURES) as f:
        cases = json.load(f)
    assert len(cases) >= 20
    assert sum(c["expected"]["factor"] > 1 for c in cases) >= 2
    for c in cases:
        r = trend_1d(np.array(c["y"]), np.array(c["t"]))
        for k in KEYS:
            assert abs(r[k] - c["expected"][k]) <= 1e-12, (c["name"], k)


# 10
@pytest.mark.parametrize("lat,lon", [(41.01, 28.97), (-33.87, 151.21)])
def test_texture_orientation(lat, lon):
    ia = int(np.argmin(np.abs(LAT - lat)))
    io = int(np.argmin(np.abs(LON - lon)))
    grid = np.zeros((361, 576))
    grid[ia, io] = 1.0
    img = map_to_pixels(grid, LAT, LON)
    assert img.shape == (HEIGHT, WIDTH)
    ys, xs = np.nonzero(img == 1.0)
    ex = (LON[io] + 180) / 360 * WIDTH
    ey = (90 - LAT[ia]) / 180 * HEIGHT
    print(f"({lat},{lon}) cell ({LAT[ia]},{LON[io]}): centroid x={xs.mean() + 0.5:.2f} y={ys.mean() + 0.5:.2f}, "
          f"expected x={ex:.2f} y={ey:.2f}")
    assert abs(xs.mean() + 0.5 - ex) <= 2 and abs(ys.mean() + 0.5 - ey) <= 2
    # same check through the colouring step used for the PNG
    rgb = colorize(img, np.zeros_like(img), 1.0, "RdBu_r")
    bg = colorize(np.zeros((1, 1)), np.zeros((1, 1)), 1.0, "RdBu_r")[0, 0]
    ys2, xs2 = np.nonzero(np.any(rgb != bg, axis=-1))
    assert abs(xs2.mean() + 0.5 - ex) <= 2 and abs(ys2.mean() + 0.5 - ey) <= 2


def test_verdict_fixture_reproduces():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "verdict_cases.json")
    with open(path, encoding="utf-8") as f:
        cases = json.load(f)
    assert len(cases) >= 40
    for c in cases:
        assert verdict(c["slope_per_decade"], c["p"], c["units"]) == c["expected"]
