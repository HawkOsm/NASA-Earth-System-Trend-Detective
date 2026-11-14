import os
import struct
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import reference as R  # noqa: E402
import reference_more as RM  # noqa: E402
import sources as S  # noqa: E402


def dods(decl, payload, count):
    head = f"Dataset {{\n    Structure {{\n        {decl};\n    }} x;\n}} Datasets/f.nc;\n\nData:\n".encode()
    return head + struct.pack(">II", count, count) + payload


def test_parse_dods_float32_and_float64():
    v = np.array([1.5, -2.25, 3.0], dtype=">f4")
    assert np.array_equal(S.parse_dods(dods("Float32 x[time = 3]", v.tobytes(), 3)), v.astype(float))
    w = np.array([1e6, 0.125], dtype=">f8")
    assert np.array_equal(S.parse_dods(dods("Float64 time[time = 2]", w.tobytes(), 2)), w)


def test_parse_dods_int16_words_and_grid_form():
    raw = b"".join(struct.pack(">i", x) for x in (-25266, 32767, 5))  # DAP2 sends Int16 as 32-bit words
    assert list(S.parse_dods(dods("Int16 s[time = 1][lat = 1][lon = 3]", raw, 3))) == [-25266, 32767, 5]
    grid = (b"Dataset {\n Grid {\n  ARRAY:\n   Float32 a[t = 2];\n  MAPS:\n   Float64 t[t = 2];\n } a;\n} f;\n\nData:\n"
            + struct.pack(">II", 2, 2) + np.array([7, 8], dtype=">f4").tobytes()
            + struct.pack(">II", 2, 2) + np.array([0, 1], dtype=">f8").tobytes())
    assert list(S.parse_dods(grid)) == [7.0, 8.0]  # only the array, not the maps


def test_parse_dods_rejects_bad_or_truncated():
    with pytest.raises(ValueError):
        S.parse_dods(dods("Float32 x[time = 3]", np.zeros(2, dtype=">f4").tobytes(), 3))
    bad = dods("Float32 x[time = 1]", b"\0\0\0\0", 1).replace(struct.pack(">II", 1, 1), struct.pack(">II", 1, 2))
    with pytest.raises(ValueError):
        S.parse_dods(bad)


DAS = """Attributes {
    time {
        String units "hours since 1800-01-01 00:00:0.0";
        Float64 actual_range 1297320.0, 1987632.0;
    }
    snowcover {
        Float32 add_offset 302.66;
        Float32 scale_factor 0.01;
        Int16 missing_value 32767;
        String units "%";
    }
    NC_GLOBAL {
        String title "x";
    }
}
"""


def test_parse_das_and_decode():
    d = S.parse_das(DAS)
    assert d["time"]["units"].startswith("hours since 1800-01-01")
    assert d["time"]["actual_range"] == 1297320.0
    a = d["snowcover"]
    assert a["scale_factor"] == 0.01 and a["missing_value"] == 32767
    x = S._decode(np.array([-25266, 32767]), a)
    assert abs(x[0] - 50.0) < 1e-9 and np.isnan(x[1])
    assert np.isnan(S._decode(np.array([-9.96921e36]), {})[0])


def test_months_from_time():
    h = (np.datetime64("1981-03-01") - np.datetime64("1800-01-01")).astype("timedelta64[h]").astype(int)
    y, m = S.months_from_time([h, h + 31 * 24], "hours since 1800-01-01 00:00:0.0")
    assert list(y) == [1981, 1981] and list(m) == [3, 4]
    d = (np.datetime64("1850-01-01") - np.datetime64("1800-01-01")).astype(int)
    y, m = S.months_from_time([d, d + 31], "days since 1800-1-1 00:00:0.0")
    assert list(zip(y, m)) == [(1850, 1), (1850, 2)]
    y, m = S.months_from_time([0.0], "hours since 1900-1-1 0:0:0")
    assert (y[0], m[0]) == (1900, 1)
    with pytest.raises(ValueError):
        S.months_from_time([0], "seconds since 1970-01-01")


def test_annual_needs_all_twelve_months():
    m = np.arange(12, dtype=float)[:, None] * np.ones((12, 3))
    assert np.allclose(S.annual_from_monthly(m), 5.5)
    m[4, 1] = np.nan
    a = S.annual_from_monthly(m)
    assert np.isnan(a[1]) and np.isfinite(a[0]) and np.isfinite(a[2])


def test_days_in_month_leap():
    assert S.days_in_month(2024, 2) == 29 and S.days_in_month(2023, 2) == 28 and S.days_in_month(2000, 12) == 31


def test_to_ascending_180_reorders_lat_and_lon():
    lat = np.array([1.0, 0.0, -1.0])
    lon = np.array([0.0, 90.0, 180.0, 270.0])
    a = np.arange(12, dtype=float).reshape(1, 3, 4)
    b, la, lo = S.to_ascending_180(a, lat, lon)
    assert list(la) == [-1.0, 0.0, 1.0] and list(lo) == [-180.0, -90.0, 0.0, 90.0]
    assert b[0, 0, 0] == a[0, 2, 2] and b[0, 2, 3] == a[0, 0, 1]  # (lat -1, lon 180 -> -180) and (lat 1, lon 90)


def test_parse_rutgers_and_annual():
    txt = "\n".join(f"1990 {m:02d} {m * 1000000}" for m in range(1, 13)) + "\n1991 01 5000000\n"
    t = S.parse_rutgers(txt)
    assert t[(1990, 3)] == 3.0
    a = S.annual_of_months(t, 1990, 1991)
    assert a[0] == pytest.approx(6.5) and np.isnan(a[1])  # 1991 has one month only


def test_parse_nsidc():
    txt = "year, mo,source_dataset, region, extent,   area\n1979,  1,    NSIDC-0051,      N,  15.41,  12.41\n1980,  1,  x, N, -9999, -9999\n"
    t = S.parse_nsidc(txt)
    assert t == {(1979, 1): (15.41, 12.41)}


def sbuv_text():
    lines = []
    for y in (1980, 1981):
        lines.append(f"{y} SBUV_V87 MOD V14 PROF TOT Zonal Means")
        lines.append("        Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec")
        for b in range(36):
            lo = -90 + 5 * b
            vals = ["0.0" if (b == 0 or (y == 1981 and b == 1)) else f"{300 + b + k:.1f}" for k in range(12)]
            lines.append(f"{lo:3d} {lo + 5:3d} " + " ".join(f"{v:>5s}" for v in vals))
    return "\n".join(lines)


def test_parse_sbuv_zero_is_missing_and_shape():
    yrs, a = S.parse_sbuv(sbuv_text())
    assert list(yrs) == [1980, 1981] and a.shape == (2, 36, 12)
    assert np.isnan(a[0, 0]).all() and np.isnan(a[1, 1]).all() and a[0, 1, 0] == 301.0


# ---------------------------------------------------------------- averaging a record to boxes (reference_more)

LAT = np.arange(-89.75, 90, 0.5)
LON = np.arange(-179.75, 180, 0.5)
G2 = (-89.0, 2.0, 90, -179.0, 2.0, 180)


def test_block_mean_valid_constant_field_and_missing_rule():
    a = np.full((2, len(LAT), len(LON)), 3.0)
    b = RM.block_mean_valid(a, LAT, LON, G2)
    assert b.shape == (2, 90, 180) and np.allclose(b, 3.0)
    # one of the 16 cells of the box (lat -89, lon -179) missing in year 0: still >= half of the weight valid
    a[0, 0, 0] = np.nan
    b = RM.block_mean_valid(a, LAT, LON, G2)
    assert b[0, 0, 0] == pytest.approx(3.0)
    # more than half missing: the year is missing in that box only
    a[0, 0:3, 0:4] = np.nan
    b = RM.block_mean_valid(a, LAT, LON, G2)
    assert np.isnan(b[0, 0, 0]) and np.isfinite(b[1, 0, 0]) and np.isfinite(b[0, 0, 1])


def test_block_mean_valid_is_cos_lat_weighted_over_valid_cells():
    a = np.zeros((1, len(LAT), len(LON)))
    a[0, 0:4, 0:4] = np.array([0.0, 0.0, 10.0, 10.0])[:, None]  # box (lat -90..-88): rows -89.75,-89.25 | -88.75,-88.25
    b = RM.block_mean_valid(a, LAT, LON, G2)
    w = np.cos(np.radians(LAT[:4]))
    assert b[0, 0, 0] == pytest.approx((w[2] * 10 + w[3] * 10) / w.sum())


def test_block_mean_matches_reference_box_means_on_clean_data():
    rng = np.random.default_rng(2)
    a = rng.normal(size=(2, len(LAT), len(LON)))
    mine = RM.block_mean_valid(a, LAT, LON, G2)
    ref = R.box_means(a, LAT, LON, *G2)
    assert np.allclose(mine, ref, equal_nan=True)


def test_coarser_record_than_boxes_gives_missing_not_wrong():
    lat5 = np.arange(-87.5, 90, 5.0)
    lon5 = np.arange(-177.5, 180, 5.0)
    a = np.ones((1, len(lat5), len(lon5)))
    b = RM.block_mean_valid(a, lat5, lon5, G2)  # 5 degree cells on a 2 degree grid: most boxes hold no cell centre
    assert np.isnan(b).any() and np.nanmax(b) == 1.0


def fake_o(grid="r25"):
    n = 72 * 144
    rng = np.random.default_rng(5)
    ms = rng.normal(size=n)
    mp = rng.uniform(size=n) * 0.2
    rs = ms + rng.normal(size=n) * 0.7
    rp = rng.uniform(size=n)
    return {"merraSlope": ms, "merraP": mp, "refSlope": rs, "refP": rp, "used": rng.uniform(size=n) < 0.8, "grid": grid}


def test_classes_agree_with_reference_summarize_for_any_grid():
    o = fake_o()
    sel = np.ones(72 * 144, dtype=bool)
    for rain in (True, False):
        s = RM.summary(o, sel, rain)
        c = RM.classes(o, sel, rain)
        blat, _ = RM.box_centres(RM.GRIDS["r25"])
        w = np.cos(np.radians(blat))
        tot = w[c > 0].sum()
        assert s["confirmed"] == pytest.approx(w[c == 1].sum() / tot, abs=1e-4)
        assert s["unconfirmed"] == pytest.approx(w[c == 2].sum() / tot, abs=1e-4)
        assert s["contradicted"] == pytest.approx(w[c == 3].sum() / tot, abs=1e-4)
    assert R.reference_grid("T2M") == (-89.0, 2.0, 90, -179.0, 2.0, 180)  # the swap is undone


def test_pair_table_sums_to_one_and_identical_records_agree_fully():
    o = fake_o()
    sel = np.ones(72 * 144, dtype=bool)
    blat, _ = RM.box_centres(RM.GRIDS["r25"])
    w = np.cos(np.radians(blat))
    p = RM.pair_table(o, o, sel, False, w)
    assert p["same_class"] == pytest.approx(1.0)
    assert p["both"] + p["one"] + p["neither"] == pytest.approx(1.0)
    assert p["one"] == 0.0


def test_rel_trend_is_percent_of_mean_per_decade():
    y = 10.0 + 0.1 * np.arange(45)  # +1 per decade on a mean of 12.2
    s, lo, hi, p = RM.rel_trend(y)
    assert s == pytest.approx(1.0 / np.mean(y) * 100, rel=1e-6) and p < 0.001 and lo <= s <= hi


def test_merra_area_series_on_uniform_cover(monkeypatch):
    import products
    g = np.full((45, 361, 576), 100.0)  # 100 % everywhere
    monkeypatch.setattr(products, "load_grid", lambda var: g)
    monkeypatch.setattr(RM.products, "load_grid", lambda var: g)
    n, s = RM.merra_area_series("FRSNO", "north"), RM.merra_area_series("FRSNO", "south")
    half_earth = 4 * np.pi * 6371.0088 ** 2 / 2 / 1e6
    assert n[0] == pytest.approx(half_earth, rel=0.01) and s[0] == pytest.approx(half_earth, rel=0.01)
