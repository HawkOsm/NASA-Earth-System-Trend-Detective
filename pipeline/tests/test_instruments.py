"""Readers of the instrument records (instruments/earthdata.py, instruments/omi_o3.py): no network is used."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "instruments"))

import earthdata as E  # noqa: E402
import omi_o3 as O  # noqa: E402


def dods(name, dims, values, kind="Float32"):
    decl = "".join(f"[{d} = {n}]" for d, n in dims)
    head = f"Dataset {{\n    {kind} {name}{decl};\n}} file.nc4;\nData:\n".encode()
    a = np.asarray(values, dtype=">f4" if kind == "Float32" else ">f8").ravel()
    n = np.array([a.size, a.size], dtype=">u4").tobytes()
    return head + n + a.tobytes()


def test_dap2_answer_is_read_with_its_shape():
    vals = np.arange(6, dtype=float).reshape(2, 3)
    name, shape, a = E.parse_dods_first(dods("/ascending/Data_Fields/SurfAirTemp_A", [("YDim", 2), ("XDim", 3)], vals))
    assert name == "/ascending/Data_Fields/SurfAirTemp_A" and shape == (2, 3)
    assert np.array_equal(a, vals)


def test_dap2_grid_with_a_time_axis_and_float64():
    vals = np.linspace(0, 1, 12).reshape(1, 3, 4)
    blob = dods("Evap_tavg", [("time", 1), ("lat", 3), ("lon", 4)], vals, kind="Float64")
    _, shape, a = E.parse_dods_first(blob)
    assert shape == (1, 3, 4) and np.allclose(a, vals)


def test_a_truncated_answer_is_refused():
    blob = dods("x", [("a", 2), ("b", 2)], [1, 2, 3, 4])
    bad = blob.replace(np.array([4, 4], dtype=">u4").tobytes(), np.array([3, 3], dtype=">u4").tobytes())
    with pytest.raises(ValueError):
        E.parse_dods_first(bad)


def test_the_token_is_never_sent_to_another_host(tmp_path, monkeypatch):
    tok = tmp_path / "token"
    tok.write_text("not-a-real-token")
    monkeypatch.setenv("EARTHDATA_TOKEN_FILE", str(tok))
    for url in ("https://example.org/x", "https://earthdata.nasa.gov.example.org/x", "https://notearthdata.nasa.gov/x"):
        with pytest.raises(RuntimeError, match="refusing to send the token"):
            E._get(url, auth=True, tries=1)


def test_omi_uses_the_odd_days_of_every_month():
    d = O.sampled_days(2024)
    assert d[0] == "20240101" and d[1] == "20240103" and "20240229" in d and "20240230" not in d
    assert len(d) == sum((n + 1) // 2 for n in (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31))


def test_omi_text_file_layout():
    row = lambda v: "".join(f"{v:3d}" for _ in range(360))  # noqa: E731
    lines = [" Day: 1 Jan 1, 2010", " Longitudes: 360 bins", " Latitudes : 180 bins"]
    for i in range(180):
        r = row(0 if i == 0 else 250 + i)
        for k in range(14):
            lines.append(" " + r[k * 75:(k + 1) * 75])
        lines.append(" " + r[1050:1080] + f"   lat = {-89.5 + i:6.1f}")
    a = O.parse_text("\r\n".join(lines) + "\r\n")
    assert a.shape == (180, 360)
    assert np.isnan(a[0]).all()                      # 0 means missing
    assert a[1, 0] == 251 and a[179, 359] == 429
