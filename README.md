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
| Precipitation (`PRECTOTCORR`) | Average rain and snow (as water) per day | mm/day |
| Wind speed (`WS2M`) | Average wind speed 2 metres above the ground | m/s |

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

The statistics are implemented twice — Python (`pipeline/trendstats.py`) for the map and TypeScript
(`web/src/stats/trend.ts`) for the browser — and tested against a shared set of fixture series
(`pipeline/tests/fixtures/`) so the two agree to 1e-12.

### Limits you should know about

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
anonymously from NASA POWER's public archive on AWS (about 10 MB per variable).

```bash
cd pipeline
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python -m pytest -q

for v in T2M PRECTOTCORR WS2M; do
  .venv/bin/python fetch.py $v      # download annual means, 1981-2025, to pipeline/cache/
  .venv/bin/python compute.py $v    # trend, confidence range, p-value and FDR-adjusted p per cell
  .venv/bin/python export.py $v     # texture PNG + metadata JSON into web/public/data/
done
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
  point API.
- The underlying data is **MERRA-2** (Modern-Era Retrospective analysis for Research and Applications,
  Version 2), NASA Global Modeling and Assimilation Office.
- Coastlines: Natural Earth, via the `world-atlas` package.
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
