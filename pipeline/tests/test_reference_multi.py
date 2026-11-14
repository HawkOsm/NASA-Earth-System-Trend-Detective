"""Several independent records per variable ("confirmed by k of n"): the class rule, availability, the first record's
numbers unchanged, and the cached boxes of a few places."""
import json
import math
import os
import subprocess
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import reference as X  # noqa: E402
import reference_multi as MM  # noqa: E402

CACHES = ("src_gpcc.npz", "src_cmap.npz", "src_precl.npz", "src_ghcncams.npz", "reference_T2M.npz", "reference_PRECTOTCORR.npz")
HAVE = all(os.path.exists(os.path.join(config.CACHE_DIR, f)) for f in CACHES)
needs_cache = pytest.mark.skipif(not HAVE, reason="needs the cached records")
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_class_rule_table():
    # (n, k, c) -> class; every n from 0 to 4, ties included
    table = [
        (0, 0, 0, "none"),
        (1, 1, 0, "confirmed"), (1, 0, 0, "unconfirmed"), (1, 0, 1, "contradicted"),
        (2, 2, 0, "confirmed"), (2, 1, 0, "partly"), (2, 0, 0, "unconfirmed"), (2, 1, 1, "partly"),   # tie: not contradicted
        (2, 0, 1, "contradicted"), (2, 0, 2, "contradicted"), (2, 1, 2 - 1, "partly"),
        (3, 3, 0, "confirmed"), (3, 2, 0, "confirmed"), (3, 2, 1, "confirmed"), (3, 1, 0, "partly"), (3, 1, 1, "partly"),
        (3, 1, 2, "contradicted"), (3, 0, 0, "unconfirmed"), (3, 0, 3, "contradicted"),
        (4, 4, 0, "confirmed"), (4, 3, 1, "confirmed"), (4, 3, 0, "confirmed"), (4, 2, 0, "partly"), (4, 2, 1, "partly"), (4, 2, 2, "partly"),
        (4, 1, 0, "partly"), (4, 1, 1, "partly"), (4, 1, 3, "contradicted"), (4, 0, 0, "unconfirmed"), (4, 0, 1, "contradicted"),
    ]
    for n, k, c, want in table:
        assert MM.class_of(n, k, c) == want, (n, k, c)
        code = int(MM.class_codes(np.array([n]), np.array([k]), np.array([c]))[0])
        assert code == MM.CLASS_CODES[want], (n, k, c)
    # more than half (2k > n) for every n up to 6 and every k, c with k + c <= n
    for n in range(1, 7):
        for k in range(n + 1):
            for c in range(n - k + 1):
                want = "contradicted" if c > k else "confirmed" if (2 * k > n and k > c) else "partly" if k >= 1 else "unconfirmed"
                assert MM.class_of(n, k, c) == want


def test_counts_signs_and_availability():
    recs = [
        {"slope": np.array([0.3, 0.3]), "p": np.array([0.01, 0.01]), "available": np.array([True, True])},
        {"slope": np.array([-0.3, 0.3]), "p": np.array([0.01, 0.2]), "available": np.array([True, True])},
        {"slope": np.array([0.3, 0.3]), "p": np.array([0.01, 0.01]), "available": np.array([False, True])},
    ]
    n, k, c = MM.counts(np.array([1, 1]), recs)
    assert n.tolist() == [2, 3] and k.tolist() == [1, 2] and c.tolist() == [1, 0]
    n, k, c = MM.counts(np.array([-1, 0]), recs)           # a zero sign is never confirmed or contradicted
    assert k.tolist() == [1, 0] and c.tolist() == [1, 0]
    assert MM.counts(np.array([1, 1]), [dict(r, p=np.array([0.05, 0.05])) for r in recs])[1].tolist() == [0, 0]   # p = 0.05 is not significant


@needs_cache
def test_first_record_arrays_unchanged_from_head():
    """The first record's numbers (top-level arrays and records[0]) are what they were at HEAD."""
    for var in X.VARS:
        try:
            old = json.loads(subprocess.check_output(["git", "show", f"HEAD:web/public/data/reference/{var}.json"], cwd=REPO,
                                                     stderr=subprocess.DEVNULL))
        except Exception:  # noqa: BLE001
            pytest.skip("git history not available")
        with open(os.path.join(X.OUT_DIR, f"{var}.json")) as f:
            new = json.load(f)
        for key in ("refSlope", "refP", "merraSlope", "merraP", "patchedSlope", "patchedP", "agree", "land", "eligible", "badYears", "summary"):
            assert new[key] == old[key], (var, key)
        first = new["records"][0]
        assert first["short"] == old["source"]["short"]
        for i, ok in enumerate(new["eligible"]):
            assert first["available"][i] == ok
            assert first["refSlope"][i] == (old["refSlope"][i] if ok else None)
            assert first["refP"][i] == (old["refP"][i] if ok else None)


@needs_cache
def test_records_order_and_availability():
    for var, want in (("T2M", ["NASA GISTEMP", "GHCN-CAMS"]), ("PRECTOTCORR", ["GPCP", "CMAP", "GPCC", "PREC/L"])):
        recs, el = MM.records_for(var)
        assert [r["short"] for r in recs] == want
        assert (recs[0]["available"] == el).all()
        for r in recs:
            assert not (r["available"] & ~el).any()                     # available => eligible
            assert np.isfinite(r["p"][r["available"]]).all()
    rain, el = MM.records_for("PRECTOTCORR")
    assert 0 < rain[2]["available"].sum() < 0.5 * rain[0]["available"].sum()      # GPCC and PREC/L exist over land only
    assert 0 < rain[3]["available"].sum() < 0.5 * rain[0]["available"].sum()
    # |latitude| >= 60 is never available (the existing rain rule)
    lat0, dlat, nlat, lon0, dlon, nlon = X.reference_grid("PRECTOTCORR")
    blat = np.repeat(lat0 + dlat * np.arange(nlat), nlon)
    assert not any(r["available"][np.abs(blat) >= 60].any() for r in rain)


def _row(var, lat, lon):
    recs, el = MM.records_for(var)
    b = X.box_of(var, lat, lon)
    z = np.load(os.path.join(config.CACHE_DIR, f"reference_{var}.npz"))
    one = [{"slope": r["slope"][[b]], "p": r["p"][[b]], "available": r["available"][[b]]} for r in recs]
    n, k, c = MM.counts(np.array([np.sign(z["merraSlope"][b])]), one)
    return recs, b, int(n[0]), int(k[0]), int(c[0])


@needs_cache
def test_cebu_box_three_of_four_confirm():
    recs, b, n, k, c = _row("PRECTOTCORR", 10.32, 123.89)
    assert (n, k, c) == (4, 3, 0)
    assert MM.class_of(n, k, c) == "confirmed"
    sig = {r["short"]: bool(r["p"][b] < 0.05) for r in recs}
    assert sig == {"GPCP": False, "CMAP": True, "GPCC": True, "PREC/L": True}
    assert recs[0]["slope"][b] == pytest.approx(0.091, abs=0.0005)   # GPCP alone said "not confirmed"


@needs_cache
def test_manila_box_two_of_four():
    recs, b, n, k, c = _row("PRECTOTCORR", 14.6, 121.0)
    assert (n, k, c) == (4, 2, 0)
    assert MM.class_of(n, k, c) == "partly"   # two of four is not more than half
    assert recs[2]["p"][b] > 0.05            # GPCC not significant here


@needs_cache
def test_ocean_box_has_only_gpcp_and_cmap():
    recs, b, n, k, c = _row("PRECTOTCORR", 0.0, -150.0)
    assert [bool(r["available"][b]) for r in recs] == [True, True, False, False]
    assert n == 2


@needs_cache
def test_t2m_two_records_over_land_and_one_gistemp_only_box():
    recs, b, n, k, c = _row("T2M", 41.01, 28.97)
    assert [r["short"] for r in recs] == ["NASA GISTEMP", "GHCN-CAMS"] and n == 2
    recs, el = MM.records_for("T2M")
    only_first = recs[0]["available"] & ~recs[1]["available"]
    assert only_first.sum() > 0              # some land boxes have GISTEMP only: n = 1 there


@needs_cache
def test_consensus_block_is_a_partition():
    for var in X.VARS:
        with open(os.path.join(X.OUT_DIR, f"{var}.json")) as f:
            d = json.load(f)
        c = d["consensus"]
        assert abs(sum(c[k] for k in ("confirmed", "partly", "unconfirmed", "contradicted")) - 1) < 0.001
        for n, row in c["byCount"].items():
            assert len(row) == int(n) + 1 and abs(sum(row.values()) - 1) < 0.001
        assert abs(sum(c["byCountArea"].values()) - 1) < 0.001
        assert c["records"] == [r["short"] for r in d["records"]]
