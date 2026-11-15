"""The 'no data' rules (fill values, land-only / ocean-only, never any snow / ice), percent scaling, the Int16 offset
and the coarse-grid missing rule, plus what they did to the real exported files."""
import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config  # noqa: E402
from areas import countries as C  # noqa: E402
from core import products as P  # noqa: E402
from areas import seas as S  # noqa: E402
from maps.export_wind import block_average  # noqa: E402

D = config.WEB_DATA_DIR
NEW = ["T2M_MAX", "GWETROOT", "EVLAND", "RH2M", "FRSNO", "FRSEAICE", "TO3"]


def field(vals):
    """[years][2][2] float field from a list of per-year 2x2 grids."""
    return np.array(vals, dtype=np.float64)


def test_fill_values_and_nan_become_nan():
    a = np.full((3, 1, 4), 5.0)
    a[0, 0, 0] = -999.0
    a[1, 0, 1] = np.nan
    a[2, 0, 2] = -900.0
    a[0, 0, 3] = -899.99  # a real (very low) value: kept
    out = P.clean_field(a)
    assert np.isnan(out[0, 0, 0]) and np.isnan(out[1, 0, 1]) and np.isnan(out[2, 0, 2])
    assert out[0, 0, 3] == -899.99
    assert out[2, 0, 0] == 5.0


def test_all_zero_rule_only_for_snow_and_ice():
    a = np.zeros((4, 1, 3))
    a[:, 0, 1] = [0.0, 0.0, 0.01, 0.0]  # one non-zero year: has data
    a[:, 0, 2] = 0.4
    on = P.clean_field(a, zero_means_absent=True)
    assert np.isnan(on[:, 0, 0]).all()  # never anything: no data
    assert not np.isnan(on[:, 0, 1]).any() and on[2, 0, 1] == 0.01  # zeros stay zeros where something happens
    assert (on[:, 0, 2] == 0.4).all()
    off = P.clean_field(a, zero_means_absent=False)  # an ordinary variable keeps its zeros (e.g. a dry desert)
    assert (off[:, 0, 0] == 0.0).all()


def test_all_zero_rule_looks_at_two_decimals():
    a = np.zeros((3, 1, 1))
    a[1, 0, 0] = 0.004  # rounds to 0.00
    assert np.isnan(P.clean_field(a, zero_means_absent=True)).all()


def test_partly_missing_cell_is_not_never():
    a = np.zeros((3, 1, 1))
    a[1, 0, 0] = np.nan
    out = P.clean_field(a, zero_means_absent=True)
    assert np.isnan(out[1, 0, 0]) and out[0, 0, 0] == 0.0  # NaN year stays NaN, the zeros are not wiped


def test_percent_scaling_is_exact_integers():
    a = np.array([[[0.29, 0.57, 1.0, 0.07]]], dtype=np.float32)  # float32 like the cache; 0.29*100 = 28.999...
    out = P.clean_field(a, display_scale=100)
    assert out.tolist() == [[[29.0, 57.0, 100.0, 7.0]]]
    assert (out == np.round(out)).all()


def test_rules_from_config():
    assert P.rules("FRSNO") == (100, 0, True)
    assert P.rules("FRSEAICE") == (100, 0, True)
    assert P.rules("GWETROOT") == (100, 0, False)
    assert P.rules("TO3") == (1, 300, False)
    assert P.rules("T2M") == (1, 0, False)


def test_int16_offset_round_trip_and_missing():
    v = np.array([[228.48, 300.0, 407.07, np.nan]])
    raw = P.to_int16(v, 300)
    assert raw.tolist() == [[-7152, 0, 10707, -32768]]
    back = P.from_int16(raw, 300)
    assert np.allclose(back[0, :3], v[0, :3], atol=1e-9) and np.isnan(back[0, 3])
    with pytest.raises(ValueError):
        P.to_int16(np.array([407.07]), 0)  # ozone without the offset would overflow Int16
    assert P.to_int16(np.array([407.07]), 300).tolist() == [10707]


def test_coarse_block_missing_rule():
    a = np.full((361, 576), np.nan)
    # the coarse cell (i=10, j=20) averages full-res rows 19..21 (weights .25 .5 .25) and columns 40, 41 (.5 .5)
    a[19:22, 40:42] = 6.0
    full = P.block_average_valid(a)
    assert full[10, 20] == pytest.approx(6.0, abs=1e-12)
    b = a.copy()
    b[20, 40:42] = np.nan  # the middle row (weight .5) is gone: 0.5 of the weight left
    half = P.block_average_valid(b)
    assert half[10, 20] == pytest.approx(6.0, abs=1e-12)
    c = a.copy()
    c[19:21, 40:42] = np.nan  # rows 19 and 20 gone: only the weight .25 left -> missing
    assert np.isnan(P.block_average_valid(c)[10, 20])
    d = a.copy()
    d[19:22, 41] = np.nan  # one of the two columns gone: weight .5 left -> kept, mean of the valid ones
    d[19:22, 40] = 8.0
    assert P.block_average_valid(d)[10, 20] == pytest.approx(8.0, abs=1e-12)


def test_coarse_without_missing_is_the_old_block_average():
    rng = np.random.default_rng(1)
    a = rng.normal(size=(361, 576))
    assert np.array_equal(P.block_average_valid(a), block_average(a, None, None))


def test_coarse_mean_uses_only_valid_members():
    a = np.full((361, 576), 2.0)
    a[19:22, 41] = np.nan  # right half of the block missing, left half valid: weight .5 -> kept
    assert P.block_average_valid(a)[10, 20] == pytest.approx(2.0, abs=1e-12)
    assert not np.isnan(P.block_average_valid(a)).any()


# ---- the exported files -------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def recs():
    with open(os.path.join(D, "countries.json")) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def seas():
    with open(os.path.join(D, "seas.json")) as f:
        return json.load(f)


def values(path, var, n):
    raw = np.fromfile(path, dtype="<i2").reshape(n, 45)
    return P.from_int16(raw, P.rules(var)[1])


def country_values(recs, name, var):
    r = next(x for x in recs if x["name"] == name)
    return values(os.path.join(D, "countries", var, f"{r['idx']}.bin"), var, r["nCells"])


def sea_values(seas, name, var):
    r = next(x for x in seas if x["name"] == name)
    return values(os.path.join(D, "seas", var, f"{r['idx']}.bin"), var, r["nCells"])


def share_with_data(v):
    return float(np.isfinite(v).any(axis=1).mean())


@pytest.mark.parametrize("var", ["GWETROOT", "EVLAND"])
def test_land_only_variable_has_data_on_land(recs, var):
    assert share_with_data(country_values(recs, "Turkey", var)) > 0.99
    assert share_with_data(country_values(recs, "Brazil", var)) > 0.99
    if var == "GWETROOT":
        t = country_values(recs, "Turkey", var)
        assert np.nanmin(t) >= 0 and np.nanmax(t) <= 100 and (t == np.round(t)).all()  # whole percent


def test_snow_has_data_on_land_where_it_snows_and_none_in_deserts(recs):
    assert share_with_data(country_values(recs, "Canada", "FRSNO")) > 0.9
    assert np.isnan(country_values(recs, "Egypt", "FRSNO")).all()  # no cell of Egypt ever has snow: no data, not zero
    assert np.isnan(country_values(recs, "Brazil", "FRSNO")).all()


def test_sea_ice_has_data_in_polar_seas_and_none_in_warm_water(seas):
    arctic = sea_values(seas, "Arctic Ocean", "FRSEAICE")
    assert share_with_data(arctic) > 0.99 and np.nanmax(arctic) > 50
    assert share_with_data(sea_values(seas, "Southern Ocean", "FRSEAICE")) > 0.9
    assert np.isnan(sea_values(seas, "Mediterranean Sea", "FRSEAICE")).all()
    assert share_with_data(sea_values(seas, "North Pacific Ocean", "FRSEAICE")) < 0.05


# ---- surface rule: land variables have no sea pieces, sea variables no country pieces -----------------------------

def test_surface_config_and_helper():
    assert [P.surface(v) for v in ("GWETROOT", "EVLAND", "FRSNO", "FRSEAICE", "T2M", "TO3")] == \
        ["land", "land", "land", "sea", "any", "any"]
    for v in ("GWETROOT", "EVLAND", "FRSNO"):
        assert P.has_pieces(v, sea=False) and not P.has_pieces(v, sea=True)
    assert P.has_pieces("FRSEAICE", sea=True) and not P.has_pieces("FRSEAICE", sea=False)
    for v in ("T2M", "T2M_MAX", "PRECTOTCORR", "WS2M", "RH2M", "TO3"):
        assert P.has_pieces(v, sea=True) and P.has_pieces(v, sea=False)


@pytest.mark.parametrize("var", list(config.VARIABLES))
def test_piece_files_exist_exactly_where_the_surface_rule_says(var, recs, seas):
    cdir, sdir = os.path.join(D, "countries", var), os.path.join(D, "seas", var)
    assert os.path.isdir(cdir) == P.has_pieces(var, sea=False)
    assert os.path.isdir(sdir) == P.has_pieces(var, sea=True)
    if os.path.isdir(cdir):
        assert len(os.listdir(cdir)) == len(recs)
    with open(os.path.join(D, f"{var}_meta.json")) as f:
        assert json.load(f)["surface"] == P.surface(var)
    assert os.path.exists(os.path.join(D, f"{var}_cities.bin"))  # cities stay cell-based


def test_no_zero_where_there_is_no_data():
    """A no-data cell is NaN in the trend cache, never 0 (and never a trend)."""
    z = np.load(os.path.join(config.CACHE_DIR, "GWETROOT_trend.npz"))
    grid = P.load_grid("GWETROOT")
    nodata = np.isnan(grid).all(axis=0)
    assert nodata.sum() > 100000
    assert np.isnan(z["slope_decade"][nodata]).all() and np.isnan(z["p"][nodata]).all() and np.isnan(z["q"][nodata]).all()
    assert np.isfinite(z["slope_decade"][~nodata]).all()


def test_ozone_files_use_the_offset(recs):
    with open(os.path.join(D, "TO3_annual.json")) as f:
        meta = json.load(f)
    assert meta["offset"] == 300
    with open(os.path.join(D, "TO3_meta.json")) as f:
        m = json.load(f)
    assert m["int16_offset"] == 300 and m["display_scale"] == 1
    t = country_values(recs, "Turkey", "TO3")
    assert 250 < np.nanmin(t) and np.nanmax(t) < 450  # real Dobson units, not minus 300
    raw = np.fromfile(os.path.join(D, "TO3_annual.bin"), dtype="<i2")
    assert raw.max() <= 32767 and (raw != -32768).all()  # ozone has no missing cell


def test_annual_grid_missing_and_percent():
    raw = np.fromfile(os.path.join(D, "FRSNO_annual.bin"), dtype="<i2").reshape(45, 181, 288)
    miss = raw == -32768
    assert miss.any() and (miss == miss[0]).all()  # the same cells are missing in every year
    v = raw[~miss] / 100.0
    assert v.min() >= 0 and v.max() <= 100  # percent
    with open(os.path.join(D, "FRSNO_meta.json")) as f:
        m = json.load(f)
    assert m["display_scale"] == 100 and m["zero_means_absent"] is True and m["units"] == "%"


def test_bh_and_significance_use_only_cells_with_data():
    z = np.load(os.path.join(config.CACHE_DIR, "FRSEAICE_trend.npz"))
    p, q = z["p"], z["q"]
    fin = np.isfinite(p)
    assert np.array_equal(fin, np.isfinite(q)) and 0.1 < fin.mean() < 0.5
    with open(os.path.join(D, "FRSEAICE_meta.json")) as f:
        m = json.load(f)
    from core.trendstats import bh_adjust
    assert np.allclose(bh_adjust(p)[fin], q[fin], atol=0)  # adjusted over the cells with data only
    assert 0 < m["frac_significant"] < 1
