# Submission text (drafts to paste into the Space Apps form)

Everything here is a draft for the team to edit. Every number was read from the site or its data files on
14 November 2026; where it came from is noted so it can be rechecked.

## Project name

Trend Detective

## High-level summary

Trend Detective is an interactive 3D globe that answers the challenge's four questions for any place on Earth:
what is changing, where, by how much, and is the change statistically significant? It covers ten variables
from NASA POWER / MERRA-2 (temperature, precipitation, soil moisture, evaporation, humidity, snow cover, sea
ice, wind speed and ozone) for 1981–2025. Click a country, a sea or a single point and the site shows the yearly
series, the trend per decade, a 95% confidence range, a p-value and a one-sentence verdict in plain English.
The map is drawn so that places without a significant trend stay plain, which keeps a strong colour from being
mistaken for a real change. The site is a static web page with no backend and no AI at run time, so anyone
can open it and check a claim about their own town in a few seconds.

## Link to the final project

- Live site: https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/
- Code: https://github.com/HawkOsm/NASA-Earth-System-Trend-Detective (must be public before submitting)

## Link to the project demo

Not made yet. See "Demo" below. The link must open without a password, permission or sign-in.

## Detailed project description

**What it does.** The globe is coloured by how fast the chosen variable changed per decade between 1981 and
2025. A click on land lifts the country as a piece of its own, with each ~50 km grid cell coloured by its own
trend, its provinces outlined and its main cities marked; a click on water does the same for the sea or ocean.
Choosing "Point" gives a side panel for one grid cell with the monthly and yearly series, the trend line, the
rate per decade, the 95% range, the p-value and the verdict. Two sliders change the period, and the map and all
numbers are recomputed in the browser for the chosen years. The Detective panel takes a place or a whole
question ("What is changing in Europe?") and lists the variables there from the strongest significant trend to
the weakest. A start card offers three findings that open with one click.

**Three findings a visitor can reproduce** (single ~50 km grid cells, 1981–2025, all p < 0.001; point panel):

| Place | Variable | Trend per decade | 95% range |
|---|---|---|---|
| Istanbul (41.00°N, 28.75°E) | Air temperature | +0.54 °C | +0.42 to +0.65 |
| Cebu (10.50°N, 123.75°E) | Precipitation | +0.87 mm/day | +0.64 to +1.11 |
| Amazon near Porto Velho (9.00°S, 63.75°W) | Soil moisture | -3.33 percentage points | -4.27 to -2.27 |

Across Europe's land the air temperature rose by 0.44 °C per decade, and the map shows a significant rise on 97%
of it (Detective, "What is changing in Europe?"). Over the whole globe, 69% of the grid cells show a significant
air temperature trend after false-discovery control (`web/public/data/T2M_meta.json`, `frac_significant`).

**How it works.** A Python pipeline reads NASA POWER's annual archive once, offline, and computes for each of the
207,936 grid cells the Theil–Sen slope (the median of the slopes between every pair of years, so one unusual
year cannot dominate), Sen's 95% confidence interval and the Mann–Kendall test with tie correction and a lag-1
Hamed–Rao correction for year-to-year memory. Because the map tests every cell at once, it applies
Benjamini–Hochberg false-discovery control and draws cells that fail it pale. The same statistics are written a
second time in TypeScript for the browser, and the two implementations are tested against shared fixtures to
agree to 1e-12. The point panel fetches its series live from the NASA POWER API, so its numbers can be checked
against NASA's own service.

**How it addresses the challenge.** What: ten variables across temperature, water, ice and snow, and air.
Where: every grid cell, every country and province, every named sea and ocean, each continent and the world.
How much: a rate per decade with a 95% range, in the variable's own units. Significant or not: a p-value and a
three-level verdict (significant, possible trend that needs more years, no clear trend), with multiple-testing
control on the map.

**What it is honest about.** MERRA-2 is a reanalysis, a weather model blended with observations, so some
regional trends, especially in precipitation, soil moisture and ozone and near sea ice, can reflect changes in
the observing system. The autocorrelation correction covers lag 1 only. Trends are linear descriptions of the
past 45 years, not forecasts. These limits are stated on the site ("How to read this") and in the README.

**Tools.** Python (NumPy, SciPy, xarray, zarr, Matplotlib, Pillow) for the pipeline; TypeScript, React, Vite,
react-globe.gl / three.js and uPlot for the site; GitHub Pages for hosting.

## NASA data

- **NASA POWER** (Prediction Of Worldwide Energy Resources), NASA Langley Research Center,
  https://power.larc.nasa.gov. The annual Zarr archive on AWS
  (`s3://nasa-power/merra2/temporal/power_merra2_annual_temporal_lst.zarr`) for the map, and the monthly point
  and regional APIs for the point panel.
- **MERRA-2** (Modern-Era Retrospective analysis for Research and Applications, Version 2), NASA Global Modeling
  and Assimilation Office: the data behind NASA POWER's meteorological parameters.

Required acknowledgement: "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project
funded through the NASA Earth Science/Applied Science Program."

## Space agency partner data and other references

No data from other space agencies is used. Other resources:

- Natural Earth (public domain), https://www.naturalearthdata.com: coastlines, country outlines, populated
  places, marine areas, admin-1 states and provinces. Countries and coastlines come through the `world-atlas`
  npm package.
- cambecc/earth (MIT), https://github.com/cambecc/earth: the idea of drawing wind as particles with fading
  trails. mapbox/webgl-wind (ISC) was read for the idea only. No code was copied from either.
- Libraries: React, Vite, TypeScript, react-globe.gl, three.js, uPlot, topojson-client, world-atlas, Vitest,
  NumPy, SciPy, xarray, zarr, Matplotlib, Pillow.
- Methods: Sen (1968) for the slope and its interval; Mann (1945) and Kendall (1975) for the test; Hamed and
  Rao (1998) for the autocorrelation correction; Benjamini and Hochberg (1995) for false-discovery control.
- AI tools: see the next section.

## Use of AI

The form's question about AI is for NASA's records; judges see the project itself. This answer follows the
README's "Use of AI" section.

Trend Detective was built with substantial AI assistance. Claude Code (Anthropic) planned the work, wrote the
specification for each phase, reviewed and verified the results, and wrote parts of the code and the
documentation, including these drafts. Most of the code was written by AI coding agents working from those
specifications (the Google Antigravity CLI running Claude models, and Claude subagents). (Team: add one sentence
here on what you decided yourselves, such as the idea and the choice of data.) Verification was automated and kept
independent of the generated code where possible: the Python statistics are checked against SciPy and
pymannkendall and against a separately written reference implementation, the TypeScript port is checked against
the Python fixtures, and the live site's numbers were compared with the precomputed grid.

No AI runs on the site. It contains no model, the Detective panel is a lookup over precomputed trends, and every
number comes from the statistics described above. No image or video in the project is AI-generated: the pictures
in the demo are screenshots of the site.

## Demo

The form accepts either a video of 30 seconds or less or a presentation of 7 slides. Both must be in English
(a video needs English subtitles) and the link must be public. A 7-slide deck is in
`docs/demo/Trend-Detective-demo.pptx`; upload it somewhere public and paste the link. If the team prefers a
video, this is the script.

### 30-second video script

| Time | On screen | Subtitle |
|---|---|---|
| 0–4 s | The globe turning slowly, air temperature | Trend Detective: 45 years of NASA data for every place on Earth. |
| 4–10 s | Click "Istanbul is warming" on the start card; the panel opens | Istanbul: +0.54 °C per decade. Statistically significant, p < 0.001. |
| 10–16 s | Close the panel, click Brazil; the country lifts; switch the variable to soil moisture | Click a country to see it cell by cell, with its provinces and cities. |
| 16–22 s | Open the Detective, type "What is changing in Europe?" | Ask about a city, a country, a continent or a sea. No AI: the answer is looked up. |
| 22–27 s | Move the From slider to 2000; the map recomputes | Choose any period. The map and every number are recomputed in the browser. |
| 27–30 s | End card with the site address | Data: NASA POWER / MERRA-2. Not affiliated with or endorsed by NASA. |

Recording notes: 1920×1080, browser at 100% zoom, no NASA logo anywhere, no music that needs a licence.

### 7-slide outline (the deck follows it)

1. Title: Trend Detective, the challenge name, the site address.
2. The question: what is changing, where, by how much, and is it significant?
3. The globe: ten variables, 1981–2025, plain where there is no significant trend.
4. Three findings anyone can reproduce: Istanbul, Cebu, Porto Velho.
5. Countries, seas and the Detective.
6. The method and its limits.
7. Data, credits, use of AI, link.
