# Night report: challenge research, more data sources, and method experiments

Written overnight, 14–15 November 2026, while the site was left unchanged. Everything here was produced by
research and experiment runs and then checked; section 10 says how, and what was not checked.

## 1. Read this first

1. **There is an eligibility question to settle before submitting.** A NASA organiser wrote in the public forum
   that a project must use a NASA data source that is on its challenge's own Resources list to be eligible for
   Global Awards. This challenge's list names Giovanni, Hydrology Time Series, AppEEARS and one research
   article. NASA POWER, which this project is built on, is not on the list. Details and options in section 2.
2. **I was wrong about Cebu.** Earlier I said its rainfall trend was "not confirmed" and should be dropped. That
   used one record. With three more rainfall records, three of four confirm the wetting, at about half
   MERRA-2's size. Section 5.
3. **The rainfall records disagree with each other.** So "not confirmed by GPCP" was too blunt. A change that
   asks every available record and reports "confirmed by k of n" is built on a branch for you to merge.
   Section 8.
4. **A "Robust" grade does not predict being right.** Measured against the independent record, robust rainfall
   trends are confirmed no more often than flagged ones. Only the jump flag carries a signal. Section 6.
5. **No technique repairs MERRA-2's rainfall trends, and no other significance test is clearly better.**
   Six trend techniques and eight tests were tried. The current method stays. Sections 6 and 7.

**What needs you:** the eligibility decision (section 2), merging or rejecting the branch (section 8), and the
items still open in `docs/SUBMISSION.md`.

## 2. The eligibility question

**What was said.** In the forum thread "asking about the resources", a NASA organiser (Paula-GO-Team) answered
that to be eligible for Global Awards "you must use at least one NASA data source that is included with the
Resources of each challenge" (https://github.com/nasa/spaceapps/discussions/1827). The organisers' tips thread
says projects must use at least one NASA resource and make its contribution clear
(https://github.com/nasa/spaceapps/discussions/2123). The Project Submission Guide says only that at least one
NASA data set or resource is needed. I read both threads and the guide myself.

**What this challenge's Resources tab lists** (read directly,
https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/?tab=resources):

| Listed under "NASA Data & Resources" | Can it be used from here? |
|---|---|
| Giovanni | The page loads. Getting data needs an Earthdata sign-in (yours) |
| Hydrology Time Series | The old data service now redirects to a notice that it is being discontinued; other participants reported errors on 14 November |
| AppEEARS | Needs an Earthdata sign-in |
| Climate Data Online (NOAA) | The data service needs a free token requested by email |
| Research article: time-series analysis of SeaWiFS chlorophyll (Acker et al.) | Public PDF, read (see below) |

Space-agency-partner resources on the same tab: KNMI Climate Explorer and two articles on trend testing.

**Where the project stands.** Its data is MERRA-2, a NASA dataset, reached through NASA POWER. Giovanni serves
MERRA-2 too, but the project does not use Giovanni. On a strict reading of the organiser's sentence, the
project uses no resource from the list.

**Options, cheapest first.**

1. **Cite the listed article as the method's starting point** (done in this report, not yet in the form text).
   The article builds area-averaged monthly time series in Giovanni, removes the seasonal cycle with monthly
   anomalies, fits a linear regression, and judges it with an F-test at p < 0.05. This project follows the
   same steps and replaces the regression and F-test with Theil–Sen and Mann–Kendall. This is a real use of a
   listed NASA resource, but it is an article, not data.
2. **Use Giovanni for a cross-check** (about 2–3 hours, needs you to sign in to Earthdata in the browser pane).
   Export Giovanni's area-averaged MERRA-2 series for the three start-strip places and show they match the
   site's series; optionally add a Giovanni-served record (for example GPM rainfall) as one more independent
   record. This makes "uses a NASA data source on the Resources list" plainly true.
3. **Ask the organisers** in the Challenges category of the forum whether MERRA-2 through NASA POWER counts.
   Free, but the answer may not come before the deadline.

My recommendation: do 1 now (it is in `docs/SUBMISSION_FORM.md`) and 2 in the morning. The research run
reports that a 2025 global winner listed the NASA POWER API among its NASA data
(https://www.spaceappschallenge.org/2025/find-a-team/twisters/), under a different challenge; I did not open
that page myself. If so, POWER is acceptable as NASA data, and the open point is only the "on the Resources
list" wording.

## 3. What the challenge asks, against what the project does

Source: the challenge page. Items are paraphrased.

| What the challenge asks | Status | Where |
|---|---|---|
| Choose variables, get regional data, show a time series, test the trend | Covered, and beyond: robust slope, significance test, confidence range, false-discovery control | Whole site |
| Understandable by a general audience | Covered; a real-phone check by a person is still open | Verdict sentences, definitions |
| Lead the user through a short series of questions | Partly: the Detective is a lookup, not a guided sequence | Detective |
| Provide demonstration examples | Partly: three one-click findings, no narrated walkthrough | Start strip |
| Trends that are not significant are still worth showing | Covered | "Possible trend" and "No clear trend" verdicts |
| Regions with opposite trends | Covered | Diverging map, country and sea views |
| Daily or monthly data, the seasonal cycle | Partly: annual means only; the panel shows monthly anomalies but no seasonal trends | Point panel |
| Non-linear trends | Covered at the level asked (the page calls linear trends a good start); the jump and reversal checks go further | Evaluation layer |
| Optional: AI to help find data; CUAHSI tools; streamflow | Not covered, by choice; the page marks them optional | — |
| Instruments named in the background (MODIS, OMI, AIRS, GPM, GLDAS) | Not used; MERRA-2 is the only primary series | — |

## 4. What participants asked in public, and the official answers

From Space Apps Connect (GitHub Discussions of `nasa/spaceapps`). Only accounts ending in `-GO-Team` are
organisers; other replies are community opinion and are left out unless marked.

| Question | Official answer | What it means here |
|---|---|---|
| Can we start before the hackathon? | No work before Saturday 9:00 local time; working ahead can lead to disqualification (#1827, #1871, #2057) | The repository's first commit is 14 November 10:09 +03:00, after the start |
| Which NASA data counts? | See section 2 (#1827, #2123) | The open eligibility question |
| Is AI allowed? | Yes, disclosed; it should not be what comes up with the idea (#1780, #2057, and the submission guide) | The form text now states your own role; the README's "Use of AI" should say the brief was yours |
| How much should a project cover? | Pick one focused problem and solve it well (#2138) | Lead with one story: "can this trend be trusted?" |
| Must it be finished? | Judges expect two-day projects, not finished products (#1871, #1787) | Stated limits are fine |
| Demo format? | Seven slides or a video of 30 seconds or less; longer material can go in the project link (#1857) | The deck complies |
| Citing sources | Cite every source and make each resource's role clear (#2123) | The form text lists them; add the new records if the branch is merged |

One community thread about this challenge (#2152) asked about reliability checks and neighbouring cells. No
organiser replied. The project's answer to that question is the independent-record check, which is stronger
than a neighbour check: the known bad year near Manila is shared by the neighbouring cells.

## 5. Judging criteria

From the Judging and Awards guide: Impact, Creativity, Validity, Relevance, Presentation, each scored 1 to 5.

| Criterion | Strong | Weak |
|---|---|---|
| Impact | A trend tool that says how far to trust each answer | No named user or decision it serves |
| Creativity | The independent check, grades, "Confirmed only" map | A globe with a trend map is a familiar format; the evaluation layer has to carry the story |
| Validity | Tested statistics, calibration, measured limits, this report | Repository still private; 2 of 10 variables have an independent record on the site |
| Relevance | NASA data is the core | The eligibility wording in section 2 |
| Presentation | Seven-slide deck, start strip | No narrated walkthrough; never tried on a real phone |

Dates from the guide: nominees 3 December 2026, finalists 17 December, winners 26 January 2027.

## 6. More independent records

### What could be read from this machine

Only public records that need no sign-in, in a format the installed tools can open. Twelve were fetched,
cached and compared (`pipeline/sources.py`, `pipeline/reference_more.py`).

| Variable | Record | Kind | Notes |
|---|---|---|---|
| Air temperature | GHCN-CAMS (0.5°, land) | Weather stations | Shares station data with GISTEMP, so not independent of it |
| Air temperature | NOAAGlobalTemp (5°) | Stations and ships | Same caveat; coarse |
| Rainfall | GPCC (land) | Rain gauges | MERRA-2's land rainfall is itself gauge-corrected |
| Rainfall | CMAP (land and ocean) | Gauges and satellites | |
| Rainfall | PREC/L (land) | Rain gauges | |
| Sea ice | HadISST, NOAA OISST, NSIDC index | Satellite passive microwave | Same family MERRA-2's own sea ice comes from |
| Snow cover | Rutgers Northern Hemisphere extent | Satellite charts | One number per month for the hemisphere, no map |
| Ozone | NASA SBUV merged zonal means | Satellite | By latitude band; probably assimilated by MERRA-2 |
| Wind, humidity | ICOADS ship reports (ocean, to 2015) | Ships | Known instrument and height problems |

Could not be read: HadCRUT5, Berkeley Earth, HadISDH (land humidity) and ESA CCI soil moisture are in a file
format the installed tools cannot open, and installing the library was not permitted. GLEAM (evaporation) did
not respond. Nothing was found for soil moisture, evaporation or the hottest temperature of the year.

### Results: over the area where MERRA-2 shows a significant trend

| Variable | Record | Confirmed | Not confirmed | Contradicted |
|---|---|---|---|---|
| Air temperature, land | GISTEMP (on the site) | 97.1% | 2.3% | 0.6% |
| Air temperature, land | GHCN-CAMS | 91.6% | 7.4% | 1.0% |
| Air temperature, land | NOAAGlobalTemp | 94.1% | 5.7% | 0.2% |
| Rainfall, land | GPCP (on the site) | 33.3% | 60.0% | 6.7% |
| Rainfall, land | GPCC | 32.8% | 63.6% | 3.6% |
| Rainfall, land | CMAP | 40.1% | 56.4% | 3.5% |
| Rainfall, land | PREC/L | 38.3% | 54.7% | 7.0% |
| Rainfall, 60°S–60°N, land and sea | GPCP | 26.0% | 67.8% | 6.2% |

**Rainfall, four records together** (692 land boxes that have all four): confirmed by all four on 13.2% of the
area, by three on 12.3%, by two on 17.0%, by one on 20.9%, by none on 36.6%. Any two records give the same
answer only 56–70% of the time.

**Reading.** Temperature on land is solid whichever record is asked. For rainfall, about a third of MERRA-2's
significant trends are confirmed by any one record, about four in ten by at least two of four, and more than a
third by none. Part of "not confirmed" is the records' own disagreement, so a single record is weak evidence
either way; "confirmed by none of four" is the strong signal.

### The example places, per decade

| Place (rainfall) | MERRA-2 | GPCP | GPCC | CMAP | PREC/L | Confirmed by |
|---|---|---|---|---|---|---|
| Shanghai | +0.31 | +0.26 | +0.23 | +0.21 | +0.15 | 4 of 4 |
| Porto Velho | −0.58 | −0.36 | −0.83 | −0.55 | +0.03, not significant | 3 of 4 |
| Cebu | +0.89 | +0.09, not significant | +0.44 | +0.56 | +0.48 | 3 of 4 |
| Manila | +0.88 | +0.05, not significant | +0.22, not significant | +0.49 | +0.57 | 2 of 4 |

Values are for the 2.5° box around each place, in mm/day. The start strip's three findings stand. Cebu's
wetting is real in direction and overstated in size by MERRA-2; my earlier statement that it should not be
used was too strong.

### Other variables, hemisphere or band totals only

| Variable | MERRA-2 | Record | Reading |
|---|---|---|---|
| Arctic sea-ice area | −3.44% per decade | NSIDC −3.32% | Agrees |
| Antarctic sea-ice area | +2.15% per decade, significant | NSIDC +0.04%, not significant | MERRA-2 shows a gain the record does not |
| Northern Hemisphere snow extent | −1.24% per decade, significant | Rutgers −0.42%, not significant | Same direction; MERRA-2's rate is about three times the record's |
| Ozone, middle latitudes | −1.54 DU per decade at 42.5°N | SBUV −1.42 | Agrees |
| Ozone, tropics | +1.0 to +1.5 DU per decade, significant | SBUV flat or slightly negative | MERRA-2's tropical rise is not supported |
| Ocean wind, ocean humidity | — | Ship reports | Poor agreement, and the ship records are not a clean reference; no conclusion |

These four findings (Antarctic sea ice, snow rate, tropical ozone, and the lack of any record for soil
moisture, evaporation and hottest temperature) are worth one line each under the variable's caveat on the
site. They are not on the site yet.

## 7. Experiments on the method

All scripts are in `pipeline/experiments/`. The yardstick throughout is agreement with the independent records.

### Does a "Robust" grade mean the trend is right?

Among boxes where MERRA-2's rainfall trend is significant (2,547 boxes), share confirmed by GPCP:

| Grade or flag | Confirmed | Contradicted | Boxes |
|---|---|---|---|
| Robust | 26.0% | | 2,335 |
| Use with caution | 22.8% | | 149 |
| Doubtful | 34.9% | | 63 |
| Jump flag set | 15.8% | 20.4% | 112 |
| Jump flag not set | 26.5% | 5.5% | 2,435 |

For temperature: robust 97.4%, caution 90.8%, doubtful 94.6%; with the jump flag set, 8.7% are contradicted
against 0.3% without.

**Reading.** The grade does not separate right from wrong. "Robust" means "no warning sign found", nothing
more. The jump flag is the one check with information: a flagged trend is about four times as likely to be
contradicted. The "end sensitivity" flag never fired on any significant box. A search for the best
two-condition rule from patterns alone raised the confirmed share of rainfall trends from 26% to about 31%
while discarding a third of the confirmed ones: a weak warning at best.

**Proposal:** rename the grade "Robust" to "No warning signs" for the eight variables that have no
independent record, and say in the jump sentence that flagged trends are more often contradicted.

### Can the trend itself be repaired?

| Technique | Result |
|---|---|
| Remove the jump where the jump flag is set | Tiny gain for rainfall (confirmed share 26.0% to 26.5%), slight loss for temperature |
| Remove a jump wherever a change-point test is significant, or at the years MERRA-2's satellites changed | Deletes real trends: temperature's detection of confirmed trends falls from 74% to 14–23%. A smooth trend alone triggers the test |
| Start later (1990, 2000, 2005) | No better: the confirmed share for rainfall stays near 25%, and temperature gets worse |
| Other slope estimators (least squares, repeated medians) | Theil–Sen is as good or better |
| Coarser scale (500 km, 1000 km) | Slightly closer values; still only 27% of rainfall trends confirmed at 1000 km, so the disagreement is large-scale |

A control explains why nothing helps rainfall: assuming "no trend anywhere" is closer to GPCP (error 0.118
mm/day per decade) than MERRA-2's own trends are (0.188). For temperature it is the reverse (0.355 against
0.179). Any method that merely flattens rainfall trends looks better without being better.

**Conclusion:** adopt none of these as a fix. Keep labelling.

### Is another significance test better?

Eight alternatives to the current test were compared on series with known truth and on real data.

| Test | False positives, mean over 9 noise types | Worst case | Power kept (fair comparison, 2-noise-width trend) |
|---|---|---|---|
| Mann–Kendall, no correction | 19.4% | 47.8% | 63.7% |
| **Current (lag-1 Hamed–Rao)** | **13.0%** | **29.5%** | **61.5%** |
| Hamed–Rao, all lags | 14.3% | 27.2% | 57.3% |
| Yue–Wang effective sample size, lag 1 | 11.1% | 28.1% | 62.3% |
| Yue–Wang, all lags (as in a common library) | 49.7% | 57.5% | 54.1% |
| Trend-free pre-whitening | 24.0% | 61.7% | 61.2% |
| Iterative pre-whitening | 10.1% | 20.2% | 56.8% |
| Block bootstrap, block 3 | 13.2% | 29.9% | 61.3% |

The target is 5%. No test reaches it when each year strongly resembles the one before. Against the
independent records, no test changes the picture: rainfall's confirmed share is 25–27% under every sensible
test, and temperature's 96–98%.

**Conclusion:** keep the current test. If a stricter option is ever wanted, the lag-1 Yue–Wang correction is
the simple candidate (fewer false positives, same power). Two widely used alternatives, trend-free
pre-whitening and the all-lag Yue–Wang form, performed worse than no correction at all and should not be
adopted. The rainfall disagreement is not a matter of which test is used.

## 8. What changed overnight

On `main` (the live site is unaffected by these):

- `pipeline/sources.py`, `pipeline/reference_more.py`, tests: the twelve further records and their comparison.
- `pipeline/experiments/`: the two experiment scripts and their raw output.
- This report.

**On a branch, waiting for you:** `multi-record`. It changes the independent check on the site to ask every
available record (two for land temperature, up to four for rainfall) and to report "Confirmed by k of n
independent records", with the "Confirmed only" map following the same rule. See the pull request for its
verification status; if it is not there yet, the work was still running when this file was committed.

## 9. Recommended next steps, in order

| # | Step | Why | Effort | Needs you |
|---|---|---|---|---|
| 1 | Settle eligibility: cite the listed NASA article in the form text now; cross-check with Giovanni | Section 2 | 0.5 h + 2–3 h | Earthdata sign-in for Giovanni |
| 2 | Review and merge the `multi-record` branch | Cebu is mislabelled on the live site until then | 0.5 h | Yes |
| 3 | Make the repository public | Judges cannot see the code | 5 min | Yes |
| 4 | Lead the deck and summary with "can this trend be trusted?" and the four-record rainfall result | One focused story (organiser advice) | 1 h | No |
| 5 | Rename "Robust" to "No warning signs" where there is no independent record | Section 7 | 0.5 h | Your call |
| 6 | Add the four measured caveats (Antarctic sea ice, snow rate, tropical ozone, unverified variables) to the site | Section 6 | 1 h | No |
| 7 | Reword the README's "Use of AI" so it says the brief was yours | Section 4 | 10 min | Read it |
| 8 | Try the site on a real phone | Never done | 15 min | Yes |
| 9 | A short guided walkthrough for first-time visitors | The challenge suggests guiding the user | 2–3 h | No |

## 10. How the numbers were checked

- **Forum quotes and the Resources list:** read directly, not taken from the research summary.
- **CMAP and GPCC:** I requested the Cebu box from the source myself and got the same series as the cache
  (differences under 0.000001) and the same trends.
- **Land summary for GPCC, CMAP, PREC/L, the four-record counts, the example places:** recomputed with my own
  code from the cached records; they match the survey's figures to 0.2 points.
- **Grade against confirmation, and the "no trend anywhere" control:** recomputed with my own code; identical.
- **Current test's false-positive rates:** my own simulation gives 4.8%, 12.6%, 16.2% and 30.1% at four noise
  levels, against the experiment's 4.7%, 13.0%, 16.9% and 29.5%. The real-data table re-ran identically.

**Not independently checked:** the alternative significance tests were implemented by the experiment script;
two of them (iterative pre-whitening and the lag-1 Yue–Wang form) were written from memory of the papers and
not compared with a reference implementation. The sea-ice, snow, ozone, wind and humidity comparisons were
not recomputed by me. Statements about what MERRA-2 itself ingests (which would make a record
non-independent) are recollection, except that its land rainfall is gauge-corrected, which was read from
MERRA-2's file specification. The "what could not be read" list is as reported by the survey.
