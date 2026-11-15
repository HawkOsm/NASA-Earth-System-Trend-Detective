# Text for the project form

Field names and what each asks for are taken from the official Project Submission Guide
(https://www.spaceappschallenge.org/resources/project-submission-guide/, read on 14 November 2026).
Everything must be in English. Paste, then read once: the numbers below are the ones the site shows.

---

## Project Name

Trend Detective

## High-Level Project Summary

*The form asks: what did you develop, how does it address the challenge, why is it important?*

Trend Detective is a website that turns 45 years of NASA data into answers for any place on Earth: which parts
of the Earth system are changing there, how fast, whether the change is statistically significant, and whether
the answer can be trusted.

It covers ten variables from NASA POWER / MERRA-2 for 1981–2025. A 3D globe shows where each one is changing.
A click lifts a country, a sea or a continent out of the map and shows its trend, every grid cell inside it,
its provinces and its cities. A "Detective" panel takes a place name or a plain question and ranks what is
changing there.

What sets it apart is that it does not stop at "significant". Every trend gets a grade, and for air temperature
and rainfall the site compares NASA's reanalysis with independent measurement records and says, at each place,
how many of them confirm the trend. That matters because a trend map is easy to draw and easy to believe: the
project found that most independent records confirm 90% of MERRA-2's significant land-temperature trends but
only 20% of its significant rainfall trends, and it tells the visitor so.

## Link to Project Demo

Seven slides, public, no sign-in:
https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/deck/Trend-Detective-deck.pdf

## Link to Final Project

https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/

Code: https://github.com/HawkOsm/NASA-Earth-System-Trend-Detective (public from 15 November; if it is still
private when you paste this, leave this line out).

## Detailed Project Description

*The form suggests: what does it do, how does it work, what benefits does it have, what do you hope to
achieve, what tools did you use?*

**What it does.** The visitor picks one of ten variables (air temperature, the hottest hour of the year,
precipitation, soil moisture, evaporation from land, humidity, snow cover, sea ice, wind speed, total ozone) and
sees a globe coloured by its trend since 1981. Colour appears only where the trend is statistically
significant; elsewhere a plain map shows through. From there:

- a click lifts the country, sea or ocean under it into its own view, with the trend for the whole area, each
  ~50 km grid cell inside it, its provinces or states, and its cities;
- switching to "Point" opens a panel for one grid cell, with the yearly series fetched live from NASA POWER,
  the trend line, the rate per decade, a 95% range, a p-value and a one-sentence verdict;
- two sliders choose any period of ten years or more, and the map and every number are recomputed in the browser;
- a first visit starts a one-minute guided tour that has the visitor click the real controls one at a time, so
  nobody has to guess what "Lift" or "Point" mean; it can be skipped and started again;
- the Detective panel answers "what is changing in Europe?" or "Istanbul" by ranking all ten variables for that
  place, significant changes first. Google's Gemini reads the typed question (typos, other languages, "the
  nineties", places such as "the Gobi desert"); every number is looked up from precomputed statistics, never
  generated.

**How it works.** A Python pipeline reads NASA POWER's annual archive once and computes, for each of 207,936
grid cells and each variable, the Theil–Sen slope with its confidence interval and the Mann–Kendall test with
corrections for ties and for year-to-year memory, then applies Benjamini–Hochberg false-discovery control
across the map. The same statistics are implemented a second time in TypeScript for the browser, and the two
are tested against shared cases so they agree. The site is static: there is no server.

**The evaluation layer.** Significance says a change in the numbers is unlikely to be chance; it does not say
the numbers are right. MERRA-2 is a weather model corrected with observations, and changes in the observing
system can leave jumps and drifts in it. So:

- four pattern checks look at each trend for a jump, a single year that decides the answer, a reversal between
  the two halves of the record, and dependence on the first or last five years. The result is a grade: Robust,
  Use with caution, or Doubtful. The checks were calibrated on synthetic series where the truth is known.
- for air temperature (against NASA GISTEMP and GHCN-CAMS) and rainfall (against GPCP, CMAP, GPCC and PREC/L),
  the trend at each place is compared with every independent record available for the surrounding box. It is
  labelled Confirmed when more than half of them show a significant change in the same direction, Partly
  confirmed when some but not most do, Not confirmed when none does, and Contradicted when more show the
  opposite. The site names the records on each side.
- the comparison also finds individual years where MERRA-2 departs from the first record (GISTEMP or GPCP),
  names them, and shows the trend without them.
- a satellite check compares MERRA-2 with the instruments and the model the challenge names, over their own
  years: rainfall with GPM, snow cover with MODIS, air temperature with AIRS, ozone with OMI, and evaporation and
  soil moisture with the GLDAS land model. The panel of a place says whether the two trends agree.

Over the area where MERRA-2 shows a significant trend, most of the records confirm 90% for land temperature
(8% partly, 2% not confirmed) and 20% for rainfall (43% partly, 28% confirmed by none, 9% contradicted). The
rainfall records also disagree with each other, which is why the site asks all of them instead of one. A trend
that is only partly confirmed or not confirmed stays visible but is labelled "Use with caution".

**Three findings a visitor can reproduce in one click** (the start strip on the site), each significant
(p < 0.001), graded Robust, and confirmed by most of the independent records:

| Place | Change per decade | Independent records |
|---|---|---|
| Istanbul | Air temperature +0.54 °C | 2 of 2 confirm (NASA GISTEMP +0.55 °C) |
| Shanghai | Rainfall +0.36 mm/day | 4 of 4 confirm (GPCP +0.26 mm/day) |
| The Amazon at Porto Velho | Rainfall −0.67 mm/day | 3 of 4 confirm (GPCP −0.36 mm/day) |

**Benefits and aim.** A student, journalist or local planner can ask a plain question about a real place and
get an answer with its uncertainty and its reliability stated, from NASA data, without installing anything.
The aim is a trend tool that is honest about what the data can and cannot support.

**Limits it states openly.** Only two of the ten variables have independent records so far. The independent
check covers the full 1981–2025 period, and the records are not fully independent of each other. Trends are straight-line descriptions of the past,
not forecasts. The year-to-year memory correction covers one year of lag only.

**Tools.** Python (NumPy, SciPy, xarray, zarr, Matplotlib) for the pipeline; TypeScript, React, Vite,
react-globe.gl with three.js, and uPlot for the site; Vitest and pytest for 513 browser-side and 240
pipeline-side tests; GitHub Pages for hosting; Google Gemini Flash through a small Google Cloud Run service for
reading questions in the Detective.

## Use of Super Intelligence (SI)

*The guide's term for AI tools. It asks whether and how they were used. This answer is for NASA's records and
is not shown to judges.*

Yes. The project was built with substantial help from AI coding tools: Claude Code (Anthropic) planned the
work, wrote specifications, wrote and reviewed code and documentation, and verified results; further code was
written by AI coding agents working from those specifications (Claude models, and the Google Antigravity CLI
early on). This is stated in the README's "Use of AI" section.

The direction was the team's. Osman Sahin Guler (HawkTeam) chose the challenge and wrote the brief: the data
source, the first variables, the statistical method and the requirement that Python and the browser agree. He
then steered the design step by step: wind streaks, a familiar green-and-blue base map, lifting a country out
of the map like a puzzle piece, seas and oceans, more variables, the menu and the Detective. He also raised the
question that led to the evaluation layer, namely that the tool was accepting every value from one dataset with
no measure of what good data is. The AI tools carried out and checked the work under that direction.

*(Drafted from the project's working record. Read it once and change anything that does not match how you see
your own role: this answer is yours.)*

Results were checked independently of the generated code wherever possible: the statistics against SciPy,
pymannkendall and a separately written reference; the browser code against the pipeline's test cases; the
site's numbers against values recomputed from the pipeline's data.

One part of the site uses AI at runtime: the Detective sends a typed question to Google's Gemini Flash, which
returns only its reading of the question (the place, the years, the variable). Every number the site shows is
looked up from precomputed statistics, never generated, and the answer states how Gemini read the question. The
question passes through a small server of this project on Google Cloud Run, which keeps the API key off the page.
No image or video in the
project is AI-generated: the pictures in the deck are screenshots of the site. No NASA logo or branding is used.

## NASA Data

- **NASA POWER** (Prediction Of Worldwide Energy Resources), NASA Langley Research Center,
  https://power.larc.nasa.gov: the annual archive on AWS for the map, and the monthly point and regional APIs
  for the live panel. Acknowledgement requested by the project: "These data were obtained from the NASA Langley
  Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program."
- **MERRA-2**, NASA Global Modeling and Assimilation Office: the reanalysis behind NASA POWER's variables.
- **GISTEMP v4**, NASA Goddard Institute for Space Studies, https://data.giss.nasa.gov/gistemp/: the
  independent temperature record used by the evaluation layer.
- **GPM IMERG** precipitation (NASA Global Precipitation Measurement mission), read from NASA POWER's public
  archive: the satellite check for rainfall, 2001–2025.
- **MODIS** snow cover (NASA Terra, product MOD10CM), read from NASA GIBS (https://gibs.earthdata.nasa.gov): the
  satellite check for snow cover.
- **AIRS** near-surface air temperature (NASA Aqua, AIRS3STM v7.0) and **GLDAS-2.1** evapotranspiration and
  root-zone soil moisture (NASA Global Land Data Assimilation System), read from NASA GES DISC
  (https://disc.gsfc.nasa.gov), the archive behind Giovanni, which is the first tool on this challenge's Resources
  list: the satellite check for air temperature, evaporation and soil moisture.
- **OMI** total column ozone (NASA Aura, OMTO3d v004), from NASA Goddard's TOMS/OMI archive and NASA GES DISC: the
  satellite check for ozone.
- The challenge description itself names MERRA-2 and GLDAS among the models, and MODIS, OMI, AIRS and GPM among
  the instruments, whose data a response should analyse. All six are used here.
- **"Time-Series Analysis of Remotely-Sensed SeaWiFS Chlorophyll in River-Influenced Coastal Regions"**
  (Acker and co-authors, NASA Goddard Earth Sciences Data and Information Services Center), the research
  article listed in this challenge's Resources. Its workflow is the one this project implements: an
  area-averaged time series, the seasonal cycle removed through anomalies, a fitted trend, and a significance
  test at p < 0.05. Where the article uses linear regression and an F-test, this project uses a Theil–Sen slope
  and the Mann–Kendall test, which are less sensitive to single unusual years.
- MERRA-2 is also the reanalysis served by **Giovanni**, the first tool on the challenge's Resources list; this
  project reaches the same dataset through NASA POWER.

## Space Agency Partner Data and Other References

No data from the partner space agencies is used.

- Independent rainfall records, all read from NOAA's Physical Sciences Laboratory
  (https://psl.noaa.gov/data/gridded/): GPCP v2.3 and CMAP (rain gauges and satellites), PREC/L (rain gauges;
  NOAA Climate Prediction Center) and GPCC Full Data v2025 (rain gauges; Deutscher Wetterdienst).
- GHCN-CAMS land air temperature (NOAA Climate Prediction Center, same site): the second independent
  temperature record.
- Natural Earth (public domain, https://www.naturalearthdata.com): coastlines, countries, provinces and states,
  seas, populated places. Countries and coastlines through the `world-atlas` package.
- cambecc/earth (https://github.com/cambecc/earth): the idea of showing wind as moving streaks. No code copied.
- Open-source libraries: React, Vite, TypeScript, react-globe.gl, three.js, uPlot, topojson-client, Vitest,
  NumPy, SciPy, xarray, zarr, Matplotlib, pytest.
- Statistical methods: Theil (1950) and Sen (1968); Mann (1945) and Kendall (1975); Hamed and Rao (1998);
  Benjamini and Hochberg (1995); Pettitt (1979); Holm (1979).
- AI coding tools, as described above.
