# Trend Detective

An entry for the NASA Space Apps Challenge 2026, challenge **"Be An Earth System Trend Detective"**.

**Live site:** https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/

Trend Detective is a 3D globe coloured by how fast an Earth science variable has changed between 1981 and
2025. Pick a variable, click any place, and a side panel shows that location's time series, the trend line,
the rate of change per decade, a p-value, a 95% confidence range and a one-sentence plain-English verdict.

It is a static website: there is no backend. The map is precomputed offline; the click panel fetches the
selected location's data live from NASA POWER and computes the same statistics in the browser.

## What you can do on the site

**Take the tour first.** A first visit starts a one-minute guided tour: a card says what to click and rings the control,
and each click on the real page moves it on (lift a country, go back, switch to Water, pick one place, open the Detective).
It can be skipped, and "Take the tour" in the top bar starts it again (`web/src/tour/`).

1. **Start with a confirmed finding.** A strip at the top offers three places to open with one click: Istanbul is
   getting warmer (+0.54 °C per decade), Shanghai is getting wetter (+0.36 mm/day per decade) and the Amazon at
   Porto Velho is getting drier (-0.67 mm/day per decade). They were picked because an independent observation
   record shows the same change, not only because MERRA-2 does (`web/src/menu/startFindings.ts`).
2. **Click the globe.** By default a click lifts the country, sea or ocean under it into a full-screen view of its
   own: the trend for the whole area, every grid cell inside it, its provinces and its cities.
3. **Use the menu** at the bottom left. Its rows choose the variable (ten, in four groups), the years (two sliders,
   any span of ten years or more), what a click does (lift the area, or a single ~50 km point, or a 2°, 5° or 10°
   box), wind streaks, and borders and labels. The Scale row shows the colour bar and how much of the map is
   significant, robust and independently confirmed.
4. **Ask the Detective.** Type a city, country, sea, continent or a whole question ("what is changing in Europe?").
   It lists what is changing there, strongest first, with a button on each line that switches the map. A typed
   question sets four things in motion, in order: it finds the place; it reads any years in the question ("from 2016 to
   2025", "since 2000", "the last 20 years") and sets the period; it turns the globe to the place; and it opens the
   country or sea view there. Google's Gemini (an AI model) reads the typed question, so it copes with typos, other languages
   ("Türkiye'de son 20 yılda sıcaklık"), phrases such as "the nineties" and places that are not in the site's lists ("the
   Gobi desert", "the Alps"). Gemini only says what is asked; every number is looked up from the precomputed trends.
5. **Read the grade.** Every verdict comes with a grade (Robust, Use with caution, Doubtful) and, for air temperature
   and rainfall, a line saying whether an independent record confirms the trend. See "Evaluation layer".

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

The menu groups them as Temperature, Water, Ice & snow and Air (`web/src/data/demos.ts`, `pipeline/core/config.py`).

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

**What is changing here? (ranking).** `pipeline/maps/export_summary.py` writes `web/public/data/summary.bin` (+ `summary.json`
with the layout): for every cell of the coarse 100 km annual grid and every variable, the Theil–Sen slope per decade, the
Mann–Kendall p-value and the Benjamini–Hochberg adjusted p-value for 1981–2025 (BH across the cells that have data for
that variable; only those cells are stored). `web/src/detective/whatsChanging.ts` ranks all variables at a place: significant
(p < 0.05) first, then possible (0.05–0.10), then no clear trend (the verdict rules above); inside each group by
strength = |slope per decade| divided by that variable's own spread (the 98th percentile of |slope| over its cells), so
variables with different units can be compared; ties by the order of the variables on the site. The numbers are for the
roughly 100 km box around the place, so they can differ slightly from the 50 km cell a click shows. Variables with no
value there (land-only over the sea, sea ice in the tropics) are listed separately, never as zeros.

**Choosing a period.** Two sliders (From / To, at least 10 years apart) set the years the trend is computed
over. The side panel recomputes at once from the series it already fetched. The map is recomputed in the
browser, in Web Workers, from a coarse annual grid (`web/public/data/<VAR>_annual.bin`, about 100 km, written by
`pipeline/maps/export_annual_grid.py`): every cell gets the same Theil–Sen / Mann–Kendall (lag-1 Hamed–Rao) /
Sen-interval statistics on the years in the period, followed by Benjamini–Hochberg over all cells. For the full
1981–2025 period the precomputed full-resolution texture is used instead.

**Short periods.** Over ten years no trend passes the map-wide test for any of the ten variables, and over fifteen years
almost none does for seven of them, so a map that only colours what passes would be empty. When less than 3% of a period map
passes (`SPARSE_SHARE` in `web/src/map/rangeMap.ts`), the map switches to the rule of the lifted country view: every change is
drawn, strong where a place is significant on its own (p < 0.05, no map-wide correction) and faded where it is not; about 1 place
in 20 looks significant by chance alone. The Scale row of the menu then reads "Every change is drawn..." instead of "Plain map =
no significant trend". This keeps the globe and the country view in step for the same period. The same row says when the colour
scale differs from the whole record's and gives both as a rate and as the total change over the years: the scale is a rate per
decade, a rate measured over fewer years swings more, so it is wider for a short period (soil moisture: ±20 per decade over
2016-2025 against ±4.5 over 1981-2025, about ±18 and ±20 in total).

The statistics are implemented twice — Python (`pipeline/core/trendstats.py`) for the map and TypeScript
(`web/src/stats/trend.ts`) for the browser — and tested against a shared set of fixture series
(`pipeline/tests/fixtures/`) so the two agree to 1e-12.

**Country view.** With Area = Country a click picks the country under it, which is then shown alone, in its own
shape, with each ~50 km grid cell inside it coloured by its own trend and its main cities marked. The pipeline
(`pipeline/areas/countries.py`) assigns every grid cell to the country whose Natural Earth outline contains the cell centre
and writes each country's cell series (`web/public/data/countries/<VAR>/<index>.bin`, Int16, hundredths), so nothing
is requested at run time. The country-wide headline is the cos(latitude)-weighted mean of its cells (a cell with a
missing year is left out) put through the same Theil–Sen / Mann–Kendall path as a box; a city's value is the grid cell
it sits in. Countries smaller than one grid cell get that single cell. Cells are 50 km, so borders and coasts in the
coloured piece are only as sharp as the grid. Province / state outlines (Natural Earth admin-1, simplified to 0.02°,
`pipeline/areas/provinces.py`, `web/public/data/provinces/<index>.json`) are drawn over it, and a province's value is the
cos(latitude)-weighted mean of the grid cells whose centre lies inside it, put through the same trend code.

**Seas and oceans.** A click on open water lifts the sea or ocean there, with the land around it as a rim. The pipeline
(`pipeline/areas/seas.py`) puts every water grid cell (country mask 255) into the Natural Earth marine area whose polygon
contains the cell centre, the smallest polygon winning where several overlap (so the Bay of Biscay is not also counted in
the North Atlantic); a named sea therefore leaves out the smaller named seas, gulfs and bays inside it. Seas of up to 4000
cells keep the ~50 km cells, the oceans use the coarse ~100 km grid (the same block mean as the trend map), and the
headline is the same cos(latitude)-weighted mean through the same trend code. For air temperature the value is the air
2 m above the water, not the water temperature.

### No data

One rule decides "no data", in the pipeline (`pipeline/core/products.py`) and in the browser (`web/src/data/noData.ts`):

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

## Evaluation layer

A trend can be statistically significant and still be a flaw in the data (a jump when a satellite instrument changed, one
bad year). Next to every significant or possible trend the site therefore shows a grade, **Robust**, **Use with caution**
or **Doubtful**, with the reason in plain words (click panel, country / sea view, Detective), a one-line caveat for each
variable (what is measured and what is modelled) and, in the Menu, the share of each grade over the area where the map
shows a trend. The checks have fixed definitions (`pipeline/evaluation/quality.py`, mirrored in `web/src/evaluation/quality.ts` and tied by
`pipeline/tests/fixtures/quality_cases.json`); with fewer than 20 valid years in the selected period nothing is checked.

- **Jump** (Pettitt change-point test, p < 0.05, plus: the slope inside the two parts is under half the overall slope, and a
  two-level step fits better than the line, residuals ratio < 0.85; both parts need at least 5 years).
- **One unusual year**: the largest residual of the Sen line (robust z > 3.5, via the median absolute deviation) is left out
  and the verdict changes (significant / possible / none) or the direction flips.
- **Reversal**: the first and the second half each have p < 0.10 and opposite directions.
- **End sensitivity**: the direction flips when the first five or the last five years are dropped.
- **Many tests** (Detective only): a line that is significant on its own but not after a Holm adjustment over the variables
  with data at that place is at best "use with caution".

Doubtful = one unusual year, or two or more flags; use with caution = exactly one of jump / reversal / end sensitivity;
robust = none. The checks only catch patterns that are known signs of trouble; they cannot prove the data is right, and a
robust trend can still be wrong.

**Calibration** (`pipeline/evaluation/calibrate_quality.py`, seed fixed, about 5 s; n = 45, 2000 series per row; shares are of the
series whose verdict is significant; signal and the +8 / -8 outliers are in units of the innovation standard deviation):

```
n = 45, 2000 series per row, seed 20260101. Shares are percent of the SIGNIFICANT series (p < 0.05) of the row.
scenario            phi signal  signif% n_sig |   STEP  ONE_YR  REVERS    END |  robust caution doubtful
clean linear        0.0      2     95.8  1916 |    0.8     0.3     0.0    0.0 |    98.9     0.8      0.3
clean linear        0.0      3    100.0  1999 |    0.7     0.0     0.0    0.0 |    99.3     0.7      0.0
clean linear        0.0      5    100.0  2000 |    0.1     0.0     0.0    0.0 |   100.0     0.1      0.0
clean linear        0.4      2     78.4  1568 |    5.9     0.1     1.1    0.0 |    93.1     6.6      0.3
clean linear        0.4      3     96.8  1936 |    6.8     0.0     0.6    0.0 |    92.8     7.1      0.1
clean linear        0.4      5    100.0  2000 |    2.3     0.0     0.2    0.0 |    97.7     2.1      0.2
pure step           0.0      2     96.2  1925 |   38.0     0.1     3.0    0.0 |    61.2    36.5      2.3
pure step           0.0      3     97.6  1952 |   80.7     0.0     2.9    0.0 |    19.3    77.8      2.9
pure step           0.0      5     97.3  1946 |   98.3     0.0     2.7    0.0 |     1.7    95.6      2.7
pure step           0.4      2     80.8  1616 |   34.0     0.1     4.6    0.0 |    64.1    33.1      2.8
pure step           0.4      3     90.7  1814 |   68.6     0.1     5.2    0.0 |    30.7    64.8      4.5
pure step           0.4      5     93.3  1867 |   93.4     0.0     5.8    0.0 |     6.4    87.9      5.6
outlier +8, last5   0.0      -      6.0   120 |    0.0    48.3     0.0    0.0 |    51.7     0.0     48.3
outlier +8, last5   0.4      -     13.8   275 |    0.7    32.7     0.7    0.0 |    66.2     1.1     32.7
line 5 + outlier    0.0      5    100.0  2000 |    0.1     0.0     0.0    0.0 |    99.9     0.1      0.0
line 5 + outlier    0.4      5    100.0  2000 |    1.6     0.0     0.1    0.0 |    98.4     1.5      0.1
```

A clean linear trend is graded robust 93-100% of the time (jump false-alarm 0.1-7%, higher with autocorrelated noise), a pure
step is flagged as a jump 34-38% of the time at a size of 2 noise units, 69-81% at 3 and 93-98% at 5, and a single +8 outlier
on a series with no trend produces a "significant" trend in 6-14% of the series, 33-48% of which are marked doubtful.

**On the real data** (`pipeline/evaluation/export_quality.py`; area-weighted shares of the area where the map shows a significant trend,
1981-2025). Because a trend the map calls significant has already passed a strict false-discovery test, "one unusual year" and
"end sensitivity" almost never apply there; the jump check is what flags real data.

```
variable     sig cells  robust% caution% doubtful% |  STEP% ONE_YR% REVERS%  END% | stepYear top 5 (cells flagged STEP; year:count)
T2M             143018     94.2      5.2       0.5 |    5.0     0.1     1.1   0.0 | 2006:1375, 2005:1140, 1999:949, 2014:924, 2004:785   [meta mode 2006]
PRECTOTCORR      41431     93.1      6.3       0.5 |    5.5     0.0     1.9   0.0 | 2004:278, 1998:201, 2007:201, 1999:151, 2005:132   [meta mode 2004]
WS2M             30947     91.2      8.1       0.6 |    7.3     0.0     2.1   0.0 | 2007:439, 2005:425, 1998:309, 1996:259, 2009:139   [meta mode 2007]
T2M_MAX          75673     98.0      1.9       0.1 |    1.8     0.0     0.3   0.0 | 2013:214, 1998:198, 1995:118, 1999:105, 2003:88   [meta mode 2013]
GWETROOT          9996     84.2     14.5       1.3 |   14.7     0.0     2.3   0.0 | 1998:265, 1999:173, 2001:122, 2013:86, 1994:74   [meta mode 1998]
EVLAND           12595     85.2     12.9       1.9 |   12.7     0.0     3.9   0.0 | 2005:266, 1998:141, 1999:137, 2004:114, 2007:101   [meta mode 2005]
RH2M             67814     82.8     14.2       3.0 |   13.1     0.0     7.0   0.0 | 2005:1705, 2006:1532, 2008:760, 2007:735, 1999:632   [meta mode 2005]
FRSNO             3827     95.7      4.3       0.0 |    4.0     0.0     0.3   0.0 | 2011:27, 2003:18, 2009:16, 2005:13, 2002:9   [meta mode 2011]
FRSEAICE         16708     69.1     30.5       0.5 |   30.6     0.0     0.8   0.0 | 2005:3445, 2006:463, 2004:279, 2007:273, 2003:134   [meta mode 2005]
TO3              20763     98.8      1.2       0.0 |    1.0     0.0     0.2   0.0 | 1989:222, 1992:32   [meta mode None]
```

### Independent-record check

Everything above looks at the pattern of one series. The independent-record check is the only check on the site that tests
MERRA-2 against something else: MERRA-2, averaged over the boxes of an independent observation record, is compared with that
record (`pipeline/evaluation/reference.py`, results in `web/public/data/reference/*.json`, logic in `web/src/evaluation/reference.ts`). Air temperature
(T2M) is compared with **NASA GISTEMP** v4 (thermometer and ship records, 2 degree boxes, about 220 km) and **GHCN-CAMS** (weather
stations, land only, 0.5 degree values averaged to the same 2 degree boxes). Rainfall (PRECTOTCORR) is compared with four records on
2.5 degree boxes (about 280 km): **GPCP** v2.3 and **CMAP** (rain gauges and satellites, land and ocean), **GPCC** v2025 and
**PREC/L** (rain gauges, land only). The first record of each variable (GISTEMP, GPCP) is the one the site used on its own before;
its numbers are unchanged. Other variables have no reference yet.

- **Eligible box**: the box is used (at least 40 valid years in GISTEMP / GPCP and in MERRA-2) and, for T2M, is land (over the sea
  GISTEMP is water temperature, not air temperature); for rainfall its centre is at a latitude below 60 degrees (GPCP is weak near
  the poles). A record is **available** at an eligible box when it has at least 40 valid years there.
- **Class** of the site's trend at a place (the box containing it, full period 1981-2025 only). With sign s of the site's trend,
  n = records available, k = records whose own trend has p < 0.05 and sign s, c = records with p < 0.05 and the opposite sign:
  *contradicted* if c > k; *confirmed* if more than half of the records confirm (2k > n) and k > c ("Confirmed by k of n independent records"); *partly* if
  1 <= k but neither of those ("Confirmed by k of n records only"); *not confirmed* if k = c = 0. Where the site shows no
  trend the records are shown as information only; where no record is available the site says why.
- **Effect on the grade**: not confirmed and partly confirmed cap the grade at "use with caution", contradicted makes it "doubtful"
  (the worse of this and the pattern grade). The Menu shows the shares below for the variable on the map.
- **Measured** (area-weighted over eligible boxes where MERRA-2's own box trend is significant; `consensus` and `byCount` in each
  JSON; the first record alone is still in `summary`):

```
T2M          2 records, 3751 boxes:   confirmed 89.9%  partly 7.7%  not confirmed 1.9%  contradicted 0.5%   (GISTEMP alone: 97.1 / 2.3 / 0.6)
PRECTOTCORR  4 records, 2547 boxes:   confirmed 20.1%  partly 43.5%  not confirmed 27.7%  contradicted 8.8%  (GPCP alone: 26.0 / 67.8 / 6.2)
```

  The four rainfall records disagree with each other. Where all four exist (905 boxes, land and coast), MERRA-2's significant trends are
  confirmed by all four on 11.9% of the area, by at least two on 42.4%, and by none on 34.4%. Around Cebu MERRA-2 shows +0.89 mm/day per decade;
  GPCP +0.09 (not significant), CMAP +0.56, GPCC +0.44, PREC/L +0.48 (all significant): GPCP alone said "not confirmed", three of
  four confirm. A rainfall trend that none of the four records confirms is therefore the strong signal that MERRA-2 may be wrong;
  one that some confirm and others do not is less clear-cut. Read MERRA-2 rainfall trends with that in mind. A plain-language guide to the whole evaluation layer is in `docs/EVALUATION.md`.
- **"Confirmed only" map** (Menu, row Show; `pipeline/evaluation/export_confirmed.py`, `web/src/map/confirmedMap.ts`): redraws the temperature or
  rainfall map with only the trends the independent records confirm, full period only. A MERRA-2 cell counts as confirmed if its
  trend is map-significant, the reference box around it is eligible and the class at that box, for the cell's own sign, is
  "confirmed" (see above); "partly" cells are counted but not drawn. Significant cells in ineligible boxes (sea for temperature,
  poleward of 60° for rainfall) are "cannot check" and are hidden too. Globe shares (cos-latitude weighted): temperature 18.4%
  confirmed / 0.1% partly / 0.4% not confirmed / 50.0% cannot check; rainfall 10.2% / 2.0% / 5.9% / 3.1% (GPCP alone: 5% / - / 13% / 3%).
  Run `.venv/bin/python -m evaluation.export_confirmed` after `export.py` and `reference.py`; it writes `<VAR>_confirmed.png` and
  `reference/confirmed_<VAR>.json`.
- **Bad years**: in each box the difference D between the two annual series (temperature: both as anomalies; rainfall: MERRA-2 minus
  c times GPCP, c = median ratio) loses its own Sen line (the slow drift between the records is the trend disagreement itself and
  would otherwise hide single years), and a year is flagged when its robust z (via the MAD) exceeds 5 in absolute value and the
  deviation exceeds 0.5 degC (1.0 mm/day for rainfall). Planted-fault benchmark on real rainfall boxes (one year multiplied by 1+f,
  excess of at least 1 mm/day): detected 21% / 63% / 90% for f = 30% / 50% / 100%; 0.12% of real box-years are flagged with nothing
  planted. The click panel lists the flagged years of the box (for example the box around Manila, 2020: MERRA-2 11.66 vs GPCP 7.08
  mm/day) and the site's trend with those years left out.
- **Slow drift, not single bad years**: leaving the flagged years out of MERRA-2 barely changes how it compares with the record
  (RMSE of the box slopes, all used boxes: land temperature 0.1794 -> 0.1795 C/decade, sea 0.1450 -> 0.1450; rain over land 0.1995
  -> 0.1994 mm/day/decade, sea 0.1697 -> 0.1701; in boxes that have a flagged year 0.2813 -> 0.2804 over land and 0.3117 -> 0.3155 over
  the sea). The disagreement for rainfall is therefore a slow drift of one record against the other, not a handful of bad years.
- Limits: GISTEMP is a smoothed anomaly product; GPCP and CMAP are satellite-gauge estimates, not the truth; the records are not
  fully independent of each other (GPCC gauges feed GPCP, for instance). "Not confirmed" means the independent records do not show
  the trend, not that MERRA-2 is wrong. "Bad years" and the "size differs" note use the first record only (GISTEMP / GPCP).
- **Areas** (`pipeline/evaluation/reference_areas.py`, `web/public/data/reference/areas_{T2M,PRECTOTCORR}.json`): the same check for a whole
  country, sea, continent or the World. The record and MERRA-2 are both averaged over the boxes inside the area (weight = cos(latitude)
  of the area's cells in each box, eligible boxes with all 45 years only), and the area is checked when those boxes carry at least half
  of its weight (`coverage`); air temperature over a sea is never checked, and an area the record covers less than half of (small
  islands, Russia for rainfall) says so. Same classes, wording ("averaged over the same area") and grade cap as for a point.

### Satellite check

The challenge names instruments whose data a trend tool should use: MODIS, OMI, AIRS, GPM, and the GLDAS model. Their records
start around 2000, so they cannot join the 1981-2025 check above. Instead each one is compared with MERRA-2 over the years they
share (`pipeline/evaluation/instrument_check.py`, results in `web/public/data/instruments/*.json`, logic in
`web/src/evaluation/instrument.ts`): both are averaged on 2 degree boxes (about 220 km), the Theil-Sen slope and Mann-Kendall
p-value of both are computed over the shared years, and the place's panel says in one sentence whether they agree. The menu
gives the summary. This check is information next to the grade; it never changes a grade, because the grade is about 1981-2025.

Over the boxes where both have a full record, and of the area where MERRA-2's trend over the shared years is significant:

| Variable | Instrument | Years | Boxes | MERRA-2 significant | Confirmed | Not confirmed | Contradicted |
|---|---|---|---|---|---|---|---|
| Rainfall | GPM | 2001-2025 | 10,800 | 27% of the area | 22% | 73% | 5% |
| Snow cover | MODIS | 20 years in 2004-2025 | 1,270 | 12% | 28% | 72% | 0% |
| Air temperature | AIRS | 2003-2025 | 14,152 | 40% | 54% | 44% | 2% |
| Evaporation from land | GLDAS (a model) | 2001-2025 | 3,749 | 38% | 45% | 48% | 7% |
| Soil moisture | GLDAS (a model) | 2001-2025 | 3,749 | 37% | 31% | 55% | 14% |
| Ozone | OMI | 2005-2025 | 10,778 | 30% | 72% | 28% | 0% |

The rainfall result repeats what the long records say: most of MERRA-2's significant rainfall trends are not seen by an
independent source. Air temperature does best, as in the long check, though over 23 years fewer trends are confirmed than over 45.

- **GPM** (rainfall): IMERG monthly precipitation as NASA POWER distributes it (its public archive on AWS,
  `s3://nasa-power/imerg/spatial/power_imerg_monthly_spatial_utc.zarr`), 2001-2025, boxes between 60 S and 60 N. POWER does
  not state which IMERG version and run it serves.
- **MODIS** (snow cover): Terra MODIS monthly snow cover from NASA GIBS (layer
  `MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct`; the map tiles are decoded exactly through the layer's colour table, one
  colour per percent). A year counts only when all twelve months were observed, which leaves 20 years between 2004 and 2025 and
  drops the places with a polar night or persistent winter cloud: the check covers mid-latitude and mountain snow, not the Arctic.
- **AIRS** (air temperature): the level-3 monthly retrieval AIRS3STM v7.0, near-surface air temperature, mean of the day and night
  passes, 2003-2025, from NASA GES DISC through its OPeNDAP server (`pipeline/instruments/earthdata.py`). This needs a NASA
  Earthdata account; the script requests one variable per month and never downloads the HDF files.
- **GLDAS** (evaporation, root-zone soil moisture): GLDAS-2.1 Noah monthly, 1 degree, land between 60 S and 90 N, 2001-2025, from
  the same server. GLDAS is a land model driven by observations, not an instrument, so the panel calls its line a "model check".
  Its soil moisture is in kg per square metre and MERRA-2's is in percent of saturation: the two trends are compared by direction
  and significance, and each is printed in its own units.
- **OMI** (ozone): total column ozone, product OMTO3d v004, daily 1 degree, 2005-2025 (`pipeline/instruments/omi_o3.py`). The odd
  days of each month are used; days already downloaded from NASA Goddard's anonymous text archive are read from disk and the rest
  come from NASA GES DISC (two days read from both sources differ by at most 0.5 Dobson units, the rounding of the text files).
  OMI needs sunlight, so there is no yearly value in the polar night. **MERRA-2 takes in OMI's ozone itself from late 2004**, so
  the high agreement is expected and is not an independent confirmation; the panel says so. MERRA-2 also takes in AIRS
  measurements of the atmosphere, so the AIRS line is not fully independent either.
- Limits: MODIS sees snow under clear sky only and MERRA-2's snow cover is a model's fraction of the land, so their levels differ
  (the check compares trends, not levels). GPM IMERG is calibrated with rain gauges over land, as GPCC-based records are.

## Repository layout

```
pipeline/   Python scripts, run once offline: fetch data, compute trend grids, export textures
web/        Vite + React + TypeScript site (react-globe.gl, uPlot)
web/public/data/   Exported textures and metadata (committed, so the site builds without Python)
```

The pipeline's code is sorted into folders by task and run from `pipeline/` as `python -m <folder>.<script>`:

```
core/         the list of variables and all paths (config), the statistics (trendstats), the "no data" rule (products)
download/     fetch NASA POWER's annual archive; readers for the independent records (sources)
maps/         trend per grid cell, map textures, the grid for the period map, wind, the base map, the summary file
areas/        countries, provinces, seas and oceans, continents
evaluation/   pattern checks and grades, the comparison with independent records, the "Confirmed only" map,
              the satellite check
instruments/  fetch the satellite and model records (GPM, MODIS, AIRS, GLDAS, OMI)
experiments/  the measured comparisons of significance tests and trend methods (not used by the site)
tests/        pytest, and the fixture files that tie Python and TypeScript together
```

The site's code (`web/src/`) is sorted into folders by task; each test file sits next to the code it tests:

```
App.tsx, main.tsx   the page: wires the parts below together
map/         the globe and the flat fallback, their lines and labels, the map for a chosen period, the
             "Confirmed only" map, the notice for an empty map, the wind streaks (map/wind/)
menu/        the menu, the period sliders, the start strip, "How to read this"
point/       one place: the panel, its chart, the live NASA POWER request, the close-up map, the verdict sentence
areas/       a lifted country, sea or ocean: its map, provinces, cities; continents for the Detective
detective/   the Detective panel: understanding the question, ranking the variables at a place
evaluation/  pattern checks and grades, the comparison with independent records
stats/       Theil-Sen and Mann-Kendall (the same statistics as pipeline/core/trendstats.py)
data/        the list of variables, loading of data files, the "no data" rule, number formats
tour/        the guided tour of a first visit
```

## Running the pipeline

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/). No login or API key is needed for the site's data (only the AIRS, GLDAS and part of the OMI records of the satellite check need a NASA Earthdata account); the data is read
anonymously from NASA POWER's public archive on AWS (about 10 MB per variable). The exported `web/public/data` is about 168 MB for the ten variables (about 17-19 MB per variable: country series, sea series, period-map grid, textures).

```bash
cd pipeline
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python -m pytest -q

for v in T2M PRECTOTCORR WS2M T2M_MAX GWETROOT EVLAND RH2M FRSNO FRSEAICE TO3; do
  .venv/bin/python -m download.fetch $v      # download annual means, 1981-2025, to pipeline/cache/
  .venv/bin/python -m maps.compute $v    # trend, confidence range, p-value and FDR-adjusted p per cell
  .venv/bin/python -m maps.export $v     # texture PNG + metadata JSON into web/public/data/
done
.venv/bin/python -m maps.export_annual_grid   # coarse annual grids for the period map (all variables)
.venv/bin/python -m areas.countries            # country masks, cities, per-country series (all variables)
.venv/bin/python -m areas.seas                 # seas and oceans (all variables)
.venv/bin/python -m maps.export_summary       # summary.bin: slope / p / BH-adjusted p of every variable in every coarse cell
.venv/bin/python -m areas.regions              # continents and the world, for the Detective
.venv/bin/python -m evaluation.export_quality       # pattern checks and grades (after export.py: it adds to the meta files)
.venv/bin/python -m evaluation.reference            # comparison with GISTEMP and GPCP (needs the GISTEMP file, see docs/EVALUATION.md)
.venv/bin/python -m evaluation.reference rewrite    # rewrite reference/*.json from the cache, adding the other records (GHCN-CAMS, CMAP, GPCC, PREC/L)
.venv/bin/python instruments/gpm.py            # GPM IMERG rainfall from NASA POWER's archive (about 1.5 GB, cached)
.venv/bin/python instruments/modis_snow.py     # MODIS snow cover from NASA GIBS (about 60 MB, cached)
.venv/bin/python instruments/earthdata.py airs_t     # AIRS air temperature (needs an Earthdata token, see the script)
.venv/bin/python instruments/earthdata.py gldas_et   # GLDAS evaporation
.venv/bin/python instruments/earthdata.py gldas_sm   # GLDAS root-zone soil moisture
.venv/bin/python instruments/omi_o3.py               # OMI ozone (Earthdata token for the days not on disk)
.venv/bin/python -m evaluation.instrument_check     # satellite check: MERRA-2 against GPM and MODIS over their own years
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
- Coastlines and the green-land / blue-water base map (`pipeline/maps/basemap.py`): Natural Earth (public domain), via the `world-atlas` package.
- Country outlines (`countries-50m`, via `world-atlas`) and the populated places used for the city markers
  (`pipeline/data/ne_50m_populated_places_simple.geojson`): Natural Earth (public domain).
- Seas and oceans (`pipeline/areas/seas.py`): Natural Earth marine areas, `ne_50m_geography_marine_polys.geojson`
  (public domain, copied to `pipeline/data/`).
- Province / state outlines in the country view (`pipeline/areas/provinces.py`): Natural Earth admin-1 states and provinces,
  `ne_10m_admin_1_states_provinces.geojson` (public domain), from
  https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_1_states_provinces.geojson .
  The 40 MB source file is not in this repository; the script takes its path as an argument.
- Independent-record check (`pipeline/evaluation/reference.py`): **NASA GISTEMP v4** (GISS Surface Temperature Analysis, NASA Goddard Institute for Space
  Studies, https://data.giss.nasa.gov/gistemp/) and **GPCP v2.3** monthly precipitation (Global Precipitation Climatology Project,
  served by NOAA Physical Sciences Laboratory, https://psl.noaa.gov/data/gridded/data.gpcp.html). Only per-box trend numbers
  derived from them are in `web/public/data/reference/`.
  Further records, via NOAA PSL (`pipeline/download/sources.py`, `pipeline/evaluation/reference_multi.py`): **GHCN-CAMS** land 2 m air temperature and
  **CMAP** and **PREC/L** precipitation (NOAA Climate Prediction Center, https://psl.noaa.gov/data/gridded/), and **GPCC** Full Data
  v2025 gauge precipitation (Deutscher Wetterdienst, Global Precipitation Climatology Centre, https://psl.noaa.gov/data/gridded/data.gpcc.html).
- Satellite check (`pipeline/evaluation/instrument_check.py`, `pipeline/instruments/`): **GPM IMERG** precipitation (NASA Global
  Precipitation Measurement mission), read from NASA POWER's public archive on AWS; **MODIS** snow cover (NASA Terra, product
  MOD10CM), read from NASA GIBS (Global Imagery Browse Services, https://gibs.earthdata.nasa.gov); **AIRS** near-surface air
  temperature (NASA Aqua, AIRS3STM v7.0) and **GLDAS-2.1** Noah evapotranspiration and root-zone soil moisture (NASA Global Land
  Data Assimilation System, GLDAS_NOAH10_M), both from NASA GES DISC (https://disc.gsfc.nasa.gov); **OMI** total column ozone
  (NASA Aura, OMTO3d v004), from NASA Goddard's TOMS/OMI archive and NASA GES DISC.
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

**AI on the site.** One part of the site uses an AI model at runtime: the Detective sends a typed question to Google's
**Gemini** (the Flash-Lite model, which answers in about a second, with Flash as the backup), which returns its reading of the
question as a small structured object: the place (with its position), the
years and the variable. Nothing else comes from the model. Every number shown is looked up from the precomputed statistics
described above, and the answer says how Gemini read the question ("Gemini read this as: Gobi Desert, 1990–1999, about
rainfall"). If the model is slow, refuses or is switched off (`?ai=0`), the Detective falls back to its own word matching.

The page cannot hold an API key, so the question goes through a small server of this project on Google Cloud Run
(`proxy/server.js`, no dependencies): it holds the key in Secret Manager, answers only this site's address, cuts a question
at 300 characters, allows 12 questions a minute per address and 1,500 a day, and returns only the checked fields. The
question text is sent to Google for this; the Detective says so under its text box. Deploying it:
`gcloud run deploy trend-detective-ai --source proxy --region europe-west1 --allow-unauthenticated
--set-secrets GEMINI_API_KEY=gemini-api-key:latest --max-instances 2`.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
