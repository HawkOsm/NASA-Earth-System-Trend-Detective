# Review: where the code and the interface are hard to follow

15 November 2026. Six review agents read the code and walked the live site; their findings were then checked.
This file is the ranked result. It lists what is hard to understand, not what is wrong with the science.

- **Code:** four read-only reviews (the page and map; country and point views; Detective, evaluation and proxy;
  the Python pipeline). Each finding had to come with a file, a line and the lines themselves.
- **Interface:** two walk-throughs of the live site in an automated browser, at laptop size (1366 x 768, and
  1920 x 1080) and at phone size, with a screenshot and a measurement for each point.
- **Checking:** the claims marked "confirmed" below were re-tested in a browser or re-read in the files. The rest are
  the reviewers' reading of the code and are marked "not re-checked".

Line numbers are those of 15 November and will drift.

## 1. Fixed during the review

Eleven things turned out to be real faults, small enough to fix at once. All are live.

| What | How it showed | Measured |
|---|---|---|
| A new graphics context on every redraw of the page | The browser keeps about sixteen and drops the oldest, which is the globe's: the globe could flicker or go blank | 40 variable switches made 70 contexts and 9 losses; after the fix 2 and 0 |
| "Take the tour" could open on a later step | After stopping at the Water step and choosing Water yourself, the tour reopened on "One exact place" | Reproduced; now opens on the welcome card |
| The tour still looked for a Menu button that no longer exists | Dead code and a sentence that could never show | Removed |
| The start strip lay over the menu at laptop width | The menu's lower rows and the "colour scale has changed" line were cut off | Overlap at 1366 px: yes before, no after |
| A Detective question without years kept the previous question's years | "Is it getting drier in the Amazon?" opened Brazil for 2000-2025 because the question before said "since 2000" | Now goes back to 1981-2025 and says so |
| A country view opened over a newer answer | Pressing another button within 1.5 s of an answer did not call the view off | Reproduced on the live site; fixed |
| "A continent has no view of its own" was said about the world | Wrong word | Now "The whole world" |
| On a phone the first tap on the globe did nothing | The globe only answered a tap after an earlier touch had told it where the finger was | Live, touch input: the first tap now opens the view; a finger drag still turns the globe (27.7°) without opening anything |
| The start strip slid under the top bar on a phone held sideways | "Got it" could not be tapped, so the strip could not be closed | Live at 844 x 390: the strip sits below the bar and "Got it" takes the tap |
| The phone menu had no background | Its text lay on the globe and was hard to read over red and white; with every part open it scrolled inside itself | At 390 x 844: a dark box, nothing hidden (was 177 px); a tap on the box no longer opens the country behind it. The tour now opens the menu only for its two menu steps, so the globe is free for the others |
| "Back to the globe" and the × scrolled out of sight | In a long country view, the place panel and "How to read this" the way out was lost after scrolling | At 390 x 844 and 1366 x 768: scrolled to the end, each button is still in the window and takes the press |

## 2. Code: the hardest places, most confusing first

### 2.1 `App.tsx` is one function of 1,042 lines (confirmed by measurement)

`web/src/App.tsx:195-1236`. It parses the address, runs the tour, loads the variables, runs the single-place
request, runs the country and sea request, routes every click, holds the variable, period and click-mode state,
defines the test hooks, does the independent and satellite checks, and draws the page. It has 23 `useState`, 19
`useRef` and 25 `useEffect`.

What to do first: a comment at the top listing these jobs with their line ranges. The blocks that only read
(the test hooks at 849-1006, the two checks at 726-806) are the easiest to move out.

### 2.2 Seven values are kept twice, as state and as a ref, with three different rules (not re-checked)

`App.tsx:210-271`. A ref copy lets a callback see the current value. But `metasRef` and `panelRef` are copied on
every render, `variableRef`, `sizeRef`, `periodRef` and `liftRef` are written by hand beside the setter, and
`countryPanelRef` is written inside a wrapper. `countryModeRef` has no state twin at all. A reader has to check
every setter to know whether the two can differ.

What to do: one comment stating the rule, and one helper per pair that writes both.

### 2.3 "Lift" lives in three places (confirmed by reading)

`lift` (state, shown in the menu), `liftRef` and `countryModeRef` all decide what a click on the globe does
(`App.tsx:590`). Clicking a cell inside a lifted country opens a single-place panel (`selectDetailCell`, 696-702)
but leaves `lift` on, so the menu still says Lift while a place panel is open, and the next click lifts again.
That may be intended; nothing says so. "Set the click mode to Lift" is also written three times
(`selectCountryArea`, `chooseArea`, the tour's start).

### 2.4 Three period values under eight names (not re-checked)

`period` is the live value while a slider moves, `periodRef` is its ref, and `mapPeriod` is the value the map
uses, which follows 150 ms later or on release. The panels use the first, the map the third. The names
`setPeriodState`, `setMapPeriod`, `changePeriod`, `commitPeriod`, `setPeriod`, `resetPeriod` are easy to confuse:
`setPeriod` means "set and commit". Renaming to `livePeriod` and `committedPeriod` would say it.

### 2.5 "Country" also means sea (confirmed by reading)

A sea is turned into a country record (`areas/sea.ts:107-119`), so `CountryOverlay`, `CountryMap`,
`useCountryTrends` and `countryPanel` all serve seas. For a sea, `idx` is a sea index, `bbox` may run past 180
degrees, and the "outline" passed to the map is the frame rectangle, so "inside the outline" is always true. None
of this is visible from the names.

### 2.6 The 180 degree line is handled in about twelve places (not re-checked)

Six files deal with a longitude that crosses the date line: `areas/country.ts` (five functions), `areas/sea.ts`
(five), `areas/CountryMap.tsx` (four spots), `point/power.ts`, `point/region.ts`, and `App.tsx` twice. The
"reference longitude" is the country's centre for a country and the middle of the box for a sea, and the country
rule is written in `App.tsx:940` and `:1163`, not beside the code that uses it. `normalisePolygon`
(`country.ts:158-199`) is the hardest 40 lines in the site's code.

Rule of thumb for a reader: the country and sea views move everything into a frame centred on one longitude;
the single-place view avoids the problem by shifting its box inwards.

### 2.7 Two components of over 400 lines each (confirmed by measurement)

- `areas/CountryMap.tsx:100-527` (428 lines, 16 inputs): measures itself, fits the projection, builds outlines,
  hit-tests, renders the colour layer, draws the overlay, handles touch, and words the readout. Its colour layer
  (234-339) is one body for two different pictures, country and sea, with `sea` tested six times.
- `areas/CountryOverlay.tsx:141-559` (419 lines, 23 inputs, 22 hook calls): dialog, layout, grade, test hook and
  cards in one.

### 2.8 The Detective's `ask` chooses among ten cases in a fixed order (confirmed by reading)

`detective/Detective.tsx`, function `ask`. It weighs its own word matching, Gemini's reading, the region words
(Sahara, Amazon) and typed coordinates. In the order the code tests them:

| # | Case | Result |
|---|---|---|
| 1 | Typed latitude and longitude | That point; Gemini is not asked |
| 2 | Coordinates outside the globe | A message |
| 3 | Gemini's place is exactly a name in the site's lists | That place |
| 4 | A region word, exact or with one typo | The Sahara or the Amazon |
| 5 | The site's own exact match | That place |
| 6 | A name with two meanings ("Pacific") | "Which one?" |
| 7 | Gemini gave a position for a place not in the lists | That position |
| 8 | The site's own fuzzy match | That place, with "I read ... as ..." |
| 9 | Only a kind of place ("a desert") | The Sahara, with a note |
| 10 | Nothing | "I couldn't find a place" |

Hard to predict: Gemini and the site's own matching are interleaved by how exact they are, not by source. Cases
2, 6 and 10 drop the years and the variable that were read.

### 2.9 One rule written in several places, with nothing tying the copies

| Rule | Copies | State |
|---|---|---|
| "Confirmed / not confirmed / contradicted" | Six functions in `pipeline/evaluation/`, with three different number codings; two more in the browser | Not re-checked |
| Averaging cells into boxes | Four loops in the pipeline with different rules for missing cells | Not re-checked |
| Grid sizes (361 x 576, 181 x 288, 0.5 x 0.625) | Typed as numbers in about fifteen pipeline lines and three browser files; `NLAT` means 361, 181, 90 or 72 depending on the file | Browser part confirmed |
| The ten variables | `data/demos.ts`, `detective/aiReader.ts`, `proxy/server.js`, `pipeline/core/config.py` | They agree today; only one test ties two of them |
| Checking Gemini's answer | `proxy/server.js` `clean` and `detective/aiReader.ts` `parseReading` | They agree today |
| The trend of one cell | `point/detail.ts:29-36` and `areas/country.ts` `spotTrend` | Confirmed: same statements |
| "Significant" at 0.05 and "possible" at 0.10 | Literals in about ten pipeline lines | Not re-checked |
| Sentences for an area | `evaluation/referenceAreas.ts` makes them by replacing text in the sentences of `reference.ts`; rewording one breaks the other silently | Not re-checked |

### 2.10 The pipeline cannot be rerun from the README alone (partly confirmed)

- **A step is missing.** `evaluation.reference` needs four cached records that only
  `python -m evaluation.reference_more fetch` downloads. That command is in `docs/EVALUATION.md`, not in the
  README's block. The caches exist on this computer, so nothing failed here. The line has now been added to the
  README (the step itself was not rerun).
- **The temperature record's default path is a temporary folder** of an earlier work session
  (`pipeline/evaluation/reference.py:50`). The file is there today; it will not survive a restart.
- **Two scripts write the same file.** `evaluation.export_quality` adds to `{VAR}_meta.json` and `regions.json`,
  which `maps.export` and `areas.regions` wrote. Rerunning either of those silently drops what it added. This was
  seen during the folder move: `regions.json` came back without its `quality` blocks until restored.
- **Exports rewrite test fixtures.** `maps.export`, `areas.countries`, `areas.seas`, `areas.regions` and
  `maps.export_summary` each rewrite a file under `tests/fixtures/` as a side effect.
- **Three scripts are not in the README block at all:** `maps.basemap`, `maps.export_wind`, `areas.provinces`
  (which also deletes every `.json` in its output folder first).

### 2.11 Test hooks are mixed with the page's own logic (confirmed by reading)

About 24 names of the form `window.__...` exist for browser tests. Two of them are needed by the page itself and
do not say so: `window.__view` (the camera; read in seven places in `App.tsx` and once in the menu) and
`window.__lastResult` (changed by effects in two files). A reader cannot tell which are safe to remove.

### 2.12 Leftovers (confirmed where marked)

- `areas/sea.ts:22` `COARSE_DLAT` is used nowhere (confirmed).
- `point/Panel.tsx`: the inputs `country` and `countryNote` are never passed by anyone (confirmed).
- `areas/country.ts` `loadProvinces` stores an empty list when the download fails, so a network error reads as
  "this country has no provinces" for the rest of the visit (confirmed by reading).
- The globe still has a hidden "Whole globe" button with its own timer; the menu has its own copy.
- `map/confirmedMap.ts`: the field `texture` is read by nothing.
- `pipeline/evaluation/instrument_check.py` writes `instcheck_{VAR}.npz`, which nothing reads; the options `array`
  and `scale` are the same for every record.
- `pipeline/evaluation/reference_more.py` is mostly a research report; the site needs one function from it.

## 3. Interface, laptop size

From the walk-through at 1366 x 768 (96 screenshots). "Seen" means I looked at the screenshot.

| # | Finding | State |
|---|---|---|
| 1 | The start strip covered the menu's lower rows | Seen; fixed |
| 2 | A Detective question kept the previous question's years | Seen; fixed |
| 3 | The tour's cards cover part of what they describe: step 3 hides the top of "Whole country", step 4 the variable list and sliders, step 7 the panel's Area buttons | Step 3 seen; not changed |
| 4 | Three grid sizes are quoted and never related: "about 50 km" (cells), "about 100 km" (Detective, period map), "roughly 220 km box" (checks) | Not changed |
| 5 | In the country view for a chosen period, the "Then and now, decade averages" card still shows all decades | Not re-checked |
| 6 | "2°, 5°, 10°" in the Click menu are not explained there; "Lift" is not explained on the first screen | Not changed |
| 7 | "Whole globe" is disabled with no reason given | Not changed |
| 8 | A large country (Russia) shows an empty map for 12 to 16 s with no "computing" message. Measured with software rendering; a real graphics card is faster | Not re-checked |
| 9 | The country view needs scrolling at 1366 x 768 (about 360 px hidden); at 1920 x 1080 almost nothing | Not changed |
| 10 | In single-place mode the menu text sits directly on the bright globe and is hard to read on red | Not changed |
| 11 | Unexplained marks: ▲ ▼ – on the variable tiles (the dash means "no clear trend"), a stray "⁞" | Not changed |
| 12 | "Significant on its own, but not after allowing for the 8 variables tested at this place" has no help text | Not changed |
| 13 | "Confirmed only" is not explained beside the button | Not changed |
| 14 | "about" in the menu and "How to read this" in the top bar open the same text; the country view has a third, different "How to read this view" | Fixed later the same day: one "About" in the top bar, rewritten, with pictures; the menu's "about" is gone |
| 15 | "How to read this" is 1,118 words in a box that shows about a quarter; the close button scrolls away (Escape works) | The close button now stays in sight; the length is not changed |
| 16 | Each variable has its own colours and nothing says which colour is the worrying one | Not changed |
| 17 | Small controls: the ⓘ icons are 20 x 19 px; "2°" and "5°" are 15 px wide | Not changed |
| 18 | One low-contrast number: the large rate on the Black Sea view, ratio 2.9 where 3 is the minimum | Not changed |

No text under 11 px was found, and every control has a name a screen reader can read.

**One thing under several names** (worth settling on one each):

- Opening a country: "Lift" (menu), "lifted out" (tour), "Lift Algeria" (Detective), "Show the whole country"
  (place panel), "country view" (the view itself).
- One place: "Point", "place", "spot", "grid cell".
- The checks: "Independent check", "Confirmed 2 of 2", "Checked against 2 records", "Confirmed only".

## 4. Interface, phone size

From the walk-through at 390 x 844 and, turned on its side, 844 x 390 (117 screenshots), with touch input.
"Seen" means I looked at the screenshot; "tested" means I repeated it in a browser myself.

| # | Finding | State |
|---|---|---|
| 1 | The first tap on the globe did nothing; only a second tap opened a country | Tested; fixed |
| 2 | With the phone on its side the start strip slid under the top bar and "Got it" could not be tapped | Tested; fixed |
| 3 | The phone menu has no background: its text lies directly on the globe and is hard to read on red and white. With every part open it also scrolls inside itself (about 177 px hidden; "All significant / Confirmed only" is cut in half) | Seen; fixed |
| 4 | In a long country view "Back to the globe" scrolls out of sight, and so does the × of the place panel. The only way back is to scroll to the top | Seen; fixed |
| 5 | A Detective question jumps straight to a full-screen country view, which hides the "Gemini read this as" note and the answer | Not changed |
| 6 | The Detective's answer area is about four lines tall on a phone | Not changed |
| 7 | The tour's step 3 says "Left" and "Middle", which describes the laptop layout; on a phone the parts are stacked. Its cards also cover what they describe | Wording fixed later the same day; the tour now has twelve steps, one for each part of the menu |
| 8 | "How to read this" speaks of the "left edge" and the "side panel"; a phone has neither | Fixed later the same day (the text is now "About") |
| 9 | The "All variables" tiles scroll sideways with nothing to show there are more | Not changed |
| 10 | The large rate is clipped in seven country views (a 105 x 48 px number in a 105 x 42 px box) | Not re-checked |
| 11 | Eight identical "Show on map" buttons in a row | Not changed |
| 12 | The place panel is 449 words on one screen | Not changed |
| 13 | Nearly every control is under 40 x 40 px, the usual minimum for a finger: the menu headings are 29 px tall, "Got it" 60 x 26, the ⓘ icons 20 x 19 | Not changed |
| 14 | "Plain map" in the Scale row and the Click options are not explained where they stand (as on the laptop) | Not changed |

The reviewer walked the tour before the last site update and did not walk it again afterwards. I ran the tour at
phone width with a mouse after the fixes and it passes; nobody has run it with a finger.

## 5. If you read only a few things

**The site (`web/src`)**

1. `App.tsx:195-277` (the state), then `handlePick` at 584-597: every click starts there.
2. `App.tsx:626-674`: how the variable, the period and the click mode change.
3. `point/analysis.ts:49-110` (`analyze`): the one place where a series becomes a verdict. Then
   `point/verdicts.ts`, 21 lines: why a slope of exactly zero is never a change.
4. `map/useRangeMap.ts:176-302` and `map/rangeMap.ts` `finishResult`: how the map for a period is made.
5. `areas/country.ts:1-65` and `:120-141`: how a country's numbers come from grid cells.
6. `detective/Detective.tsx` `ask`, with the table in 2.8 beside it; then `detective/aiReader.ts` (95 lines) and
   `proxy/server.js:34-81`: what Gemini is asked and what is kept.
7. `evaluation/quality.ts:1-11` and `gradeOf`: what Robust, Use with caution and Doubtful mean.

**The pipeline (`pipeline/`)**

1. The README's "Running the pipeline" block, with 2.10 above.
2. `core/config.py`, then `core/products.py`: the variables and the one "no data" rule.
3. `core/trendstats.py` `trend_1d` (lines 23-80): the statistic behind every verdict.
4. `maps/compute.py`, then `maps/export.py` `overlay_rgb`: one number per cell becomes a coloured pixel.
5. `evaluation/reference.py` (the top comment, `compute`, `bad_years`), then `evaluation/reference_multi.py`
   `class_of`: the independent check and the "confirmed by k of n" rule.

## 6. What this review did not do

- The reviewers did not run the tests or the pipeline; their findings come from reading. Only the items marked
  confirmed were re-tested.
- The measurements of function length and nesting come from small scripts and are approximate for anything
  written as page markup.
- The interface was driven by an automated browser with software rendering, not by a person, and not on a real
  phone. Loading times in particular are slower than on real hardware.
- Nothing here judges the statistics or the data.
