"""AIRS and GLDAS monthly fields from NASA GES DISC, through its OPeNDAP server. Needs a NASA Earthdata account.

    python instruments/earthdata.py airs_t      AIRS near-surface air temperature (AIRS3STM v7.0), 2003-2025, deg C
    python instruments/earthdata.py gldas_et    GLDAS-2.1 Noah evapotranspiration (GLDAS_NOAH10_M), 2001-2025, mm/day
    python instruments/earthdata.py gldas_sm    GLDAS-2.1 Noah root-zone soil moisture, 2001-2025, kg m-2

Sign-in: the account must have approved the application "NASA GESDISC DATA ARCHIVE", and a token generated on
https://urs.earthdata.nasa.gov must be saved in the file ~/.earthdata_token (or the file named by the environment
variable EARTHDATA_TOKEN_FILE). The token is sent only to hosts under earthdata.nasa.gov and is never printed.

How: the list of monthly files comes from NASA's public catalogue (CMR). For each month one variable is requested as a
DAP2 binary answer (`<granule>.dods?<variable>`, about 250 kB), so the HDF / NetCDF-4 files themselves are never
downloaded. Answers are kept in cache/inst_raw/KEY/, so a second run needs no network.

Product: cache/inst_KEY.npz, the same layout as the other instrument records: `annual` float32 [years][180][360] on
the 1 degree grid (lat -89.5..89.5 ascending, lon -179.5..179.5), `years`, `lat`, `lon`, `n_months`, `units`,
`source`, `native`. A year is the mean of its twelve months weighted by days in the month and needs all twelve.
"""
import calendar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "cache")
UA = "trend-detective-pipeline (research, non-commercial)"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
FILL = -9999.0
WORKERS = 3

PRODUCTS = {
    "airs_t": dict(
        short_name="AIRS3STM", version="7.0", first=2003, last=2025,
        variables=["/ascending/Data_Fields/SurfAirTemp_A", "/descending/Data_Fields/SurfAirTemp_D"],
        units="degC", native="AIRS3STM v7.0 (AIRS level-3 monthly standard retrieval), 1 degree; SurfAirTemp, mean of the "
                             "ascending and descending passes (both needed), kelvin - 273.15",
        source="NASA GES DISC OPeNDAP, https://opendap.earthdata.nasa.gov/collections/C1701805662-GES_DISC/granules/<granule>.dods?<variable>"),
    "gldas_et": dict(
        short_name="GLDAS_NOAH10_M", version="2.1", first=2001, last=2025, variables=["Evap_tavg"],
        units="mm/day", native="GLDAS_NOAH10_M v2.1 (GLDAS-2.1 Noah monthly), 1 degree, 60 S - 90 N, land only; Evap_tavg "
                               "kg m-2 s-1 * 86400",
        source="NASA GES DISC OPeNDAP, https://opendap.earthdata.nasa.gov/collections/C1288937542-GES_DISC/granules/<granule>.dods?Evap_tavg"),
    "gldas_sm": dict(
        short_name="GLDAS_NOAH10_M", version="2.1", first=2001, last=2025, variables=["RootMoist_inst"],
        units="kg m-2", native="GLDAS_NOAH10_M v2.1 (GLDAS-2.1 Noah monthly), 1 degree, 60 S - 90 N, land only; "
                               "RootMoist_inst (root-zone soil moisture), kg m-2 unchanged",
        source="NASA GES DISC OPeNDAP, https://opendap.earthdata.nasa.gov/collections/C1288937542-GES_DISC/granules/<granule>.dods?RootMoist_inst"),
}


def _token():
    path = os.environ.get("EARTHDATA_TOKEN_FILE", os.path.expanduser("~/.earthdata_token"))
    if not os.path.exists(path):
        raise SystemExit(f"No Earthdata token file at {path} (see the docstring of this script).")
    with open(path) as f:
        return f.read().strip()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect automatically: the token must not travel to another host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _get(url, auth, tries=6):
    """GET with retries. `auth`: send the Earthdata token (only to a host under earthdata.nasa.gov)."""
    host = urllib.parse.urlsplit(url).hostname or ""
    headers = {"User-Agent": UA}
    if auth:
        if not host.endswith(".earthdata.nasa.gov"):
            raise RuntimeError(f"refusing to send the token to {host}")
        headers["Authorization"] = "Bearer " + _token()
    last = None
    for k in range(tries):
        try:
            with _OPENER.open(urllib.request.Request(url, headers=headers), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                raise RuntimeError(f"unexpected redirect ({e.code}) from {host}; not followed") from None
            if e.code in (401, 403):
                raise RuntimeError(f"HTTP {e.code} from {host}: the token is missing, expired, or the GES DISC "
                                   f"application is not approved on the account") from None
            last = f"HTTP {e.code}"
        except Exception as e:  # noqa: BLE001  (timeouts, resets)
            last = repr(e)[:120]
        time.sleep(2 * (k + 1))
    raise RuntimeError(f"failed after {tries} tries: {url.split('?')[0][-80:]} ({last})")


def parse_dods_first(blob):
    """The first array of a DAP2 answer: (name, shape, float64 array). Header is text up to 'Data:\\n'; the array is
    two big-endian uint32 counts followed by the values (Float32 or Float64, big-endian)."""
    cut = blob.index(b"\nData:\n")
    head = blob[:cut].decode("latin1")
    m = re.search(r"(Float32|Float64)\s+(\S+?)((?:\[[^\]]+\])+);", head)
    if not m:
        raise ValueError("no array declaration in the DAP header: " + head[:200])
    kind, name, dims = m.group(1), m.group(2), m.group(3)
    shape = tuple(int(x) for x in re.findall(r"=\s*(\d+)\]", dims))
    n = int(np.prod(shape))
    body = memoryview(blob)[cut + len(b"\nData:\n"):]
    c1, c2 = np.frombuffer(body[:8], dtype=">u4")
    if int(c1) != n or int(c2) != n:
        raise ValueError(f"array length {int(c1)}/{int(c2)} does not match the declared shape {shape}")
    dt, width = (">f4", 4) if kind == "Float32" else (">f8", 8)
    return name, shape, np.frombuffer(body[8:8 + n * width], dtype=dt).astype(np.float64).reshape(shape)


def granules(spec, log=print):
    """{(year, month): opendap url} for every monthly granule in [first, last], from the public catalogue."""
    out = {}
    params = {"short_name": spec["short_name"], "version": spec["version"], "page_size": "2000",
              "temporal": f"{spec['first']}-01-01T00:00:00Z,{spec['last']}-12-31T23:59:59Z"}
    data = json.loads(_get(CMR + "?" + urllib.parse.urlencode(params), auth=False))
    for it in data.get("items", []):
        ur = it["umm"]["GranuleUR"]
        m = re.search(r"\.A(\d{4})(\d{2})\.", ur) or re.search(r"AIRS\.(\d{4})\.(\d{2})\.\d{2}\.L3", ur)
        if not m:
            continue
        y, mo = int(m.group(1)), int(m.group(2))
        if not spec["first"] <= y <= spec["last"]:
            continue
        url = next((u["URL"] for u in it["umm"].get("RelatedUrls", []) if "opendap.earthdata.nasa.gov" in u.get("URL", "")), None)
        if url and ((y, mo) not in out or ur > out[(y, mo)][0]):
            out[(y, mo)] = (ur, url)       # two files for a month: keep the later processing
    log(f"catalogue: {len(out)} monthly files for {spec['short_name']} {spec['version']} ({data.get('hits')} hits)")
    return {k: v[1] for k, v in out.items()}


def _raw_path(key, y, mo, var):
    return os.path.join(CACHE, "inst_raw", key, f"{y}{mo:02d}_{var.strip('/').split('/')[-1]}.dods")


def fetch(key, log=print):
    spec = PRODUCTS[key]
    os.makedirs(os.path.join(CACHE, "inst_raw", key), exist_ok=True)
    listing = os.path.join(CACHE, "inst_raw", key, "_granules.json")
    if os.path.exists(listing):
        gran = {tuple(int(x) for x in k.split("-")): v for k, v in json.load(open(listing)).items()}
    else:
        gran = granules(spec, log)
        json.dump({f"{y}-{mo}": u for (y, mo), u in gran.items()}, open(listing, "w"))
    todo = [(y, mo, var, url) for (y, mo), url in sorted(gran.items()) for var in spec["variables"]
            if not os.path.exists(_raw_path(key, y, mo, var))]
    log(f"{key}: {len(gran)} months in the catalogue, {len(todo)} answers to fetch")
    t0 = time.time()

    def one(job):
        y, mo, var, url = job
        blob = _get(url + ".dods?" + urllib.parse.quote(var, safe="/"), auth=True)
        parse_dods_first(blob)                       # a broken answer must not reach the cache
        tmp = _raw_path(key, y, mo, var) + ".part"
        with open(tmp, "wb") as f:
            f.write(blob)
        os.replace(tmp, _raw_path(key, y, mo, var))
        return len(blob)

    done = 0
    with ThreadPoolExecutor(WORKERS) as ex:
        for k, n in enumerate(ex.map(one, todo), 1):
            done += n
            if k % 100 == 0:
                log(f"  fetched {k}/{len(todo)}  {done / 1e6:.0f} MB  {time.time() - t0:.0f} s")
    return gran


def month_field(key, y, mo):
    """One month on the 1 degree grid [180][360], lat ascending from -89.5, lon from -179.5; NaN = missing."""
    spec = PRODUCTS[key]
    parts = []
    for var in spec["variables"]:
        p = _raw_path(key, y, mo, var)
        if not os.path.exists(p):
            return None
        _, shape, a = parse_dods_first(open(p, "rb").read())
        a = a.reshape(shape[-2], shape[-1])
        a = np.where(a <= FILL + 1, np.nan, a)
        parts.append(a)
    if key == "airs_t":
        # AIRS level-3 rows run north to south (89.5 N first), columns from 179.5 W; both passes are needed.
        f = (parts[0] + parts[1]) / 2.0 - 273.15
        return f[::-1, :]
    f = parts[0]
    if key == "gldas_et":
        f = f * 86400.0
    full = np.full((180, 360), np.nan)       # GLDAS rows run from 59.5 S to 89.5 N: 150 rows, placed at 30..179
    full[30:, :] = f
    return full


def build(key, log=print):
    spec = PRODUCTS[key]
    years = np.arange(spec["first"], spec["last"] + 1, dtype=np.int32)
    annual = np.full((len(years), 180, 360), np.nan, dtype=np.float32)
    n_months = np.zeros((len(years), 180, 360), dtype=np.int8)
    for k, y in enumerate(years):
        total = np.zeros((180, 360))
        days = 0
        count = np.zeros((180, 360), dtype=np.int8)
        for mo in range(1, 13):
            f = month_field(key, int(y), mo)
            if f is None:
                continue
            d = calendar.monthrange(int(y), mo)[1]
            ok = np.isfinite(f)
            total += np.where(ok, f, 0.0) * d
            count += ok
            days += d
        n_months[k] = count
        full = count == 12
        annual[k] = np.where(full, total / max(days, 1), np.nan)
    out = os.path.join(CACHE, f"inst_{key}.npz")
    np.savez_compressed(out, annual=annual, years=years, lat=-89.5 + np.arange(180.0), lon=-179.5 + np.arange(360.0),
                        n_months=n_months, units=spec["units"], source=spec["source"], native=spec["native"])
    valid = [int(np.isfinite(annual[k]).sum()) for k in range(len(years))]
    log(f"{key}: wrote {out}; valid cells per year min {min(valid)} max {max(valid)}; units {spec['units']}")
    return out


def main(argv):
    if not argv or argv[0] not in PRODUCTS:
        raise SystemExit("usage: python instruments/earthdata.py {" + " | ".join(PRODUCTS) + "} [build]")
    key = argv[0]
    if len(argv) < 2 or argv[1] != "build":
        fetch(key)
    build(key)


if __name__ == "__main__":
    main(sys.argv[1:])
