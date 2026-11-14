# Trend Detective

An entry for the NASA Space Apps Challenge 2026, challenge **"Be An Earth System Trend Detective"**.

**Live site:** https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/

Trend Detective is a 3D globe coloured by how fast an Earth science variable has changed between 1981 and
2025. Pick a variable, click any place, and a side panel shows that location's time series, the trend line,
the rate of change per decade, a p-value, a 95% confidence range and a one-sentence plain-English verdict.

It is a static website: there is no backend. The map is precomputed offline; the click panel fetches the
selected location's data live from NASA POWER and computes the same statistics in the browser.

## Variables

| Name | What it is | Units |
|---|---|---|
| Air temperature (`T2M`) | Average air temperature 2 metres above the ground | °C |
| Hottest temperature of the year (`T2M_MAX`) | The highest hourly air temperature reached in the year (the annual maximum, not an average of daily maxima) | °C |
| Precipitation (`PRECTOTCORR`) | Average rain and snow (as water) per day | mm/day |
| Soil moisture (`GWETROOT`) | Wetness of the root zone (top metre), land only | % (percentage points per decade) |
| Evaporation from land (`EVLAND`) | Water evaporating from soil, plants and puddles per day, land only | mm/day |
| Humidity (`RH2M`) | Relative humidity of the air 2 metres above the ground | % |
| Snow cover (`FRSNO`) | Share of the land covered by snow, averaged over the year | % |
| Sea ice (`FRSEAICE`) | Share of the sea covered by ice, averaged over the year | % |
| Wind speed (`WS2M`) | Average wind speed 2 metres above the ground | m/s |
| Ozone layer (`TO3`) | Total ozone in the air column above the place | Dobson units |

The menu groups them as Temperature, Water, Ice & snow and Air (`web/src/demos.ts`, `pipeline/config.py`).

## Method

The same method is used for the map and for the click panel, so they agree.

- **Annual means.** One value per year per grid cell, 1981–2025 (45 values), taken from NASA POWER's own
  annual product.
- **Rate of change: Theil–Sen slope.** The median of the slopes between every pair of years, reported per
  decade. One unusual year cannot dominate it.
- **95% confidence range:** Sen's interval for the slope.
- **Significance: Mann–Kendall test**, with tie correction. If the year-to-year (lag-1) autocorrelation of the
  detrended ranks is significant, the variance is inflated following Hamed & Rao (1998), restricted to lag 1.
- **Map only: Benjamini–Hochberg false discovery control** across all 207,936 grid cells. Cells that are not
  significant after this correction are drawn pale.
- **Verdict:** p < 0.05 "significant"; 0.05–0.10 "possible trend, needs more years"; otherwise "no clear
  trend". Direction and rate are always stated.

**What is changing here? (ranking).** `pipeline/export_summary.py` writes `web/public/data/summary.bin` (+ `summary.json`
with the layout): for every cell of the coarse 100 km annual grid and every variable, the Theil–Sen slope per decade, the
Mann–Kendall p-value and the Benjamini–Hochberg adjusted p-value for 1981–2025 (BH across the cells that have data for
that variable; only those cells are stored). `web/src/whatsChanging.ts` ranks all variables at a place: significant
(p < 0.05) first, then possible (0.05–0.10), then no clear trend (the verdict rules above); inside each group by
strength = |slope per decade| divided by that variable's own spread (the 98th percentile of |slope| over its cells), so
variables with different units can be compared; ties by the order of the variables on the site. The numbers are for the
roughly 100 km box around the place, so they can differ slightly from the 50 km cell a click shows. Variables with no
value there (land-only over the sea, sea ice in the tropics) are listed separately, never as zeros.

**Choosing a period.** Two sliders (From / To, at least 10 years apart) set the years the trend is computed
over. The side panel recomputes at once from the series it already fetched. The map is recomputed in the
browser, in Web Workers, from a coarse annual grid (`web/public/data/<VAR>_annual.bin`, about 100 km, written by
`pipeline/export_annual_grid.py`): every cell gets the same Theil–Sen / Mann–Kendall (lag-1 Hamed–Rao) /
Sen-interval statistics on the years in the period, followed by Benjamini–Hochberg over all cells. For the full
1981–2025 period the precomputed full-resolution texture is used instead.

The statistics are implemented twice — Python (`pipeline/trendstats.py`) for the map and TypeScript
(`web/src/stats/trend.ts`) for the browser — and tested against a shared set of fixture series
(`pipeline/tests/fixtures/`) so the two agree to 1e-12.

**Country view.** With Area = Country a click picks the country under it, which is then shown alone, in its own
shape, with each ~50 km grid cell inside it coloured by its own trend and its main cities marked. The pipeline
(`pipeline/countries.py`) assigns every grid cell to the country whose Natural Earth outline contains the cell centre
and writes each country's cell series (`web/public/data/countries/<VAR>/<index>.bin`, Int16, hundredths), so nothing
is requested at run time. The country-wide headline is the cos(latitude)-weighted mean of its cells (a cell with a
missing year is left out) put through the same Theil–Sen / Mann–Kendall path as a box; a city's value is the grid cell
it sits in. Countries smaller than one grid cell get that single cell. Cells are 50 km, so borders and coasts in the
coloured piece are only as sharp as the grid. Province / state outlines (Natural Earth admin-1, simplified to 0.02°,
`pipeline/provinces.py`, `web/public/data/provinces/<index>.json`) are drawn over it, and a province's value is the
cos(latitude)-weighted mean of the grid cells whose centre lies inside it, put through the same trend code.

**Seas and oceans.** A click on open water lifts the sea or ocean there, with the land around it as a rim. The pipeline
(`pipeline/seas.py`) puts every water grid cell (country mask 255) into the Natural Earth marine area whose polygon
contains the cell centre, the smallest polygon winning where several overlap (so the Bay of Biscay is not also counted in
the North Atlantic); a named sea therefore leaves out the smaller named seas, gulfs and bays inside it. Seas of up to 4000
cells keep the ~50 km cells, the oceans use the coarse ~100 km grid (the same block mean as the trend map), and the
headline is the same cos(latitude)-weighted mean through the same trend code. For air temperature the value is the air
2 m above the water, not the water temperature.

### No data

One rule decides "no data", in the pipeline (`pipeline/products.py`) and in the browser (`web/src/noData.ts`):

- a value that is missing, equal to NASA POWER's fill value (-999) or at or below -900 is no data. Soil moisture and
  evaporation are land-only, so over water they are no data, never zero;
- snow cover and sea ice: a place whose value is 0 in every one of the 45 years has no data ("there is never any snow / sea
  ice here"), which removes sea ice over land and over warm water and snow in the tropics and deserts;
- a place with fewer than 10 valid years has no data;
- an area average (box, country, sea) leaves out cells with a missing year, says how many cells it used, and shows "no
  data" if none is left. Benjamini–Hochberg and "share of the globe that is significant" count only places with data.

Fractions (soil moisture, snow cover, sea ice) are shown as a whole percent, the trend in percentage points per decade.
Int16 files store `round((value - offset) * 100)` (ozone has offset 300 so it fits), -32768 means no data; the offset and
scale are written to `<VAR>_meta.json` / `<VAR>_annual.json`. In the coarse period-map grid a ~100 km cell is the weighted
mean of its valid members and has no data when less than half of its weight is valid.

### Limits you should know about

- Snow cover and sea ice show only places that have it at least once in 1981–2025. A coastal cell that MERRA-2 counts as
  land keeps its land-only values even if it lies inside a named sea, so a sea's soil-moisture or evaporation average (if
  any) is over those coastal cells only; the piece says how many cells have data.
- Hottest temperature of the year is the single hottest hour, so it is noisier than an average. Soil moisture and ozone
  are model-based in MERRA-2 (ozone is assimilated from satellite instruments whose mix changed over time) and trends
  in them can reflect changes in observations.

- The autocorrelation correction is partial (lag 1 only). On strongly autocorrelated synthetic noise the
  false-positive rate is still above the nominal 5%.
- MERRA-2 is a reanalysis: a weather model blended with observations, not direct measurements. Some regional
  trends, especially for precipitation and near sea ice, can reflect changes in the observing system rather
  than in the climate.
- Linear trends only. A trend is a description of the past 45 years, not a forecast.

## Repository layout

```
pipeline/   Python scripts, run once offline: fetch data, compute trend grids, export textures
web/        Vite + React + TypeScript site (react-globe.gl, uPlot)
web/public/data/   Exported textures and metadata (committed, so the site builds without Python)
```

## Running the pipeline

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/). No login or API key is needed; the data is read
anonymously from NASA POWER's public archive on AWS (about 10 MB per variable). The exported `web/public/data` is about 183 MB for the ten variables (about 17-19 MB per variable: country series, sea series, period-map grid, textures).

```bash
cd pipeline
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python -m pytest -q

for v in T2M PRECTOTCORR WS2M T2M_MAX GWETROOT EVLAND RH2M FRSNO FRSEAICE TO3; do
  .venv/bin/python fetch.py $v      # download annual means, 1981-2025, to pipeline/cache/
  .venv/bin/python compute.py $v    # trend, confidence range, p-value and FDR-adjusted p per cell
  .venv/bin/python export.py $v     # texture PNG + metadata JSON into web/public/data/
done
.venv/bin/python export_annual_grid.py   # coarse annual grids for the period map (all variables)
.venv/bin/python countries.py            # country masks, cities, per-country series (all variables)
.venv/bin/python seas.py                 # seas and oceans (all variables)
.venv/bin/python export_summary.py       # summary.bin: slope / p / BH-adjusted p of every variable in every coarse cell
```

## Running the site

```bash
cd web
npm install
npm test
npm run dev
```

`npm run build` writes the static site to `web/dist/`. Pushing to `main` deploys it to GitHub Pages through
`.github/workflows/deploy.yml`.

Adding `?debug=landmarks` to the URL shows a texture with known landmarks painted on it, plus the same
landmarks drawn by the globe from their real coordinates, to check that the map is aligned.

## Data sources and credits

- **NASA POWER** (Prediction Of Worldwide Energy Resources), NASA Langley Research Center —
  https://power.larc.nasa.gov. Map data: the POWER annual Zarr archive on AWS
  (`s3://nasa-power/merra2/temporal/power_merra2_annual_temporal_lst.zarr`). Click panel: the POWER monthly
  point API, and for the 2°/5°/10° area choice the POWER monthly regional API, called live from the browser.
- The underlying data is **MERRA-2** (Modern-Era Retrospective analysis for Research and Applications,
  Version 2), NASA Global Modeling and Assimilation Office.
- Coastlines and the green-land / blue-water base map (`pipeline/basemap.py`): Natural Earth (public domain), via the `world-atlas` package.
- Country outlines (`countries-50m`, via `world-atlas`) and the populated places used for the city markers
  (`pipeline/data/ne_50m_populated_places_simple.geojson`): Natural Earth (public domain).
- Seas and oceans (`pipeline/seas.py`): Natural Earth marine areas, `ne_50m_geography_marine_polys.geojson`
  (public domain, copied to `pipeline/data/`).
- Province / state outlines in the country view (`pipeline/provinces.py`): Natural Earth admin-1 states and provinces,
  `ne_10m_admin_1_states_provinces.geojson` (public domain), from
  https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_1_states_provinces.geojson .
  The 40 MB source file is not in this repository; the script takes its path as an argument.
- Libraries: react-globe.gl / three.js, uPlot, React, Vite, NumPy, SciPy, xarray, zarr, Matplotlib, Pillow.
- Wind-flow streaks (Wind speed view): the idea of advecting particles through a gridded wind field with fading
  trails comes from **cambecc/earth** (MIT, the source of earth.nullschool.net); **mapbox/webgl-wind** (ISC) was
  read for the idea only. The implementation is original CPU code and no third-party code was copied. The
  streaks show the 1981–2025 mean NASA POWER U2M/V2M wind, not the trend.

These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA
Earth Science/Applied Science Program. This project is not affiliated with or endorsed by NASA.

## Use of AI

This project was built with substantial AI assistance, disclosed here as the hackathon requires.

- **Claude Code** (Anthropic) planned the work, wrote the specifications for each phase, reviewed and verified
  the results, and wrote parts of the code and this README.
- Most of the code was written by AI coding agents working from those specifications: the Google Antigravity
  CLI running Claude models (pipeline and globe scaffold), and Claude subagents (TypeScript statistics, side
  panel and interface).
- Verification was automated and independent of the generated code where possible: the Python statistics are
  checked against SciPy and pymannkendall and against a separately written reference implementation; the
  TypeScript port is checked against the Python fixtures; the live site's numbers were compared with the
  precomputed grid.

No AI is used at runtime: the site contains no model, and all numbers come from the statistics described above.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
