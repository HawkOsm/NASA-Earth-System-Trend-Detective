"""Shared configuration for the Trend Detective offline pipeline."""
import os

YEARS = list(range(1981, 2026))  # 1981..2025 inclusive, 45 years
TIME_START = "1981-01-01"
TIME_END = "2025-12-31"
STORE = "s3://nasa-power/merra2/temporal/power_merra2_annual_temporal_lst.zarr"
ALPHA = 0.05

VARIABLES = {
    "T2M": {
        "label": "Air temperature",
        "units": "C",
        "units_per_decade": "C per decade",
        "definition": "Average air temperature 2 metres above the ground over the year.",
        "colormap": "RdBu_r",
    },
    "PRECTOTCORR": {
        "label": "Precipitation",
        "units": "mm/day",
        "units_per_decade": "mm/day per decade",
        "definition": "Average amount of rain and snow (as water) falling per day over the year.",
        "colormap": "BrBG",
    },
    "WS2M": {
        "label": "Wind speed",
        "units": "m/s",
        "units_per_decade": "m/s per decade",
        "definition": "Average wind speed 2 metres above the ground over the year.",
        "colormap": "PuOr_r",
    },
}

# (name, lat, lon)
LANDMARKS = [
    ("0N 0E", 0.0, 0.0),
    ("Istanbul", 41.01, 28.97),
    ("Sydney", -33.87, 151.21),
    ("New York", 40.71, -74.01),
]

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(PIPELINE_DIR, "cache")
WEB_DATA_DIR = os.path.join(os.path.dirname(PIPELINE_DIR), "web", "public", "data")
