# Evaluation layer: a guide

Branch `evaluation-layer`, pull request #1. Owner: HawkOsm.

This guide is written so that someone new to the project can understand what the evaluation layer does, run
it, and decide what to change. Read it top to bottom once; it takes about fifteen minutes.

## 1. The problem in one paragraph

The site shows trends from one dataset, MERRA-2. MERRA-2 is not a set of measurements: it is a weather model
that is constantly corrected with measurements from satellites, weather stations and ships. When the
instruments change, or when the model is on its own, the numbers can drift or jump for reasons that have
nothing to do with the climate. Our statistics ("significant, p < 0.05") only say that a change in the
numbers is unlikely to be random noise. They cannot say whether the numbers are right. The evaluation layer
adds that second question: **can this trend be trusted?**

## 2. Two kinds of check

### A. Pattern checks (all ten variables)

These look only at the shape of the 45 yearly values at one place. They need no other data.

| Check | Plain meaning | Why it matters |
|---|---|---|
| Jump | Most of the change happened in one step, with little trend before or after | A satellite or data-source change often shows up as a step |
| One unusual year | The verdict changes if a single year is left out | One bad value should not decide the answer |
| Reversal | The first and second half of the record point in opposite directions | "Rising" over 45 years can hide "rising then falling" |
| End sensitivity | The direction flips without the first or last five years | The answer depends on where the record happens to start or stop |
| Many tests (Detective only) | Significant alone, but not after allowing for ten variables being tested | Test ten things and one will often look significant by luck |

Result: a grade. **Robust** (no flag), **Use with caution** (one flag), **Doubtful** (it depends on one year,
or two or more flags).

Code: `pipeline/evaluation/quality.py` (Python) and `web/src/evaluation/quality.ts` (browser). They must give identical answers;
`pipeline/tests/fixtures/quality_cases.json` holds 64 cases both are tested against.

### B. The independent check (air temperature and rainfall only)

This is the only check that tests MERRA-2 against something else. We compare with several records that are
built from measurements, not from MERRA-2:

| Variable | Independent records | Made from | Box size |
|---|---|---|---|
| Air temperature | NASA GISTEMP v4 | Thermometers on land, ships and buoys at sea | 2° (about 220 km) |
| | GHCN-CAMS (NOAA CPC) | Weather stations, land only | 0.5°, averaged to the 2° boxes |
| Rainfall | GPCP v2.3 | Rain gauges and satellites | 2.5° (about 280 km) |
| | CMAP (NOAA CPC) | Rain gauges and satellites | 2.5° |
| | GPCC v2025 (DWD) | Rain gauges, land only | 2.5° |
| | PREC/L (NOAA CPC) | Rain gauges, land only | 2.5° |

The first record of each variable (GISTEMP, GPCP) is the one the site used on its own at first; its numbers are unchanged and it
alone supplies the bad years and the "size differs" note. For each box of each record we average MERRA-2 over the same
area and compute the trend of both with the same method. A record is *available* in a box when it has at least 40 valid
years there. Let n be the number of available records, k the number whose own trend is significant in the same direction as
the site's trend, and c the number significant in the opposite direction. Then, for a trend the site calls significant or possible:

- **Confirmed** (k more than half of n, and more than c): "Confirmed by k of n independent records". No cap on the grade.
- **Partly confirmed** (k at least 1, but fewer than half of n): "Confirmed by k of n records only". Grade is at best "Use with caution".
- **Not confirmed** (k = 0 and c = 0): no record shows a significant change. Grade is at best "Use with caution".
- **Contradicted** (c more than k): "Doubtful".

With a single available record this is the old rule, and the old sentences are used.

The rainfall records disagree with each other (see the example below). So a rainfall trend that none of the four records
confirms is the strong signal; one that some records confirm and others do not is less clear-cut.

Where it is not used, and why: for temperature over the sea (GISTEMP measures the water there, not the air)
and for rainfall poleward of 60° (GPCP is weak near the poles).

Code: `pipeline/evaluation/reference.py` and `pipeline/evaluation/reference_multi.py` write `web/public/data/reference/T2M.json` and
`PRECTOTCORR.json` (the `records` list with each record's trend per box, and the `consensus` and `byCount` summaries);
`web/src/evaluation/reference.ts` reads them in the browser.

### C. The satellite check

The challenge names instruments a trend tool should use: MODIS, OMI, AIRS, GPM, and the GLDAS model. Their records
start around 2000, so they cannot take part in the 1981-2025 check. Each one that could be read without a sign-in
is compared with MERRA-2 over the years they share, on 2 degree boxes (about 220 km):

| Variable | Instrument | Read from | Years | What the panel says |
|---|---|---|---|---|
| Rainfall | GPM IMERG | NASA POWER's public archive | 2001-2025 | GPM's trend and MERRA-2's over the same years, and whether they agree |
| Snow cover | MODIS (Terra) | NASA GIBS | 20 full years in 2004-2025 | the same, where MODIS saw every month of the year |
| Air temperature | AIRS (Aqua) | NASA GES DISC | 2003-2025 | the same |
| Evaporation, soil moisture | GLDAS-2.1 (a land model, not an instrument) | NASA GES DISC | 2001-2025 | the same, as a "model check"; soil moisture by direction only (different units) |
| Ozone | OMI (Aura) | NASA Goddard archive and NASA GES DISC | 2005-2025 | the same, with a note that MERRA-2 uses OMI's ozone itself |

Of MERRA-2's significant trends in those years, GPM confirms 22% of the rainfall area (73% not confirmed, 5%
contradicted), MODIS 28% of the snow area it can see (72% not confirmed), AIRS 54% of the temperature area (44% not
confirmed, 2% contradicted), GLDAS 45% for evaporation and 31% for soil moisture (7% and 14% contradicted), and OMI 72% of the ozone area
(none contradicted). The ozone figure is not an independent result: MERRA-2 takes in OMI's ozone measurements
from late 2004, so it mostly shows that the reanalysis follows its input.
The satellite check is information only: it never changes a grade, because the grade is about the whole period.
AIRS and GLDAS are read from NASA GES DISC with a NASA Earthdata account. Code: `pipeline/evaluation/instrument_check.py`, `pipeline/instruments/` (`earthdata.py` for AIRS and GLDAS),
`web/src/evaluation/instrument.ts`.

## 3. What we measured

All numbers below were computed by the pipeline and recomputed independently in review.

### Independent check, over the area where MERRA-2 shows a significant trend

| | Confirmed | Partly confirmed | Not confirmed | Contradicted |
|---|---|---|---|---|
| Air temperature (land), 2 records | 89.9% | 7.7% | 1.9% | 0.5% |
| Rainfall (60°S–60°N), 4 records | 20.1% | 43.5% | 27.7% | 8.8% |
| *First record alone: GISTEMP* | 97.1% | | 2.3% | 0.6% |
| *First record alone: GPCP* | 26.0% | | 67.8% | 6.2% |

In words: MERRA-2's temperature trends on land are trustworthy. Judged by GPCP alone, two thirds of its significant rainfall
trends were not confirmed; judged by up to four records, 20% are confirmed by more than half of them, 43% by some but not most, and **28% by none of the
available records**. Where all four rainfall records exist (905 boxes, land and coast), MERRA-2's significant trends are confirmed
by all four on 11.9% of the area, by at least two on 42.4%, and by none on 34.4% (area-weighted; `byCount` in the JSON). The records do not
agree with each other, which is why one record alone gave a misleading answer.

### Examples

| Place | Variable | MERRA-2 per decade | Independent record per decade | Result |
|---|---|---|---|---|
| Istanbul | Air temperature | +0.54 °C | +0.55 °C | Confirmed |
| Porto Velho | Air temperature | +0.52 °C | +0.23 °C | Confirmed, but MERRA-2 is twice as large |
| Porto Velho | Rainfall | −0.58 mm/day | −0.36 mm/day | Confirmed |
| Cebu | Rainfall | +0.90 mm/day | GPCP +0.09 (not significant), CMAP +0.56, GPCC +0.44, PREC/L +0.48 (significant) | Confirmed by 3 of 4 |
| Manila | Rainfall | +0.88 mm/day | GPCP +0.05 and GPCC +0.22 (not significant), CMAP +0.49, PREC/L +0.57 (significant) | Confirmed by 2 of 4 |

"Cebu is getting wetter" was an example finding that GPCP alone did not confirm; three of the four records do. The rainfall
records disagree with each other, so for a place like Cebu the honest statement is "confirmed by 3 of 4", not a plain yes or no.

### Pattern checks: share of each variable's significant area by grade

| Variable | Robust | Use with caution | Doubtful | Most common jump year |
|---|---|---|---|---|
| Air temperature | 94.2% | 5.2% | 0.5% | 2006 |
| Hottest temperature of the year | 98.0% | 1.9% | 0.1% | 2013 |
| Precipitation | 93.1% | 6.3% | 0.5% | 2004 |
| Wind speed | 91.2% | 8.1% | 0.6% | 2007 |
| Soil moisture | 84.2% | 14.5% | 1.3% | 1998 |
| Evaporation from land | 85.2% | 12.9% | 1.9% | 2005 |
| Humidity | 82.8% | 14.2% | 3.0% | 2005 |
| Snow cover | 95.7% | 4.3% | 0.0% | 2011 |
| Sea ice | 69.1% | 30.5% | 0.5% | 2005 |
| Ozone layer | 98.8% | 1.2% | 0.0% | none |

The jump years cluster around 1998 and 2004–2007. Those are years when the satellites and data sources
feeding MERRA-2 changed, which is what a jump caused by the dataset would look like.

### The pattern checks have a blind spot

Manila's rainfall passes every pattern check ("Robust"), yet the independent record does not confirm it.
The pattern checks only see shapes; a smooth drift that is wrong looks exactly like a smooth trend that is
right. **A "Robust" grade on a variable with no independent record means "no warning sign found", not
"confirmed".**

### The check for countries, seas and continents

The same check is available for a whole area. The independent record and MERRA-2 are both averaged over the boxes that
lie inside the area, each box weighted by the area (cos of latitude) of the area's cells it holds. Only boxes that
qualify for a point (land for temperature, below 60 degrees latitude for rainfall, 45 years of data) are used. The area is
checked when those boxes carry at least half of its weight; otherwise the site says the record covers less than half of
it (this happens for small islands, and for rainfall in Russia and polar seas), and for air temperature over a sea it
says the record measures the water. Every record is averaged over the same area on its own boxes (a record counts for the
area when its boxes carry at least half of the area's weight); classes (confirmed, partly, not confirmed, contradicted), the grade cap and
the bad years work as for a point; the numbers are in `web/public/data/reference/areas_*.json`.

### Bad years and patching

A "bad year" is a year where MERRA-2 departs from the independent record much more than it usually does,
after removing any slow drift between the two. Example: the box around Manila in 2020, MERRA-2 11.66 mm/day
against GPCP 7.08, when every other recent year agrees within about 15%.

- **Finding bad years works.** With faults planted on purpose in real data (one year inflated by 30%, 50%,
  100%), the rule finds 21%, 63% and 90% of them, and flags 0.12% of untouched years.
- **Looking at neighbouring cells does not work for this.** The cells around Manila share the 2020 error,
  so filling from neighbours would copy the fault.
- **Removing bad years barely changes the trends.** Manila goes from +0.875 to +0.832 per decade; GPCP says
  +0.055. Across all boxes the agreement with the record does not improve. The disagreement is slow drift
  over the whole record, not single bad years. So "patching" does not make MERRA-2's rainfall trends right;
  the honest response is to label them.

### The "Confirmed only" map

The Menu row **Show** redraws the temperature or rainfall map (1981–2025 only) with just the trends the independent records
confirm. For each MERRA-2 cell that is significant on the map: it is *confirmed* if the reference box containing the cell centre is
eligible and the class there, for the cell's own sign, is "confirmed" (k of n as above); *partly* if it is partly confirmed (not
drawn); *cannot check* if the box is not eligible; otherwise *not confirmed* (not confirmed or contradicted). The picture is the normal trend picture with only confirmed cells coloured. Shares of the whole globe (cos-latitude
weighted; `reference/confirmed_<VAR>.json`):

| | Significant | Confirmed | Partly | Not confirmed | Cannot check |
|---|---|---|---|---|---|
| Air temperature (2 records) | 69.0% | 18.4% | 0.1% | 0.4% | 50.0% |
| Rainfall (4 records) | 21.2% | 10.2% | 2.0% | 5.9% | 3.1% |
| *Before: GISTEMP alone* | 69.0% | 18.4% | | 0.5% | 50.0% |
| *Before: GPCP alone* | 21.2% | 5.1% | | 13.0% | 3.1% |

Temperature looks small here only because half of the significant area is sea, where the record is not air temperature; on land
almost all of it is confirmed (90% by both records and 97% by GISTEMP alone, in the box table above). Code: `pipeline/evaluation/export_confirmed.py`.

## 4. How good are the checks themselves? (calibration)

We test the pattern checks on made-up series where we know the truth. From `pipeline/evaluation/calibrate_quality.py`:

- A genuine gradual trend is wrongly flagged as a jump in under 1% of cases when the noise is independent
  from year to year, and in 2–7% when each year resembles the one before.
- A genuine jump of three noise-widths or more is caught in 69–98% of cases. A small jump (two noise-widths)
  is caught in only about a third of cases, so small jumps often pass as "Robust".
- A trend created by one extreme year is flagged in 33–48% of cases.

The thresholds were chosen to keep false alarms low. That is a choice, and it can be changed (section 6).

## 5. How to run it

```bash
cd pipeline
.venv/bin/python -m pytest -q            # all tests
.venv/bin/python -m evaluation.calibrate_quality    # the calibration table of section 4
.venv/bin/python -m evaluation.export_quality       # pattern checks for every cell; rewrites quality.bin and the meta files
.venv/bin/python -m evaluation.reference            # downloads GPCP once, builds both comparisons, prints the full report
.venv/bin/python -m evaluation.reference report     # prints the report again from the cache
```

The other records (GHCN-CAMS, CMAP, GPCC, PREC/L) are read from the cache that `sources.py` fills (`reference_more.py fetch`);
`reference.py rewrite` and `reference_areas.py` then add them offline. `reference.py` needs the GISTEMP file (`gistemp1200_GHCNv4_ERSSTv5.nc`, from
https://data.giss.nasa.gov/pub/gistemp/); set `GISTEMP_NC` to its path. GPCP is read over the web from NOAA.

On the site: click a place with Click set to Point. Under the verdict there is a grade badge, the reasons,
and an "Independent check" line. The Detective shows the grade on each line.

## 6. Decisions that are yours

These are judgement calls, not statistics. Each can be changed in one place.

1. **What to do with "Not confirmed" rainfall trends.** Now: they stay on the map and get "Use with caution".
   Alternatives: fade them on the map, or hide them from the Detective's list.
2. **How strict the jump check is.** Now: few false alarms, small jumps often missed.
   (`RATIO_MAX` and `FIT_MAX` in `pipeline/evaluation/quality.py` and `web/src/evaluation/quality.ts`; change both, then rerun
   the calibration.)
3. **Whether a "Robust" grade should be reworded for the eight variables with no independent record**, for
   example "No warning signs" instead of "Robust", so nobody reads it as "confirmed".
4. **Which rainfall example to lead with.** Shanghai is confirmed by four of four records.
   Cebu is confirmed by three of four; it is usable, with the note that MERRA-2 shows about twice the size.
5. **More independent records.** Sea ice (NSIDC) and snow cover would be the next most useful, because sea
   ice has the most jump flags.

## 7. Words used here

- **Trend / slope**: how fast a value changes, here per decade.
- **Significant (p < 0.05)**: if there were no real change, numbers this extreme would turn up less than
  1 time in 20.
- **Reanalysis**: a weather model continually corrected with measurements; MERRA-2 is one.
- **Independent record**: a dataset built from measurements, without using MERRA-2.
- **Box**: one cell of the independent record's grid, about 220–280 km across. MERRA-2's cells are about 50 km.
- **Drift**: a slow, steady difference that grows between two datasets over the years.
- **Calibration**: testing a check on made-up data where the right answer is known.
- **False alarm**: a check warns about something that is actually fine.
