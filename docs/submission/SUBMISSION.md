# Submission checklist

Owner: HawkOsm. **Submitted on 15 November 2026.** This page is kept as the record of what the form asked
for and what was done; it was last updated after the submission.

- Live site: https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/
- Demo deck (7 slides, public, no sign-in): https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/deck/Trend-Detective-deck.pdf
- Text of the form: [SUBMISSION_FORM.md](SUBMISSION_FORM.md), and the same without formatting marks in
  [SUBMISSION_FORM.txt](SUBMISSION_FORM.txt)
- Code: https://github.com/HawkOsm/NASA-Earth-System-Trend-Detective (public since 15 November)
- Challenge: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/

`[x]` is done. `[ ]` was not done.

## Deadline

From the official Project Submission Guide
(https://www.spaceappschallenge.org/resources/project-submission-guide/, read on 14 November 2026):
**"Submit for Judging" must be clicked before Sunday 15 November, 11:59 p.m., in the local time of the team's
Local Event** (Universal Event: the local time of the Team Owner's area of residence). Anything saved or
submitted later is not judged. You can edit and resubmit as often as you like before then; only the last saved
version is reviewed.

## What the form asks for

| Field | Status |
|---|---|
| Project Name | Ready |
| High-Level Project Summary | Ready |
| Link to Project Demo (at most 7 slides, or a video of 30 seconds or less; public link) | Ready |
| Link to Final Project (public link) | Ready: the site and the repository are both public |
| Detailed Project Description | Ready |
| Use of Super Intelligence (the guide's name for AI tools) | Ready |
| NASA Data (at least one NASA data set is needed for a Global Award) | Ready: NASA POWER, MERRA-2, GISTEMP, GPM IMERG, MODIS, AIRS, OMI, GLDAS (AIRS, OMI and GLDAS from GES DISC, the archive behind Giovanni). The challenge text itself names MERRA-2, MODIS, OMI, AIRS, GPM and GLDAS, and all six are used |
| Space Agency Partner Data and Other References | Ready |

Rules from the guide that affect us:

- The deck must state the **team name, the names of the team members and the challenge**.
- More than 7 slides, or a video over 30 seconds, makes the project ineligible for Global Judging. The deck has 7.
- All content, including linked material, must be in English.
- All team members must be confirmed participants at the same Local Event.
- AI-generated images or video need a visible watermark; code and data made with AI must say so in descriptive
  text. The project has no AI-generated images, and the README and the form text state the use of AI, including
  the one place where an AI model runs on the site (Gemini reads the Detective's questions).
- No NASA logos or branding in AI-generated content. The project uses none anywhere.
- No image, video or audio of anyone under 18. There are none.
- Judging criteria: Impact, Creativity, Validity, Relevance, Presentation.
- Optional: a web-filter classification request for the site (the FortiGuard form linked in the guide), so that
  judges behind a filter can open it.

## What the owner did on 15 November

- [x] Made the repository public. The history holds no key or token (every commit was searched first). The page
      of the old pull request #2 became visible with it.
- [x] Tried the site on his own phone: it looked fine. (All automated tests used software rendering in an
      automated browser, at laptop and phone-sized windows.)
- [x] Filled in the form from `SUBMISSION_FORM.txt` and submitted it.
- [ ] Optional: the web-filter classification request.

## Done

- [x] Official guide read; fields and rules listed above.
- [x] Form text written (`SUBMISSION_FORM.md`).
- [x] Deck built from `docs/deck/deck.html` (7 slides) and hosted on the site as a PDF. Slide 1 states the team
      (HawkTeam), the member (Osman Sahin Guler) and the challenge, as the guide requires.
- [x] Evaluation layer live: a grade on every trend, an independent check for temperature and rainfall, and a
      satellite check against GPM (rainfall), MODIS (snow cover), AIRS (air temperature), OMI (ozone) and the
      GLDAS model (evaporation, soil moisture) over their own years.
      Guide: [EVALUATION.md](../EVALUATION.md).
- [x] README describes the site as it is now.
- [x] No two source files differ only in letter case, so the project builds on Windows and macOS as well as Linux.
- [x] A trend of exactly zero is never reported as significant (`web/src/point/verdicts.ts`).
- [x] Credits: NASA POWER, MERRA-2, GISTEMP, GHCN-CAMS, GPCP, CMAP, GPCC, PREC/L, Natural Earth, cambecc/earth,
      libraries and methods.

## Known gaps

- The site was checked on one phone and one computer by a person; everything else was checked by an automated
  browser with software rendering.
- The independent check covers air temperature and rainfall only, and 1981–2025 only.
