"""OMI total column ozone (NASA Aura, product OMTO3d v004, daily level-3, 1 degree), 2005-2025, Dobson units.

    python instruments/omi_o3.py           fetch what is missing, then build cache/inst_omi_o3.npz
    python instruments/omi_o3.py build     build from the cache only

Two sources of the same product and version:
  - NASA Goddard's anonymous archive of daily text files (.../anonftp/toms/omi/data/ozone/Y2005/...). Its server
    stopped answering after about 4,500 files, so only the files already in cache/inst_raw/omi_o3/Y<year>/ are used.
  - NASA GES DISC through OPeNDAP (needs an Earthdata account; see instruments/earthdata.py) for every other day.
A test (`python instruments/omi_o3.py compare 20100101`) fetches from GES DISC a day that is also on disk as text
and prints how the two differ.

Rules: only the odd days of each month are used (1, 3, ..., 31), the same for every year, which halves the download.
A month's cell is the mean of its valid sampled days and needs at least 5; a year is the mean of its twelve months
weighted by days in the month and needs all twelve. OMI measures in sunlight, so there is no yearly value in the
polar night (poleward of about 60 degrees). Product layout: see instruments/earthdata.py.
"""
import calendar
import json
import os
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import earthdata as E  # noqa: E402

RAW = os.path.join(E.CACHE, "inst_raw", "omi_o3")
DAP = os.path.join(RAW, "gesdisc")
OUT = os.path.join(E.CACHE, "inst_omi_o3.npz")
YEARS = list(range(2005, 2026))
MIN_DAYS = 5
VAR = "/HDFEOS/GRIDS/OMI_Column_Amount_O3/Data_Fields/ColumnAmountO3"
SHORT, VERSION = "OMTO3d", "004"


def sampled_days(y):
    return [f"{y}{m:02d}{d:02d}" for m in range(1, 13) for d in range(1, calendar.monthrange(y, m)[1] + 1, 2)]


def text_files():
    """{YYYYMMDD: path} of the daily text files already on disk."""
    out = {}
    for y in YEARS:
        d = os.path.join(RAW, f"Y{y}")
        if not os.path.isdir(d):
            continue
        for n in os.listdir(d):
            m = re.match(r"OMI-Aura_L3-OMTO3dtoz_(\d{4})m(\d{4})_v004.*\.txt$", n)
            if m:
                out[m.group(1) + m.group(2)] = os.path.join(d, n)
    return out


def parse_text(text):
    """[180][360] float Dobson units (NaN = missing), lat ascending from -89.5, lon ascending from -179.5. The file has
    3 header lines, then per latitude 15 lines of 3-character integers (25 per line; the last line has 10 and the
    latitude label); 0 means missing."""
    lines = text.replace("\r", "").split("\n")[3:]
    rows, cur = [], []
    for ln in lines:
        if not ln.strip():
            continue
        body = ln[1:]
        if "lat =" in body:
            cur.append(body[:30])
            rows.append("".join(cur))
            cur = []
        else:
            cur.append(body[:75])
    if cur or len(rows) != 180 or any(len(r) != 1080 for r in rows):
        raise ValueError(f"bad file: {len(rows)} latitude groups")
    a = np.frombuffer("".join(rows).encode("ascii"), dtype=np.uint8).reshape(-1, 3).astype(np.int32)
    a = np.where(a == 32, 48, a) - 48
    v = (a[:, 0] * 100 + a[:, 1] * 10 + a[:, 2]).reshape(180, 360).astype(np.float64)
    return np.where(v > 0, v, np.nan)


def parse_dap(blob):
    """The GES DISC answer for one day -> the same layout as parse_text. Rows run south to north, like the text."""
    _, shape, a = E.parse_dods_first(blob)
    a = a.reshape(180, 360)
    return np.where((a > 0) & (a < 1000), a, np.nan)


def catalogue(log=print):
    """{YYYYMMDD: opendap url} of every v004 daily file, from NASA's public catalogue (cached)."""
    path = os.path.join(DAP, "_granules.json")
    if os.path.exists(path):
        return json.load(open(path))
    out, after = {}, None
    while True:
        params = {"short_name": SHORT, "version": VERSION, "page_size": "2000",
                  "temporal": f"{YEARS[0]}-01-01T00:00:00Z,{YEARS[-1]}-12-31T23:59:59Z"}
        req = E.urllib.request.Request(E.CMR + "?" + urllib.parse.urlencode(params), headers={"User-Agent": E.UA, **({"CMR-Search-After": after} if after else {})})
        with E._OPENER.open(req, timeout=120) as r:
            data = json.loads(r.read())
            after = r.headers.get("CMR-Search-After")
        items = data.get("items", [])
        for it in items:
            m = re.search(r"OMTO3d_(\d{4})m(\d{4})_v004", it["umm"]["GranuleUR"])
            url = next((u["URL"] for u in it["umm"].get("RelatedUrls", []) if "opendap.earthdata.nasa.gov" in u.get("URL", "")), None)
            if m and url:
                out[m.group(1) + m.group(2)] = url
        if len(items) < 2000 or not after:
            break
    os.makedirs(DAP, exist_ok=True)
    json.dump(out, open(path, "w"))
    log(f"catalogue: {len(out)} daily files")
    return out


def fetch(log=print):
    os.makedirs(DAP, exist_ok=True)
    have = text_files()
    cat = catalogue(log)
    todo = [d for y in YEARS for d in sampled_days(y)
            if d not in have and d in cat and not os.path.exists(os.path.join(DAP, d + ".dods"))]
    log(f"omi_o3: {len(todo)} days to fetch from GES DISC")
    t0 = time.time()

    def one(day):
        blob = E._get(cat[day] + ".dods?" + urllib.parse.quote(VAR, safe="/"), auth=True)
        parse_dap(blob)
        tmp = os.path.join(DAP, day + ".dods.part")
        with open(tmp, "wb") as f:
            f.write(blob)
        os.replace(tmp, os.path.join(DAP, day + ".dods"))

    with ThreadPoolExecutor(E.WORKERS) as ex:
        for k, _ in enumerate(ex.map(one, todo), 1):
            if k % 200 == 0:
                log(f"  fetched {k}/{len(todo)}  {time.time() - t0:.0f} s")


def day_field(day, have):
    if day in have:
        return parse_text(open(have[day], encoding="ascii", errors="replace").read())
    p = os.path.join(DAP, day + ".dods")
    return parse_dap(open(p, "rb").read()) if os.path.exists(p) else None


def build(log=print):
    have = text_files()
    annual = np.full((len(YEARS), 180, 360), np.nan, dtype=np.float32)
    n_months = np.zeros((len(YEARS), 180, 360), dtype=np.int8)
    used = {"text": 0, "gesdisc": 0, "missing": 0}
    for k, y in enumerate(YEARS):
        total, days, count = np.zeros((180, 360)), 0, np.zeros((180, 360), dtype=np.int8)
        for m in range(1, 13):
            s, n = np.zeros((180, 360)), np.zeros((180, 360), dtype=np.int16)
            for d in range(1, calendar.monthrange(y, m)[1] + 1, 2):
                day = f"{y}{m:02d}{d:02d}"
                f = day_field(day, have)
                if f is None:
                    used["missing"] += 1
                    continue
                used["text" if day in have else "gesdisc"] += 1
                ok = np.isfinite(f)
                s += np.where(ok, f, 0.0)
                n += ok
            good = n >= MIN_DAYS
            dm = calendar.monthrange(y, m)[1]
            total += np.where(good, s / np.maximum(n, 1), 0.0) * dm
            count += good
            days += dm
        n_months[k] = count
        annual[k] = np.where(count == 12, total / days, np.nan)
    np.savez_compressed(
        OUT, annual=annual, years=np.array(YEARS, dtype=np.int32), lat=-89.5 + np.arange(180.0), lon=-179.5 + np.arange(360.0),
        n_months=n_months, units="Dobson units",
        source="OMTO3d v004 daily level-3: NASA Goddard anonymous archive (text) for the days on disk, NASA GES DISC OPeNDAP for the rest",
        native="OMI/Aura TOMS-like total column ozone, 1 degree daily; odd days of each month, month needs 5 valid days, year needs 12 months")
    valid = [int(np.isfinite(annual[k]).sum()) for k in range(len(YEARS))]
    log(f"omi_o3: wrote {OUT}; days used {used}; valid cells per year min {min(valid)} max {max(valid)}")


def compare(day, log=print):
    have, cat = text_files(), catalogue(log)
    a = parse_text(open(have[day], encoding="ascii", errors="replace").read())
    b = parse_dap(E._get(cat[day] + ".dods?" + urllib.parse.quote(VAR, safe="/"), auth=True))
    both = np.isfinite(a) & np.isfinite(b)
    log(f"{day}: valid text {int(np.isfinite(a).sum())}, valid GES DISC {int(np.isfinite(b).sum())}, both {int(both.sum())}")
    log(f"  as is: mean |difference| {np.abs(a - b)[both].mean():.3f} DU, max {np.abs(a - b)[both].max():.2f}")
    bf = b[::-1]
    bothf = np.isfinite(a) & np.isfinite(bf)
    log(f"  GES DISC rows flipped: mean |difference| {np.abs(a - bf)[bothf].mean():.3f} DU (should be much larger)")


if __name__ == "__main__":
    arg = sys.argv[1:] or ["all"]
    if arg[0] == "compare":
        compare(arg[1])
    else:
        if arg[0] != "build":
            fetch()
        build()
