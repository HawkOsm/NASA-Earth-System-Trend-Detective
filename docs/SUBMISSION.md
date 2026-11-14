# Submission checklist

Branch: `submission`. Owner: bugraekin.
Deadline: Sunday 15 November 2026, 20:00 Istanbul time (team target). Search results for the 2026 guide say the form
closes at 23:59 local time on Sunday 15 November; confirm on the form.
Live site: https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/
Challenge page: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/

Text to paste into the form: [SUBMISSION_TEXT.md](SUBMISSION_TEXT.md). Demo deck: `docs/demo/Trend-Detective-demo.pptx`.

Last updated 14 November 2026. `[x]` is done and checked, `[ ]` still needs a person.

## Submission form fields

The official guide (https://www.spaceappschallenge.org/resources/project-submission-guide/) could not be opened from
the machine this was written on (certificate error), so this list comes from web-search summaries of the 2026 guide.
**Read the guide or the form itself once before submitting.**

| Field | Status |
|---|---|
| Project name | Draft ready: "Trend Detective" |
| High-level summary | Draft ready |
| Link to the final project | Live site and repository (the repository must be public) |
| Link to the project demo: 7 slides, or a video of 30 seconds or less | Deck built; needs a public link |
| Detailed project description | Draft ready |
| NASA data (at least one NASA data set or resource is needed for a Global Award) | Draft ready |
| Space agency partner data and other references (all code, text and images used, even if open source) | Draft ready |
| Use of AI (for NASA's records; AI-generated images and video need a visible watermark) | Draft ready; one sentence for the team to add |

Rules found in the same search results: the demo cannot be uploaded to the form, so it must be hosted somewhere public
(no password, permission or sign-in); slides must be in English and a video needs English subtitles; all team members
must be registered at the same local event; a submission is final.

## Must do

- [x] List the required fields (above). Still to do by a person: read the official guide once.
- [ ] Make the repository public (repo owner decides when).
- [x] Project description: summary and detailed description drafted in `SUBMISSION_TEXT.md`.
- [x] Demo: 7-slide deck in `docs/demo/`, and a 30-second video script in `SUBMISSION_TEXT.md`.
- [ ] Upload the deck (or record the video) somewhere public and paste the link into the form.
- [x] "Use of AI" statement drafted from the README. The team should add one sentence on what it decided itself.
- [x] Data and resource credits: NASA POWER / MERRA-2, Natural Earth, cambecc/earth, libraries, methods.
- [x] No NASA logos or branding: no logo or image of one in the repository (the only non-data image is the base map,
      and the favicon is a magnifying glass), in the site or in the deck. Check the video if one is recorded.
- [ ] Merge `submission` into `main`: the site deploys from `main` only, so the start card is not live until then.
- [ ] Fill in the form and submit.

## First-run experience

- [x] A first-run prompt: the "Start here" card under the Detective button (`web/src/FirstRun.tsx`).
- [x] Three curated findings with real numbers (`web/src/findings.ts`), each opening the point panel with one click.
      Checked in the built site: the panel shows the same numbers as the card.
      Istanbul air temperature +0.54 °C per decade; Cebu precipitation +0.87 mm/day per decade; the Amazon near
      Porto Velho soil moisture -3.33 percentage points per decade. All p < 0.001, 1981–2025.

## Real-device testing

- [x] Desktop with a real GPU. Headless Edge on an AMD Radeon Vega 8 (Direct3D 11, not software rendering),
      1440×900: 60 frames per second while dragging the globe, with and without wind streaks; no console errors.
      Wind streaks and label sizes were looked at in screenshots only, so a person should still look at them moving.
- [ ] Phone. Only emulated so far (390×844, touch): the start card, the side panel, the Detective sheet and the
      country overlay fit the width with no sideways scroll. Sliders and touch on the country piece were not tested.
      A real phone is still needed.
- [x] Window widths 760, 761, 820, 900, 1000, 1099 and 1100 px: no sideways scroll; the start card does not overlap
      the menu, the Detective button or the side panel; the menu makes room for the side panel.
      Found, not fixed (the file is on the avoid list): from 761 to 860 px the Detective opens as a bottom sheet
      over the open menu.

## README

- [x] Every statement checked against the site. Changed: a "Using the site" section (start card, click behaviour,
      menu, Detective, continents), "a click lifts the country" instead of "Area = Country", the size of
      `web/public/data` (164 MB, was 183), and four pipeline scripts missing from the run instructions.
- [x] The old `PHASE*_REPORT.md` files moved to `docs/history/`. Delete the folder if they are not wanted in public.

## Found along the way

- The typecheck (and so `npm run build`) failed on Windows, because `Detective.tsx` / `detective.ts` and
  `FlatMap.tsx` / `flatmap.ts` differ only in case. Fixed by importing the `.tsx` files by their full name.
- Detective, "The Arctic" button (Barents Sea): one line reads "Sea ice: 0.00 percentage points per decade —
  statistically significant". A zero slope called significant will look wrong to a judge. Not fixed: `detective.ts`
  is on the avoid list.
- `main` has a commit that `submission` does not (quality badge, service worker). It merges without conflicts.

## Files to avoid while the evaluation branch is open

`pipeline/`, `web/src/Panel.tsx`, `web/src/Detective.tsx`, `web/src/detective.ts`, `web/src/CountryOverlay.tsx`.
Shared files to edit carefully: `web/src/App.tsx`, `web/src/styles.css`, `README.md`.
