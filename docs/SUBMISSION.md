# Submission checklist

Branch: `submission`. Owner: bugraekin.
Deadline: Sunday 15 November 2026, 20:00 Istanbul time.
Live site: https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/
Challenge page: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/

## Must do

- [ ] Read the Space Apps submission requirements and list every required field here (not yet verified).
- [ ] Make the repository public (repo owner decides when).
- [ ] Project description: what it is, how it answers the challenge, what data it uses.
- [ ] Demo video or slides, whichever the submission form requires. Draft the script here first.
- [ ] "Use of AI" statement (the README has one; copy it into the form if the form asks).
- [ ] Data and resource credits: NASA POWER / MERRA-2, Natural Earth, the cambecc/earth idea credit.
- [ ] No NASA logos or branding anywhere in the site, video or slides.

## First-run experience

- [ ] A first-run prompt so a judge has somewhere to start (the example buttons were removed).
- [ ] Three curated findings with real numbers from the site. Candidates already checked against the data:
      Istanbul is warming; Cebu is getting wetter; the Amazon near Porto Velho is getting drier.

## Real-device testing (never done so far: all testing was with software rendering)

- [ ] Desktop with a real GPU: speed, wind streaks, label sizes.
- [ ] Phone: menu sheet, Detective sheet, country overlay, touch on the sliders and on the country piece.
- [ ] Window widths between 760 and 1100 px.

## README

- [ ] Check every statement in the README still matches the site (ten variables, menu, Detective, continents).
- [ ] Remove or move the old `PHASE*_REPORT.md` files if they are not wanted in the public repo.

## Files to avoid while the evaluation branch is open

`pipeline/`, `web/src/Panel.tsx`, `web/src/Detective.tsx`, `web/src/detective.ts`, `web/src/CountryOverlay.tsx`.
Shared files to edit carefully: `web/src/App.tsx`, `web/src/styles.css`, `README.md`.
