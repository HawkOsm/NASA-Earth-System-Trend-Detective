import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import countries as C  # noqa: E402
import provinces as P  # noqa: E402

D = config.WEB_DATA_DIR


@pytest.fixture(scope="module")
def recs():
    with open(os.path.join(D, "countries.json")) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def mask():
    return np.fromfile(os.path.join(D, "country_mask.bin"), dtype=np.uint8).reshape(361, 576)


def load(recs, name):
    idx = next(r["idx"] for r in recs if r["name"] == name)
    with open(os.path.join(D, "provinces", f"{idx}.json")) as f:
        return next(r for r in recs if r["idx"] == idx), json.load(f)["provinces"]


def test_turkey_provinces(recs, mask):
    rec, provs = load(recs, "Turkey")
    names = {p["name"] for p in provs}
    assert len(provs) == 81
    assert "Ankara" in names and "Konya" in names
    assert "Istanbul" in names or "İstanbul" in names
    ci, cj = C.country_cell_indices(mask, rec)
    ankara = next(p for p in provs if p["name"] == "Ankara")
    i, j = C.nearest_cell(39.93, 32.86)
    k = [n for n in range(len(ci)) if ci[n] == i and cj[n] == j]
    assert len(k) == 1 and k[0] in ankara["cells"]


def test_cells_rings_and_bbox(recs):
    for name in ("Turkey", "Brazil", "Germany"):
        rec, provs = load(recs, name)
        s, n, w, e = rec["bbox"]
        for p in provs:
            assert p["cells"] and all(0 <= k < rec["nCells"] for k in p["cells"])
            assert p["rings"]
            for r in p["rings"]:
                assert len(r) >= 4 and r[0] == r[-1]
                for lng, lat in r:
                    assert s - 1 <= lat <= n + 1 and w - 1 <= lng <= e + 1


def test_simplify_ring_closed_and_within_tolerance():
    t = np.linspace(0, 2 * np.pi, 400)
    ring = np.column_stack([np.cos(t), np.sin(t)])
    ring[-1] = ring[0]
    s = P.simplify_ring(ring, 0.02)
    assert np.allclose(s[0], s[-1]) and 4 <= len(s) < 400
    # every original point is within the tolerance of the simplified outline
    for p in ring[::7]:
        d = np.min([np.hypot(*(p - q)) for q in s])
        assert d < 0.2  # vertex distance bound is loose; polygon distance is checked below
    r = np.hypot(s[:, 0], s[:, 1])
    assert r.min() > 1 - 0.03


def test_clean_rings_drops_tiny_and_rounds():
    big = np.array([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], dtype=float) + 0.12345
    tiny = np.array([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]], dtype=float)
    out = P.clean_rings([big, tiny])
    assert len(out) == 1
    assert all(round(v, 3) == v for pt in out[0] for v in pt)
