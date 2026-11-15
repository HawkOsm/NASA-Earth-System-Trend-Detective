"""Shared rules for turning a cached annual field into the products the site reads.

One definition of "no data", used by compute.py, export.py, export_annual_grid.py, countries.py and seas.py:
  * a value that is NaN, the POWER fill value (-999) or <= -900 is missing;
  * for variables with config "zero_means_absent" (snow cover, sea ice): a cell that is 0 in every year has no data
    ("there is never any snow / sea ice here");
  * percent variables ("display_scale": 100) are shown as an exact integer percent: round(round(x, 2) * 100);
  * Int16 files store round((value - int16_offset) * 100); a missing value is -32768.
The browser applies the same rules to the NASA POWER API values (web/src/data/noData.ts).
"""
import os

import numpy as np

import config
from export_wind import NLAT as CNLAT, NLON as CNLON, block_average

MISSING = -32768
FILL_LIMIT = -900.0


def rules(var):
    """(display_scale, int16_offset, zero_means_absent) of one variable."""
    c = config.VARIABLES[var]
    return c.get("display_scale", 1), c.get("int16_offset", 0), bool(c.get("zero_means_absent", False))


def surface(var):
    """"land", "sea" or "any": where the variable has honest values (config "surface")."""
    return config.VARIABLES[var].get("surface", "any")


def has_pieces(var, sea):
    """False for a sea piece of a land variable and for a country piece of a sea variable: those are 'no data' and no
    files are written (the browser decides from the meta "surface" field before fetching)."""
    s = surface(var)
    return s == "any" or (s == "sea") == bool(sea)


def clean_field(a, display_scale=1, zero_means_absent=False, exact=False):
    """float64 [years][lat][lon] with every missing value NaN, rounded to the 2 decimals the source carries, and
    scaled to the displayed unit (a percent variable to a whole percent). The all-zero rule is applied here, at full
    resolution, before any averaging; it looks at the 2-decimal values.
    exact=True keeps the unrounded values (and unrounded percent): used for the coarse grid, whose block means were
    always taken from the unrounded cache."""
    a = np.asarray(a, dtype=np.float64)
    a = np.where(np.isfinite(a) & (a > FILL_LIMIT), a, np.nan)
    r = np.round(a, 2)
    if zero_means_absent:
        never = np.all(r == 0.0, axis=0)  # NaN == 0 is False, so a partly missing cell is not 'never'
        a = np.where(never[None, :, :], np.nan, a)
        r = np.where(never[None, :, :], np.nan, r)
    out = a if exact else r
    if display_scale != 1:
        out = out * display_scale if exact else np.round(out * display_scale)
    return out


def load_grid(var, exact=False):
    """The prepared full-resolution field of one variable (see clean_field), from pipeline/cache."""
    scale, _, zero = rules(var)
    return clean_field(np.load(os.path.join(config.CACHE_DIR, f"{var}_annual.npy")), scale, zero, exact)


def to_int16(values, offset=0):
    """values (any shape, NaN = missing) -> Int16 round((v - offset) * 100), NaN -> -32768. Raises on overflow."""
    v = np.asarray(values, dtype=np.float64)
    nan = np.isnan(v)
    q = np.rint((np.where(nan, 0.0, v) - offset) * 100.0)
    if np.abs(q).max(initial=0) > 32767:
        raise ValueError("Int16 overflow")
    return np.where(nan, MISSING, q).astype("<i2")


def from_int16(raw, offset=0):
    """Inverse of to_int16: float64 with NaN for -32768."""
    raw = np.asarray(raw)
    return np.where(raw == MISSING, np.nan, raw / 100.0 + offset)


def block_average_valid(a):
    """Coarse (181 x 288) block mean of one (361, 576) field that may hold NaN. Same weights as block_average; a coarse
    cell is the weighted mean of its valid members and is missing (NaN) when less than half of its weight is valid.
    A field with no NaN goes through block_average untouched, so existing products stay byte-identical."""
    a = np.asarray(a, dtype=np.float64)
    ok = np.isfinite(a)
    if ok.all():
        return block_average(a, None, None)
    num = block_average(np.where(ok, a, 0.0), None, None)
    den = block_average(ok.astype(np.float64), None, None)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = num / den
    return np.where(den >= 0.5 - 1e-9, out, np.nan)


def coarse_stack(grid):
    """block_average_valid for every year of a [years][361][576] field -> [years][181][288]."""
    return np.stack([block_average_valid(grid[k]) for k in range(grid.shape[0])])
