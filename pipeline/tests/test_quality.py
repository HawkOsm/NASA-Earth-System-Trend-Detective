import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import products  # noqa: E402
import quality as Q  # noqa: E402

T45 = np.array(config.YEARS, dtype=np.float64)
FIX = os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "quality_cases.json")
D = config.WEB_DATA_DIR
NUMERIC = ["slope", "p", "kStar", "pettittK", "pPettitt", "withinSlope", "ratio", "fit", "stepYear", "stepSize", "outlierYear",
           "outlierZ", "slopeWithout", "pWithout", "slopeFirstHalf", "pFirstHalf", "slopeSecondHalf", "pSecondHalf",
           "slopeNoFirst", "slopeNoLast"]


def test_fixture_is_reproduced_by_quality_1d():
    with open(FIX) as f:
        cases = json.load(f)["cases"]
    assert len(cases) >= 40
    for c in cases:
        got = Q.quality_1d(np.array(c["y"]), np.array(c["t"]))
        assert json.loads(json.dumps(got)) == c["expected"], c["name"]


def test_too_few_years_is_unchecked():
    y = np.arange(19, dtype=float)
    r = Q.quality_1d(y, T45[:19])
    assert r["grade"] == "unchecked" and not any(r["flags"].values()) and r["checked"] is False
    assert Q.quality_1d(y[:0], T45[:0])["grade"] == "unchecked"
    assert Q.quality_1d(np.arange(20.0) + np.sin(np.arange(20.0)), T45[:20])["checked"] is True


def test_pettitt_recurrence_equals_the_definition():
    rng = np.random.default_rng(3)
    Y = np.round(rng.normal(size=(45, 40)) * 2) / 2  # many ties
    q = Q._quality_block(Y, T45)
    for c in range(40):
        d = Q.quality_1d(Y[:, c], T45)
        assert d["kStar"] == q["kStar"][c] and d["pettittK"] == q["pettittK"][c]


def test_step_definition_on_a_clean_step_and_a_clean_line():
    rng = np.random.default_rng(1)
    k = np.arange(45.0)
    step = Q.quality_1d(np.where(k >= 20, 2.0, 0.0) + 0.2 * rng.normal(size=45), T45)
    assert step["flags"]["step"] and step["stepYear"] == 2001 and 1.5 < step["stepSize"] < 2.5 and step["grade"] == "caution"
    line = Q.quality_1d(0.1 * k + 0.2 * rng.normal(size=45), T45)
    assert not any(line["flags"].values()) and line["grade"] == "robust"
    assert Q.quality_1d(np.full(45, 3.0), T45)["flags"]["step"] is False


def test_grade_rules():
    f = lambda **k: {"step": False, "oneYear": False, "reversal": False, "endSensitive": False, **k}  # noqa: E731
    assert Q.grade_of("none", f(oneYear=True)) == "none"
    assert Q.grade_of("significant", f()) == "robust"
    assert Q.grade_of("possible", f(step=True)) == "caution"
    assert Q.grade_of("significant", f(step=True, reversal=True)) == "doubtful"
    assert Q.grade_of("significant", f(oneYear=True)) == "doubtful"


def test_holm_hand_example_and_many_tests_rule():
    got = Q.holm_adjust([0.01, 0.04, 0.03, 0.2])
    assert np.allclose(got, [0.04, 0.09, 0.09, 0.2], atol=1e-12)
    assert Q.holm_adjust([0.4, 0.9]) == [0.8, 0.9]
    assert Q.grade_with_many_tests("robust", "significant", 0.06) == ("caution", True)
    assert Q.grade_with_many_tests("doubtful", "significant", 0.06) == ("doubtful", True)
    assert Q.grade_with_many_tests("robust", "possible", 0.5) == ("robust", False)


@pytest.mark.parametrize("var", list(config.VARIABLES))
def test_grid_version_equals_quality_1d_on_300_random_real_cells(var):
    grid = products.load_grid(var)
    ok = ~np.isnan(grid).any(axis=0)
    ii, jj = np.nonzero(ok)
    rng = np.random.default_rng(sum(map(ord, var)))
    pick = rng.choice(len(ii), 300, replace=False)
    sub = grid[:, ii[pick], jj[pick]][:, :, None]          # (45, 300, 1)
    res = Q.quality_grid(sub, T45)
    for c in range(300):
        d = Q.quality_1d(sub[:, c, 0], T45)
        for f, key in (("step", "step"), ("oneYear", "oneYear"), ("reversal", "reversal"), ("endSensitive", "endSensitive")):
            assert bool(res[key][c, 0]) == d["flags"][f], (var, c, f)
        assert Q.CODE_GRADE[int(res["grade"][c, 0])] == d["grade"], (var, c)
        assert int(res["kind"][c, 0]) == {"none": 0, "possible": 1, "significant": 2}[d["kind"]]
        for k in NUMERIC:
            g, e = res[k][c, 0], d[k]
            if e is None:
                assert (np.isnan(g) if k not in ("stepYear", "outlierYear") else g == 0), (var, c, k)
            else:
                assert np.isclose(g, e, rtol=1e-9, atol=1e-12), (var, c, k, g, e)


def test_grid_nan_cell_is_no_data():
    a = np.random.default_rng(0).normal(size=(45, 2, 2))
    a[3, 0, 1] = np.nan
    r = Q.quality_grid(a, T45)
    assert r["grade"][0, 1] == Q.NODATA and not r["step"][0, 1] and r["grade"][0, 0] != Q.NODATA


# ---- the exported products (run export_quality.py first) --------------------------------------------------------------

def test_meta_quality_and_caveat():
    for var, cfg in config.VARIABLES.items():
        with open(os.path.join(D, f"{var}_meta.json")) as f:
            m = json.load(f)
        assert m["caveat"] == cfg["caveat"]
        q = m["quality"]
        assert set(q) == {"robust", "caution", "doubtful", "stepYearMode"}
        assert abs(q["robust"] + q["caution"] + q["doubtful"] - 1.0) < 4e-4, var
        assert q["stepYearMode"] is None or 1982 <= q["stepYearMode"] <= 2025


def test_quality_bin_matches_summary_bitmaps_and_coarse_recomputation():
    import export_summary as ES
    with open(os.path.join(D, "summary.json")) as f:
        sm = json.load(f)
    with open(os.path.join(D, "quality.json")) as f:
        qm = json.load(f)
    with open(os.path.join(D, "summary.bin"), "rb") as f:
        sbin = f.read()
    raw = open(os.path.join(D, "quality.bin"), "rb").read()
    assert qm["bytes"] == len(raw) and [v["variable"] for v in qm["variables"]] == [v["variable"] for v in sm["variables"]]
    nc = sm["nlat"] * sm["nlon"]
    for sv, qv in zip(sm["variables"], qm["variables"]):
        assert qv["count"] == sv["count"]
        n = qv["count"]
        flags = np.frombuffer(raw, np.uint8, n, qv["flagsOffset"])
        step_year = np.frombuffer(raw, "<u2", n, qv["stepYearOffset"])
        out_year = np.frombuffer(raw, "<u2", n, qv["outlierYearOffset"])
        bits = np.unpackbits(np.frombuffer(sbin, np.uint8, (nc + 7) // 8, sv["bitmapOffset"]), bitorder="little")[:nc].astype(bool)
        if sv["variable"] not in ("T2M", "FRSEAICE"):
            continue
        q = Q.quality_grid(ES.coarse_values(sv["variable"]), T45)
        assert ((q["grade"] != Q.NODATA).ravel() == bits).all()
        assert (flags & 15 == (q["step"] * 1 + q["oneYear"] * 2 + q["reversal"] * 4 + q["endSensitive"] * 8).ravel()[bits]).all()
        assert (flags >> 4 == q["grade"].ravel()[bits]).all()
        assert (step_year == np.where(q["step"], q["stepYear"], 0).ravel()[bits]).all()
        assert (out_year == np.where(q["oneYear"], q["outlierYear"], 0).ravel()[bits]).all()


def test_full_resolution_cache_and_map_significant_cells_are_graded():
    for var in ("T2M", "WS2M"):
        z = np.load(os.path.join(config.CACHE_DIR, f"{var}_quality.npz"))
        tr = np.load(os.path.join(config.CACHE_DIR, f"{var}_trend.npz"))
        sig = np.isfinite(tr["q"]) & (tr["q"] < config.ALPHA)
        assert z["grade"].shape == sig.shape
        assert np.isin(z["grade"][sig], [1, 2, 3]).all()     # a map-significant cell is never grade "none"
        assert (z["grade"] == Q.NODATA).sum() == (~np.isfinite(tr["p"])).sum()


def test_regions_json_gained_quality_and_kept_its_numbers():
    with open(os.path.join(D, "regions.json"), encoding="utf-8") as f:
        data = json.load(f)
    n = 0
    for reg in data["regions"]:
        for var, e in reg["variables"].items():
            if e is None:
                continue
            n += 1
            q = e["quality"]
            assert q["grade"] in ("none", "robust", "caution", "doubtful") and set(q) == {
                "step", "oneYear", "reversal", "endSensitive", "grade", "stepYear", "outlierYear"}
            assert (q["stepYear"] is not None) == q["step"] and (q["outlierYear"] is not None) == q["oneYear"]
    assert n >= 70
