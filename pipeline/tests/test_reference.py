import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import products  # noqa: E402
import reference as X  # noqa: E402

FIX = os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "reference_cases.json")
with open(FIX) as _f:
    CASES = json.load(_f)
HAVE_GPCP = os.path.exists(X.GPCP_NPY)
HAVE_BUILD = os.path.exists(os.path.join(config.CACHE_DIR, "reference_PRECTOTCORR.npz"))
needs_gpcp = pytest.mark.skipif(not HAVE_GPCP, reason="run reference.py once to cache GPCP")
needs_build = pytest.mark.skipif(not HAVE_BUILD, reason="run reference.py once to build the cache")


def planted(series_len=45, size=3.0, at=39, noise_seed=1, noise=0.1):
    rng = np.random.default_rng(noise_seed)
    r = 5.0 + rng.normal(0, noise, series_len)
    m = r * 1.1 + rng.normal(0, noise, series_len)
    m = m.copy()
    m[at] += size
    return m, r


# ---- box averaging -------------------------------------------------------------------------------------------------

def test_box_average_hand_computed_weights():
    c = CASES["box_average"]
    lat, lon = np.array(c["lat"], float), np.array(c["lon"], float)
    g = np.array([c["grid_year0"], np.array(c["grid_year0"]) * 2.0])
    b = c["box"]
    out = X.box_means(g, lat, lon, b["lat0"], b["dlat"], b["nlat"], b["lon0"], b["dlon"], b["nlon"])
    w1 = np.cos(np.radians(30.0))
    expected = (1.0 * (2 + 3) / 2 + w1 * (6 + 7) / 2) / (1.0 + w1)
    assert expected == pytest.approx(c["expected_year0"], abs=1e-6)
    assert out.shape == (2, 1, 1)
    assert out[0, 0, 0] == pytest.approx(expected, abs=1e-12)
    assert out[1, 0, 0] == pytest.approx(2 * expected, abs=1e-12)


def test_box_average_lower_edge_inclusive_upper_exclusive_and_missing():
    lat = np.array([0.0, 10.0, 20.0])
    lon = np.array([0.0, 1.0])
    g = np.ones((2, 3, 2))
    g[:, 2, :] = 1000.0  # lat 20 is the upper edge of box [10, 20): must be excluded
    g[:, 1, :] = 3.0     # lat 10 is the lower edge: must be included
    g[:, 0, :] = 100.0   # below the box
    out = X.box_means(g, lat, lon, 15.0, 10.0, 1, 0.5, 1.0, 1)  # lat box [10, 20), lon box [0, 1)
    assert out[0, 0, 0] == pytest.approx(3.0)
    g[1, 1, 0] = np.nan  # one missing cell in year 1 -> that year is missing, year 0 is not
    out = X.box_means(g, lat, lon, 15.0, 10.0, 1, 0.5, 1.0, 1)
    assert out[0, 0, 0] == pytest.approx(3.0) and np.isnan(out[1, 0, 0])


# ---- bad-year rule -------------------------------------------------------------------------------------------------

def test_planted_rain_year_found():
    m, r = planted(size=CASES["bad_year"]["planted_size"], at=39)
    bad, d, z = X.bad_years("PRECTOTCORR", m, r)
    assert list(np.flatnonzero(bad)) == [39]
    assert z[39] > 5


def test_gradual_drift_has_no_bad_year():
    t = np.arange(45)
    r = 5.0 + 0.01 * np.sin(t)
    m = 1.1 * r + 0.03 * t  # a drift of 1.3 mm/day over the series, no jump
    bad, _, _ = X.bad_years("PRECTOTCORR", m + 0.02 * np.cos(3 * t), r)
    assert not bad.any()
    # temperature drift likewise
    bad, _, _ = X.bad_years("T2M", 10 + 0.03 * t + 0.01 * np.sin(t), 0.02 * t + 0.01 * np.cos(2 * t))
    assert not bad.any()


def test_floor_blocks_tiny_but_many_mad_deviations():
    rng = np.random.default_rng(3)
    r = 5.0 + rng.normal(0, 0.001, 45)
    m = 1.1 * r + rng.normal(0, 0.001, 45)
    m[10] += 0.05  # about 50 MAD, but far below FLOOR = 1 mm/day
    d, ok, c = X.difference_series("PRECTOTCORR", m, r)
    z, med, _ = X.mad_z(d[ok])
    assert abs(z[10]) > 5
    assert not X.bad_years("PRECTOTCORR", m, r)[0].any()
    # the same shape in temperature: 0.2 C is below the 0.5 C floor
    t_r = rng.normal(0, 0.001, 45)
    t_m = 10 + t_r + rng.normal(0, 0.001, 45)
    t_m[7] += 0.2
    assert not X.bad_years("T2M", t_m, t_r)[0].any()
    t_m[7] += 1.0  # 1.2 C passes the floor
    assert list(np.flatnonzero(X.bad_years("T2M", t_m, t_r)[0])) == [7]


def test_mad_zero_is_not_checked():
    r = np.full(45, 5.0)
    m = np.full(45, 5.5)
    m[20] = 9.0
    bad, d, z = X.bad_years("PRECTOTCORR", m, r)
    assert z is None and not bad.any()
    assert X.mad_z(np.array([1.0, 1.0, 1.0, 1.0, 9.0]))[0] is None


def test_rain_needs_30_years_with_reference_at_least_0_1():
    m, r = planted()
    r2 = r.copy()
    r2[:20] = 0.05  # only 25 years with R >= 0.1
    m2 = m.copy()
    assert X.difference_series("PRECTOTCORR", m2, r2)[0] is None
    assert not X.bad_years("PRECTOTCORR", m2, r2)[0].any()


def test_bad_year_only_on_common_valid_years():
    m, r = planted(at=39)
    r[39] = np.nan
    assert not X.bad_years("PRECTOTCORR", m, r)[0][39]


def test_patched_trend_drops_bad_year():
    t = np.arange(45, dtype=float)
    r = 5.0 + 0.0 * t + np.random.default_rng(5).normal(0, 0.05, 45)
    m = 1.1 * r + np.random.default_rng(6).normal(0, 0.05, 45)
    m[44] += 4.0
    bad, _, _ = X.bad_years("PRECTOTCORR", m, r)
    assert bad[44]
    raw = X.trend_of(m)[0]
    patched = X.trend_of(np.where(bad, np.nan, m))[0]
    assert abs(patched) < abs(raw) or abs(patched) < 0.05


# ---- CI overlap ----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("a,b,expected", CASES["ci_overlap"])
def test_ci_overlap_rule(a, b, expected):
    assert X.ci_overlap(a[0], a[1], b[0], b[1]) is expected
    assert X.ci_overlap(b[0], b[1], a[0], a[1]) is expected


def test_detrended_correlation_ignores_trend_and_level():
    t = np.arange(45, dtype=float)
    wave = np.sin(t / 3.0)
    a = 20 + 0.5 * t + wave
    b = -3 + 0.01 * t + 2 * wave
    assert X.detrended_corr(a, b) > 0.95
    assert X.detrended_corr(a, -b + 0.02 * t) < -0.9


# ---- longitudes / land classification ------------------------------------------------------------------------------

def test_gpcp_longitude_roll_and_box_lookup():
    monthly = np.zeros((540, 72, 144), dtype=np.float32)
    monthly[:, :, 0] = 1.0     # centre 1.25 E
    monthly[:, :, 143] = 2.0   # centre 358.75 E = -1.25
    monthly[:, :, 72] = 3.0    # centre 181.25 E = -178.75
    a = X.gpcp_annual(monthly)
    lat0, dlat, nlat, lon0, dlon, nlon = X.reference_grid("PRECTOTCORR")
    lons = lon0 + dlon * np.arange(nlon)
    assert lons[0] == -178.75 and lons[-1] == 178.75 and np.all(np.diff(lons) == 2.5)
    assert a[0, 0, 0] == 3.0            # first column is -178.75
    assert a[0, 0, 71] == 2.0           # -1.25
    assert a[0, 0, 72] == 1.0           # +1.25
    b = X.box_of("PRECTOTCORR", 13.9, 121.3)
    assert (b // 144, b % 144) == (41, 120)  # centre 13.75 N, 121.25 E


def test_land_and_ocean_boxes_classified():
    mask = X.load_country_mask()
    lat = np.arange(-90, 90.01, 0.5)
    lon = -180 + 0.625 * np.arange(576)
    for var in X.VARS:
        g = X.reference_grid(var)
        land = X.box_land(mask, lat, lon, *g)
        for la, lo in CASES["classified"]["land"]:
            b = X.box_of(var, la, lo)
            assert land[b // g[5], b % g[5]], (var, la, lo)
        for la, lo in CASES["classified"]["ocean"]:
            b = X.box_of(var, la, lo)
            assert not land[b // g[5], b % g[5]], (var, la, lo)


# ---- GPCP and the real product -------------------------------------------------------------------------------------

@needs_gpcp
def test_gpcp_manila_check_values_and_shape():
    m = np.load(X.GPCP_NPY)
    assert m.shape == (540, 72, 144) and not np.isnan(m).any()
    ann = m.astype(np.float64).reshape(45, 12, 72, 144).mean(axis=1)
    got = ann[2016 - 1981:2025 - 1981, 41, 48]
    assert np.allclose(got, CASES["gpcp_manila_annual_2016_2024"], atol=0.005)
    assert m[456 - 24, 41, 48] == pytest.approx(4.992602, abs=1e-5)  # single-cell OPeNDAP .ascii request, time 456
    # the rolled annual field puts that cell at longitude 121.25
    a = X.gpcp_annual(m)
    assert a[39, 41, 120] == pytest.approx(ann[39, 41, 48])


def _manila():
    var = "PRECTOTCORR"
    g = X.reference_grid(var)
    lat = np.arange(-90, 90.01, 0.5)
    lon = -180 + 0.625 * np.arange(576)
    grid = products.load_grid(var)
    M = X.box_means(grid, lat, lon, 13.75, 2.5, 1, 121.25, 2.5, 1)[:, 0, 0]
    R = X.gpcp_annual()[:, 41, 120]
    return M, R


@needs_gpcp
def test_manila_2020_merra_value():
    M, R = _manila()
    assert M[2020 - 1981] == pytest.approx(11.67, abs=0.02)
    assert R[2020 - 1981] == pytest.approx(7.08, abs=0.005)


@needs_gpcp
def test_manila_2020_is_the_most_extreme_year():
    M, R = _manila()
    bad, d, z = X.bad_years("PRECTOTCORR", M, R)
    assert int(np.nanargmax(np.abs(z))) == 2020 - 1981
    assert z[2020 - 1981] > 4.0


@needs_gpcp
def test_manila_2020_is_flagged_as_the_task_text_expects():
    M, R = _manila()
    assert X.bad_years("PRECTOTCORR", M, R)[0][2020 - 1981]


@needs_build
def test_built_cache_matches_direct_computation():
    z = np.load(os.path.join(config.CACHE_DIR, "reference_PRECTOTCORR.npz"))
    M, R = _manila()
    b = 41 * 144 + 120
    assert np.allclose(z["M"][:, b], M, equal_nan=True)
    assert np.allclose(z["R"][:, b], R, equal_nan=True)
    with open(os.path.join(config.WEB_DATA_DIR, "reference", "PRECTOTCORR.json")) as f:
        j = json.load(f)
    assert len(j["agree"]) == j["nlat"] * j["nlon"] == 72 * 144
    assert j["lon0"] == -178.75 and j["floor"] == 1.0
