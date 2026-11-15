import json
import os
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config  # noqa: E402
from maps import export  # noqa: E402
from evaluation import export_confirmed as C  # noqa: E402
from evaluation import reference  # noqa: E402

# Tiny world: 4 x 4 degree boxes, 2 x 2 of them; cells every 2 degrees at lat -3, -1, 1, 3 and lon -3, -1, 1, 3.
GRID = (-2.0, 4.0, 2, -2.0, 4.0, 2)   # lat0, dlat, nlat, lon0, dlon, nlon: box centres -2 / 2
LAT = np.array([-3.0, -1.0, 1.0, 3.0])
LON = np.array([-3.0, -1.0, 1.0, 3.0])


def tiny(slope, q, eligible, ref_slope, ref_p):
    return C.classify(slope, q, LAT, LON, GRID, eligible, ref_slope, ref_p)


def test_box_lookup_lower_edge_inclusive():
    b = C.box_index(np.array([-4.0, -0.0001, 0.0, 4.0]), np.array([-4.0, 0.0, 3.9999]), GRID)
    # lat -4 -> row 0, -0.0001 -> row 0, 0.0 -> row 1, 4.0 (past the top edge) clamps to row 1
    assert b[:, 0].tolist() == [0, 0, 2, 2]
    assert b[0].tolist() == [0, 1, 1]   # lon -4 -> col 0, 0.0 -> col 1, 3.9999 -> col 1


def test_three_classes_and_shares():
    s = np.full((4, 4), 1.0)
    q = np.full((4, 4), 0.01)
    q[0, 0] = 0.5                      # not significant
    s[0, 1] = -1.0                     # box 0 (ref slope +): opposite sign -> not confirmed
    # boxes: 0 eligible, ref +, p small ; 1 eligible but ref p large ; 2 NOT eligible ; 3 eligible, ref +, p small
    elig = np.array([1, 1, 0, 1])
    rs = np.array([0.3, 0.3, 0.3, 0.3])
    rp = np.array([0.01, 0.4, 0.01, 0.01])
    m = tiny(s, q, elig, rs, rp)
    assert m["significant"].sum() == 15
    # box 0 = rows 0-1, cols 0-1: cell (0,0) not significant, (0,1) opposite sign, (1,0), (1,1) confirmed
    assert m["confirmed"][1, 0] and m["confirmed"][1, 1]
    assert m["notConfirmed"][0, 1] and not m["confirmed"][0, 1]
    assert not m["significant"][0, 0]
    # box 1 = rows 0-1, cols 2-3: reference not significant -> not confirmed
    assert m["notConfirmed"][0:2, 2:4].all() and not m["confirmed"][0:2, 2:4].any()
    # box 2 = rows 2-3, cols 0-1: ineligible -> uncheckable, never confirmed
    assert m["uncheckable"][2:4, 0:2].all() and not m["confirmed"][2:4, 0:2].any()
    # box 3 confirmed
    assert m["confirmed"][2:4, 2:4].all()
    # classes are disjoint and cover the significant cells
    tot = m["confirmed"].astype(int) + m["notConfirmed"] + m["uncheckable"]
    assert (tot == m["significant"]).all()
    sh = C.shares(m, LAT)
    assert abs(sh["significant"] - sh["confirmed"] - sh["notConfirmed"] - sh["uncheckable"]) < 1e-9
    assert 0 < sh["confirmed"] < sh["significant"] < 1


def test_ineligible_box_is_uncheckable_even_with_agreeing_reference():
    s = np.full((4, 4), 1.0)
    q = np.full((4, 4), 0.001)
    m = tiny(s, q, np.zeros(4), np.full(4, 1.0), np.full(4, 0.0))
    assert m["uncheckable"].all() and not m["confirmed"].any() and not m["notConfirmed"].any()


def test_nan_and_negative_slope():
    s = np.full((4, 4), -1.0)
    q = np.full((4, 4), 0.001)
    q[0, 0] = np.nan
    m = tiny(s, q, np.ones(4), np.full(4, -0.2), np.full(4, 0.02))
    assert not m["significant"][0, 0] and m["confirmed"].sum() == 15
    f = C.confirmed_field(m, q)
    assert np.isnan(f[0, 0]) and f[1, 1] == 1.0
    m2 = tiny(s, q, np.ones(4), np.full(4, 0.2), np.full(4, 0.02))   # opposite sign
    assert m2["confirmed"].sum() == 0 and m2["notConfirmed"].sum() == 15


# ---- the real files
HAVE = all(os.path.exists(os.path.join(config.WEB_DATA_DIR, f"{v}_confirmed.png")) for v in reference.VARS) and \
    os.path.exists(os.path.join(config.CACHE_DIR, "PRECTOTCORR_trend.npz")) and \
    os.path.exists(os.path.join(config.CACHE_DIR, "reference_PRECTOTCORR.npz"))


@pytest.mark.skipif(not HAVE, reason="run export_confirmed.py once")
@pytest.mark.parametrize("var", list(reference.VARS))
def test_texture_matches_trend_and_basemap(var):
    wd = config.WEB_DATA_DIR
    conf = np.asarray(Image.open(os.path.join(wd, f"{var}_confirmed.png")).convert("RGB")).astype(int)
    trend = np.asarray(Image.open(os.path.join(wd, f"{var}_trend.png")).convert("RGB")).astype(int)
    base = np.asarray(Image.open(os.path.join(wd, "basemap.png")).convert("RGB")).astype(int)
    assert conf.shape == trend.shape == (export.HEIGHT, export.WIDTH, 3)
    z = np.load(os.path.join(config.CACHE_DIR, f"{var}_trend.npz"))
    slope, q, lat, lon = z["slope_decade"], z["q"], z["lat"], z["lon"]
    r = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
    el = reference.eligible_mask(var, r["used"], r["land"])
    from evaluation import reference_multi as MM
    m = C.classify_multi(slope, q, lat, lon, reference.reference_grid(var), el, MM.records_for(var)[0])   # multi-record design
    # the nearest-cell neighbourhood of a pixel: the 3x3 block around its nearest cell (covers the 4 bilinear corners)
    li, lj = export.pixel_indices(lat, lon)
    nlat, nlon = len(lat), len(lon)

    def block(mask, ii, jj):
        rows = np.clip(np.arange(ii - 1, ii + 2), 0, nlat - 1)
        cols = np.arange(jj - 1, jj + 2) % nlon
        return mask[np.ix_(rows, cols)]

    rng = np.random.default_rng(7)
    all_c, none_c = [], []
    for _ in range(400000):
        y, x = int(rng.integers(0, export.HEIGHT)), int(rng.integers(0, export.WIDTH))
        b = block(m["confirmed"], li[y], lj[x])
        fin = block(np.isfinite(slope) & np.isfinite(q), li[y], lj[x])
        if b.all() and not (len(all_c) >= 200):
            all_c.append((y, x))
        elif not b.any() and fin.all() and len(none_c) < 200:
            none_c.append((y, x))
        if len(all_c) >= 200 and len(none_c) >= 200:
            break
    assert len(all_c) == 200 and len(none_c) == 200
    for y, x in all_c:
        assert np.abs(conf[y, x] - trend[y, x]).max() <= 1
    for y, x in none_c:
        assert np.abs(conf[y, x] - base[y, x]).max() <= 1


@pytest.mark.skipif(not HAVE, reason="run export_confirmed.py once")
@pytest.mark.parametrize("var", list(reference.VARS))
def test_json_shares(var):
    with open(os.path.join(reference.OUT_DIR, f"confirmed_{var}.json")) as f:
        d = json.load(f)
    s = d["shares"]
    assert d["texture"] == f"{var}_confirmed.png"
    assert d["source"]["short"] and d["source"]["name"]
    assert abs(s["significant"] - (s["confirmed"] + s["partly"] + s["notConfirmed"] + s["uncheckable"])) < 1e-9
    assert d["records"] and d["records"][0] == d["source"]["short"]


def test_multi_record_classes_use_the_cells_own_sign_and_partly_is_not_confirmed():
    """Two records on the tiny grid: box 0 both significant +, box 1 one of two significant + (one of two is not more than
    half, so partly), box 2 none (k = 0), box 3 four records with k = 1 (partly)."""
    s = np.full((4, 4), 1.0)
    q = np.full((4, 4), 0.01)
    el = np.ones(4)

    def rec(slope, p, avail):
        return {"slope": np.array(slope, dtype=float), "p": np.array(p, dtype=float), "available": np.array(avail, dtype=bool)}

    recs = [rec([0.3, 0.3, 0.3, 0.3], [0.01, 0.01, 0.4, 0.01], [1, 1, 1, 1]),
            rec([0.3, 0.3, 0.3, -0.3], [0.01, 0.4, 0.4, 0.4], [1, 1, 1, 1]),
            rec([0.0, 0.0, 0.0, 0.3], [1, 1, 1, 0.4], [0, 0, 0, 1]),
            rec([0.0, 0.0, 0.0, 0.3], [1, 1, 1, 0.4], [0, 0, 0, 1])]
    m = C.classify_multi(s, q, LAT, LON, GRID, el, recs)
    assert m["confirmed"][0:2, 0:2].all()          # box 0: n = 2, k = 2
    assert m["partly"][0:2, 2:4].all() and not m["confirmed"][0:2, 2:4].any()   # box 1: n = 2, k = 1 -> partly
    assert m["notConfirmed"][2:4, 0:2].all()       # box 2: n = 2, k = 0
    assert m["partly"][2:4, 2:4].all() and not m["confirmed"][2:4, 2:4].any()   # box 3: n = 4, k = 1
    # the cell's own sign decides: a negative cell in box 0 has k = 0 and c = 2 -> contradicted -> not confirmed
    s2 = s.copy()
    s2[0, 0] = -1.0
    m2 = C.classify_multi(s2, q, LAT, LON, GRID, el, recs)
    assert m2["notConfirmed"][0, 0] and not m2["confirmed"][0, 0] and m2["confirmed"][0, 1]
    sh = C.shares(m, LAT)
    assert abs(sh["significant"] - sh["confirmed"] - sh["partly"] - sh["notConfirmed"] - sh["uncheckable"]) < 1e-9
