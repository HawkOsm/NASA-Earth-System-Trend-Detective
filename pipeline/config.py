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
        "group": "Temperature",
        "caveat": "Air temperature is tied to many weather observations and is among the most reliable variables here.",
    },
    "PRECTOTCORR": {
        "label": "Precipitation",
        "units": "mm/day",
        "units_per_decade": "mm/day per decade",
        "definition": "Average amount of rain and snow (as water) falling per day over the year.",
        "colormap": "BrBG",
        "group": "Water",
        "caveat": "Precipitation is corrected with rain gauges and satellites over land; over oceans and near the poles it is mostly model-generated, and satellite changes can show up as jumps.",
    },
    "WS2M": {
        "label": "Wind speed",
        "units": "m/s",
        "units_per_decade": "m/s per decade",
        "definition": "Average wind speed 2 metres above the ground over the year.",
        "colormap": "PuOr_r",
        "group": "Air",
        "caveat": "Wind near the surface is computed by the model from winds higher up; ocean trends are sensitive to changes in satellite wind measurements.",
    },
    "T2M_MAX": {
        "label": "Hottest temperature of the year",
        "units": "C",
        "units_per_decade": "C per decade",
        "definition": "The highest air temperature (2 metres above the ground, measured every hour) reached at any moment of the year.",
        "colormap": "RdBu_r",
        "group": "Temperature",
        "caveat": "This is the single hottest hour of each year: one extreme value a year, so it is noisier than the yearly average.",
    },
    "GWETROOT": {
        "label": "Soil moisture",
        "units": "%",
        "units_per_decade": "percentage points per decade",
        "units_short": "% pts",
        "definition": "How wet the soil is in the root zone (the top metre), from 0% (bone dry) to 100% (soaked), averaged over the year; land only.",
        "colormap": "BrBG",
        "group": "Water",
        "caveat": "Soil moisture is not measured directly: the model computes it from rain, evaporation and soil properties.",
        "display_scale": 100,
        "surface": "land",
    },
    "EVLAND": {
        "label": "Evaporation from land",
        "units": "mm/day",
        "units_per_decade": "mm/day per decade",
        "definition": "How much water evaporates from soil, plants and puddles into the air each day, averaged over the year; land only.",
        "colormap": "PRGn",
        "group": "Water",
        "caveat": "Evaporation is computed by the model, not measured.",
        "surface": "land",
    },
    "RH2M": {
        "label": "Humidity",
        "units": "%",
        "units_per_decade": "percentage points per decade",
        "units_short": "% pts",
        "definition": "How much water vapour the air 2 metres above the ground holds compared with the most it could hold, averaged over the year.",
        "colormap": "PiYG",
        "group": "Water",
        "caveat": "Humidity is tied to weather observations where stations exist and to the model elsewhere.",
    },
    "FRSNO": {
        "label": "Snow cover",
        "units": "%",
        "units_per_decade": "percentage points per decade",
        "units_short": "% pts",
        "definition": "The share of the land surface covered by snow, averaged over the year; places that never have snow show no data.",
        "colormap": "RdBu",
        "group": "Ice & snow",
        "caveat": "Snow cover is computed by the model from snowfall and melting, not taken from satellite snow maps.",
        "display_scale": 100,
        "zero_means_absent": True,
        "surface": "land",
    },
    "FRSEAICE": {
        "label": "Sea ice",
        "units": "%",
        "units_per_decade": "percentage points per decade",
        "units_short": "% pts",
        "definition": "The share of the sea surface covered by ice, averaged over the year; places that never have sea ice show no data.",
        "colormap": "RdBu",
        "group": "Ice & snow",
        "caveat": "Sea ice comes from satellite observations, not from the model, so it is one of the better-measured variables here.",
        "display_scale": 100,
        "zero_means_absent": True,
        "surface": "sea",
    },
    "TO3": {
        "label": "Ozone layer",
        "units": "Dobson units",
        "units_per_decade": "Dobson units per decade",
        "units_short": "DU",
        "definition": "How much ozone there is in the whole column of air above you (the layer that blocks harmful sunlight), averaged over the year.",
        "colormap": "PuOr",
        "group": "Air",
        "caveat": "Ozone combines satellite measurements with the model; the satellite instruments changed in late 2004, which can appear as a jump.",
        "int16_offset": 300,
    },
}

# "surface": "land" (no honest value over open water), "sea" (none over land) or "any" (default). A sea piece of a land
# variable and a country piece of a sea variable are "no data" and have no files (seas.py / countries.py skip them).
# Optional per-variable keys (see products.py): "display_scale" (100: a 0..1 fraction is shown as a whole percent),
# "int16_offset" (Int16 files store round((value - offset) * 100)), "zero_means_absent" (a cell that is 0 in every
# year has no data), "units_short" (short form of the per-decade units), "group" (picker group).
# Variables whose figures are used as test fixtures (country_cases.json, sea_cases.json, overlay_cases.json):
FIXTURE_VARIABLES = ["T2M", "PRECTOTCORR", "WS2M"]

# Base map (pipeline/basemap.py) and trend overlay (pipeline/export.py overlay_rgb, mirrored in web/src/rangeMap.ts).
# Tune the look here; export.py copies these values into every {VAR}_meta.json ("render") and the browser reads them.
BASEMAP_OCEAN = (150, 190, 220)  # soft blue
BASEMAP_LAND = (176, 205, 150)   # soft green
COLOR_FLOOR = 0.30     # colour position starts this far from the colormap centre, so the pale middle is never used
ALPHA_MAX = 0.92       # opacity of the strongest, certain trend
ALPHA_FULL_AT = 0.5    # |slope|/vmax at which opacity reaches ALPHA_MAX (weaker trends fade out linearly)

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
