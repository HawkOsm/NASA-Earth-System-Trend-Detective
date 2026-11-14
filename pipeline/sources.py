"""Fetchers for additional observation records, used by reference_more.py to check MERRA-2.

Everything here is public data with no login. Gridded records come from NOAA PSL's THREDDS server over OPeNDAP
(DAP2 binary `.dods`, one year per request, retries with back-off), one NetCDF-3 file (HadISST sea ice) is read
with scipy, and the hemispheric / zonal records are small text or CSV files. Every download is cached in
pipeline/cache, so nothing is fetched twice. No package outside numpy / scipy is needed.

Conventions of the returned data (same as reference.py's):
  gridded  annual[45][nlat][nlon] float32 for 1981..2025, lat ascending, lon -180..180 ascending, NaN = missing.
           An annual value is the mean of its 12 monthly values and is missing if any month is missing.
           Rainfall totals per month (GPCC) are first turned into mm/day.
  series   annual[45] float64 (hemispheric totals) or annual[45][nbands] (SBUV zonal means), NaN = missing.
"""
import calendar
import gzip
import os
import re
import struct
import time
import urllib.request

import numpy as np

import config

YEARS = np.array(config.YEARS)
NY = len(YEARS)
PSL = "https://psl.noaa.gov/thredds/dodsC/Datasets"
MAX_VALUES = 800_000  # values per OPeNDAP request (about 3 MB)
UA = {"User-Agent": "trend-detective-research/1.0 (public data, polite client)"}

# kind: "mean" (value as is) or "total" (monthly total, divided by days in month)
GRID_RECORDS = {
    "ghcncams": {"base": f"{PSL}/ghcncams/air.mon.mean.nc", "var": "air", "kind": "mean", "add": -273.15,
                 "name": "GHCN-CAMS land 2 m air temperature, 0.5 deg (NOAA CPC / PSL)", "units": "degC"},
    "noaagt": {"base": f"{PSL}/noaaglobaltemp/air.mon.anom.nc", "var": "air", "kind": "mean", "add": 0.0,
               "name": "NOAAGlobalTemp v5.1 land+ocean anomaly, 5 deg (NOAA NCEI)", "units": "degC anomaly"},
    "gpcc": {"base": f"{PSL}/gpcc/full_v2025/precip.mon.total.2.5x2.5.v2025.nc", "var": "precip", "kind": "total",
             "name": "GPCC Full Data v2025 land gauge precipitation, 2.5 deg (DWD)", "units": "mm/day"},
    "cmap": {"base": f"{PSL}/cmap/std/precip.mon.mean.nc", "var": "precip", "kind": "mean",
             "name": "CMAP standard (gauges + satellite), 2.5 deg (NOAA CPC)", "units": "mm/day"},
    "precl": {"base": f"{PSL}/precl/2.5deg/precip.mon.mean.2.5x2.5.nc", "var": "precip", "kind": "mean",
              "name": "PREC/L land gauge precipitation, 2.5 deg (NOAA CPC)", "units": "mm/day"},
    "icoads_wspd": {"base": f"{PSL}/icoads2.5/2degree/enh/wspd.mean.nc", "var": "wspd", "kind": "mean",
                    "name": "ICOADS 2.5 enhanced ship wind speed, 2 deg", "units": "m/s"},
    "icoads_rhum": {"base": f"{PSL}/icoads2.5/2degree/enh/rhum.mean.nc", "var": "rhum", "kind": "mean",
                    "name": "ICOADS 2.5 enhanced ship relative humidity, 2 deg", "units": "%"},
    "oisst_ice": {"base": f"{PSL}/noaa.oisst.v2/icec.mnmean.nc", "var": "icec", "kind": "mean", "scale100": True,
                  "name": "NOAA OISST v2 sea-ice concentration, 1 deg", "units": "%"},
}

HADISST_URL = "https://www.metoffice.gov.uk/hadobs/hadisst/data/HadISST_ice.nc.gz"
RUTGERS_URL = "https://climate.rutgers.edu/snowcover/files/moncov.nhland.txt"
NSIDC_URL = "https://noaadata.apps.nsidc.org/NOAA/G02135/{hemi}/monthly/data/{h}_{mm:02d}_extent_v4.0.csv"
SBUV_URL = "https://acd-ext.gsfc.nasa.gov/Data_services/merged/data/sbuv.v87.mod_v14.70-25.za.txt"


# ---------------------------------------------------------------- HTTP and DAP2 parsing

def http_get(url, tries=6, timeout=120, log=print):
    """Bytes of a URL with retries and back-off."""
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            log(f"  attempt {k + 1} failed: {e}")
            time.sleep(2 * (k + 1))
    raise RuntimeError(f"could not fetch {url}: {last}")


_TYPES = {"Byte": (">u1", 1), "Int16": (">i4", 4), "UInt16": (">u4", 4), "Int32": (">i4", 4),
          "UInt32": (">u4", 4), "Float32": (">f4", 4), "Float64": (">f8", 8)}
_DECL = re.compile(r"\b(Byte|Int16|UInt16|Int32|UInt32|Float32|Float64)\s+\w+[\[;]")


def parse_dods(blob):
    """First array of a DAP2 .dods response as float64 (flat). DAP2 sends Int16 / UInt16 as 32-bit words, Byte padded
    to 4 bytes per... (here: one XDR word per element after the length), Float32 / Float64 as is."""
    k = blob.index(b"\nData:\n")
    head = blob[:k].decode("latin1")
    body = blob[k + len(b"\nData:\n"):]
    arr = head.index("ARRAY:") if "ARRAY:" in head else 0
    m = _DECL.search(head, arr)
    if not m:
        raise ValueError("no array declaration in DAP header")
    dt, size = _TYPES[m.group(1)]
    if m.group(1) == "Byte":
        n1, n2 = struct.unpack(">II", body[:8])
        if n1 != n2:
            raise ValueError("bad DAP array header")
        return np.frombuffer(body[8:8 + n1], dtype=">u1").astype(np.float64)
    n1, n2 = struct.unpack(">II", body[:8])
    if n1 != n2:
        raise ValueError("bad DAP array header")
    raw = body[8:8 + size * n1]
    if len(raw) != size * n1:
        raise ValueError("truncated DAP response")
    return np.frombuffer(raw, dtype=dt).astype(np.float64)


def parse_das(text):
    """{variable: {attribute: value}} from a DAP2 .das text; numbers become float, strings stay str."""
    out, cur = {}, None
    for line in text.splitlines():
        s = line.strip()
        if s.endswith("{") and not s.startswith("Attributes"):
            cur = s[:-1].strip()
            out[cur] = {}
        elif s == "}":
            cur = None
        elif cur is not None and s.endswith(";"):
            m = re.match(r"(\w+)\s+(\w+)\s+(.*);$", s)
            if not m:
                continue
            typ, name, val = m.groups()
            if typ == "String":
                out[cur][name] = val.strip().strip('"')
            else:
                try:
                    out[cur][name] = float(val.split(",")[0])
                except ValueError:
                    pass
    return out


def months_from_time(values, units):
    """(year[], month[]) of a CF time axis ('hours|days since YYYY-M-D ...'); a monthly stamp may be the 1st or mid-month."""
    m = re.match(r"\s*(hours|days)\s+since\s+(\d+)-(\d+)-(\d+)", units)
    if not m:
        raise ValueError(f"unsupported time units {units!r}")
    unit, y, mo, d = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4))
    t0 = np.datetime64(f"{y:04d}-{mo:02d}-{d:02d}")
    secs = np.asarray(values, dtype=np.float64) * (3600.0 if unit == "hours" else 86400.0)
    dates = t0 + secs.astype("timedelta64[s]")
    mm = dates.astype("datetime64[M]")
    yr = mm.astype("datetime64[Y]").astype(int) + 1970
    mon = (mm.astype(int) % 12) + 1
    return yr, mon


def annual_from_monthly(m):
    """[12][...] monthly values -> annual mean; NaN wherever any of the 12 months is missing."""
    m = np.asarray(m, dtype=np.float64)
    if m.shape[0] != 12:
        raise ValueError("need 12 months")
    return m.mean(axis=0)  # NaN propagates


def days_in_month(year, month):
    return calendar.monthrange(int(year), int(month))[1]


def to_ascending_180(a, lat, lon):
    """Reorder the last two axes of a [..., nlat, nlon] field to lat ascending and lon -180..180 ascending."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    if lat[0] > lat[-1]:
        lat = lat[::-1]
        a = a[..., ::-1, :]
    lon = np.where(lon >= 180, lon - 360, lon)  # 180 -> -180: a box owns its lower edge
    o = np.argsort(lon)
    return a[..., :, o], lat, lon[o]


# ---------------------------------------------------------------- gridded records over OPeNDAP

def _cache(name):
    os.makedirs(config.CACHE_DIR, exist_ok=True)
    return os.path.join(config.CACHE_DIR, name)


def dap_axes(base, var, log=print):
    """(lat, lon, year[], month[], attrs of var) of a PSL dataset, from the .das and the coordinate arrays."""
    das = parse_das(http_get(base + ".das", log=log).decode("latin1"))
    lat = parse_dods(http_get(base + ".dods?lat", log=log))
    lon = parse_dods(http_get(base + ".dods?lon", log=log))
    tv = parse_dods(http_get(base + ".dods?time", log=log))
    units = das["time"]["units"]
    yr, mon = months_from_time(tv, units)
    return lat, lon, yr, mon, das[var], das


def _decode(raw, attrs):
    """Packed values -> physical values with NaN for missing."""
    x = np.asarray(raw, dtype=np.float64)
    bad = np.zeros(x.shape, dtype=bool)
    for k in ("missing_value", "_FillValue"):
        if k in attrs:
            bad |= x == attrs[k]
    x = x * attrs.get("scale_factor", 1.0) + attrs.get("add_offset", 0.0)
    return np.where(bad | ~np.isfinite(x) | (np.abs(x) > 1e30), np.nan, x)


def fetch_grid(key, log=print):
    """annual[45][nlat][nlon] float32 (see the module docstring), lat, lon, cached in pipeline/cache/src_<key>.npz."""
    path = _cache(f"src_{key}.npz")
    if os.path.exists(path):
        z = np.load(path)
        return z["annual"], z["lat"], z["lon"]
    r = GRID_RECORDS[key]
    base, var = r["base"], r["var"]
    lat, lon, yr, mon, attrs, _ = dap_axes(base, var, log)
    nlat, nlon = len(lat), len(lon)
    out = np.full((NY, nlat, nlon), np.nan, dtype=np.float32)
    for k, year in enumerate(config.YEARS):
        idx = np.flatnonzero(yr == year)
        if len(idx) == 0:
            continue
        i0, i1 = int(idx[0]), int(idx[-1])
        if i1 - i0 + 1 != len(idx):
            raise ValueError("time axis is not contiguous")
        step = max(1, MAX_VALUES // (nlat * nlon))  # months per request: keeps one response small
        parts = []
        for a in range(i0, i1 + 1, step):
            b = min(a + step - 1, i1)
            url = f"{base}.dods?{var}.{var}[{a}:{b}][0:{nlat - 1}][0:{nlon - 1}]"
            part = parse_dods(http_get(url, log=log))
            if part.size != (b - a + 1) * nlat * nlon:
                raise ValueError(f"{key} {year}: got {part.size} values")
            parts.append(part)
        v = np.concatenate(parts)
        v = _decode(v, attrs).reshape(len(idx), nlat, nlon)
        if r["kind"] == "total":
            v = v / np.array([days_in_month(year, m) for m in mon[idx]])[:, None, None]
        v = v + r.get("add", 0.0)
        if r.get("scale100"):
            v = np.where(v > 100.0, np.nan, v)  # OISST ice: values above 100 % are flags, not concentrations
        full = np.full((12, nlat, nlon), np.nan)
        full[mon[idx] - 1] = v
        out[k] = annual_from_monthly(full)
        log(f"  {key} {year}: {np.isfinite(out[k]).mean():.2f} valid")
    ann, lat2, lon2 = to_ascending_180(out, lat, lon)
    np.savez_compressed(path, annual=ann, lat=lat2, lon=lon2)
    return ann, lat2, lon2


def dap_point_annual(key, year, lat, lon, log=print):
    """Annual value of a gridded record at the grid point nearest to (lat, lon), recomputed from a SEPARATE request:
    the 12 monthly values of that year as text (the .ascii form, not the binary .dods used by fetch_grid).
    Returns (value, grid lat, grid lon, list of the 12 monthly values)."""
    r = GRID_RECORDS[key]
    base, var = r["base"], r["var"]
    la, lo, yr, mon, attrs, _ = dap_axes(base, var, log)
    idx = np.flatnonzero(yr == year)
    lo180 = np.where(lo >= 180, lo - 360, lo)
    ilat = int(np.argmin(np.abs(la - lat)))
    ilon = int(np.argmin(np.abs(lo180 - lon)))
    url = f"{base}.ascii?{var}.{var}[{int(idx[0])}:{int(idx[-1])}][{ilat}:{ilat}][{ilon}:{ilon}]"
    txt = http_get(url, log=log).decode("latin1")
    raw = [float(line.split(",")[-1]) for line in txt.splitlines() if line.startswith("[")]
    v = _decode(np.array(raw), attrs)
    if r["kind"] == "total":
        v = v / np.array([days_in_month(year, m) for m in mon[idx]])
    v = v + r.get("add", 0.0)
    if r.get("scale100"):
        v = np.where(v > 100.0, np.nan, v)
    full = np.full(12, np.nan)
    full[mon[idx] - 1] = v
    return float(annual_from_monthly(full)), float(la[ilat]), float(lo180[ilon]), [float(x) for x in full]


# ---------------------------------------------------------------- HadISST sea ice (NetCDF-3 file)

def fetch_hadisst(log=print):
    """annual[45][180][360] sea-ice concentration in percent for HadISST1 (1 deg), lat, lon (ascending, -180..180)."""
    path = _cache("src_hadisst.npz")
    if os.path.exists(path):
        z = np.load(path)
        return z["annual"], z["lat"], z["lon"]
    from scipy.io import netcdf_file
    gz = _cache("HadISST_ice.nc.gz")
    if not os.path.exists(gz):
        log("  downloading HadISST_ice.nc.gz (17 MB)")
        with open(gz, "wb") as f:
            f.write(http_get(HADISST_URL, log=log))
    ncp = _cache("HadISST_ice.nc")
    if not os.path.exists(ncp):
        with gzip.open(gz, "rb") as fi, open(ncp, "wb") as fo:
            while True:
                b = fi.read(1 << 24)
                if not b:
                    break
                fo.write(b)
    f = netcdf_file(ncp, mmap=True)
    lat = np.array(f.variables["latitude"][:], dtype=np.float64)
    lon = np.array(f.variables["longitude"][:], dtype=np.float64)
    units = f.variables["time"].units
    units = units.decode() if isinstance(units, bytes) else units
    # scipy's mmap read of the record variable "time" returns the fill value 9.96921e36 for this file, so the month of
    # each step is taken from the midpoint of "time_bnds" (which reads correctly)
    tv = np.array(f.variables["time_bnds"][:], dtype=np.float64).mean(axis=1)
    yr, mon = months_from_time(tv, units)
    if len(yr) != f.variables["sic"].shape[0] or (yr[0], mon[0]) != (1870, 1):
        raise ValueError("unexpected HadISST time axis")
    v = f.variables["sic"]
    fill = float(getattr(v, "_FillValue", getattr(v, "missing_value", -1e30)))
    out = np.full((NY, len(lat), len(lon)), np.nan, dtype=np.float32)
    for k, year in enumerate(config.YEARS):
        idx = np.flatnonzero(yr == year)
        if len(idx) != 12:
            continue
        x = np.array(v[int(idx[0]):int(idx[-1]) + 1], dtype=np.float64)
        x = np.where((x == fill) | (x < -1.0) | (x > 1.5), np.nan, x) * 100.0
        out[k] = annual_from_monthly(x)
    ann, lat2, lon2 = to_ascending_180(out, lat, lon)
    np.savez_compressed(path, annual=ann, lat=lat2, lon=lon2)
    return ann, lat2, lon2


# ---------------------------------------------------------------- text and CSV records

def cached_text(url, name, log=print):
    p = _cache(name)
    if not os.path.exists(p):
        with open(p, "wb") as f:
            f.write(http_get(url, log=log))
    with open(p, "r", encoding="latin1") as f:
        return f.read()


def annual_of_months(table, first=1981, last=2025):
    """{(year, month): value} -> annual[45], mean of 12 months, NaN if any month is missing."""
    out = np.full(last - first + 1, np.nan)
    for i, y in enumerate(range(first, last + 1)):
        v = [table.get((y, m), np.nan) for m in range(1, 13)]
        out[i] = annual_from_monthly(np.array(v)) if all(np.isfinite(v)) else np.nan
    return out


def parse_rutgers(text):
    """'YYYY MM area_km2' lines -> {(year, month): area in million km2}."""
    t = {}
    for line in text.splitlines():
        p = line.split()
        if len(p) == 3:
            try:
                t[(int(p[0]), int(p[1]))] = float(p[2]) / 1e6
            except ValueError:
                pass
    return t


def fetch_rutgers(log=print):
    """annual[45] Northern Hemisphere land snow-cover extent, million km2 (Rutgers Global Snow Lab)."""
    return annual_of_months(parse_rutgers(cached_text(RUTGERS_URL, "src_rutgers_nhland.txt", log)))


def parse_nsidc(text):
    """NSIDC Sea Ice Index monthly CSV (year, mo, source, region, extent, area) -> {(year, month): (extent, area)}."""
    t = {}
    for line in text.splitlines()[1:]:
        p = [x.strip() for x in line.split(",")]
        if len(p) >= 6:
            try:
                e, a = float(p[4]), float(p[5])
            except ValueError:
                continue
            if e < 0 or a < 0:  # -9999 = missing
                continue
            t[(int(p[0]), int(p[1]))] = (e, a)
    return t


def fetch_nsidc(hemi, log=print):
    """(extent[45], area[45]) in million km2 for hemi 'north' or 'south' (NSIDC Sea Ice Index v4, G02135)."""
    ext, area = {}, {}
    for mm in range(1, 13):
        h = "N" if hemi == "north" else "S"
        txt = cached_text(NSIDC_URL.format(hemi=hemi, h=h, mm=mm), f"src_nsidc_{h}_{mm:02d}.csv", log)
        for (y, m), (e, a) in parse_nsidc(txt).items():
            ext[(y, m)], area[(y, m)] = e, a
    return annual_of_months(ext), annual_of_months(area)


def parse_sbuv(text):
    """SBUV merged ozone zonal means -> (years[], monthly[nyears][36][12] DU with NaN for the 0.0 'no data' value).
    Bands are 5 degrees wide from -90 to 90."""
    years, blocks, cur = [], [], None
    for line in text.splitlines():
        p = line.split()
        if not p:
            continue
        if len(p) >= 2 and p[0].isdigit() and len(p[0]) == 4 and not p[1].lstrip("-").isdigit():
            years.append(int(p[0]))
            cur = []
            blocks.append(cur)
        elif cur is not None and len(p) == 14 and p[0].lstrip("-").isdigit():
            cur.append([float(x) for x in p[2:]])
    arr = np.full((len(years), 36, 12), np.nan)
    for i, b in enumerate(blocks):
        if len(b) == 36:
            arr[i] = np.array(b)
    arr[arr == 0.0] = np.nan
    return np.array(years), arr


def fetch_sbuv(log=print):
    """annual[45][36] total ozone (Dobson units) per 5 degree band (-90..90), NaN where any month is missing."""
    yrs, m = parse_sbuv(cached_text(SBUV_URL, "src_sbuv_za.txt", log))
    out = np.full((NY, 36), np.nan)
    for i, y in enumerate(config.YEARS):
        j = np.flatnonzero(yrs == y)
        if len(j):
            out[i] = annual_from_monthly(np.moveaxis(m[j[0]], 1, 0))
    return out
