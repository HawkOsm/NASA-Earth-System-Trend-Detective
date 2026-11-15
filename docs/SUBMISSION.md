# Submission checklist

Owner: HawkOsm. Last updated 14 November 2026.

- Live site: https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/
- Demo deck (7 slides, public, no sign-in): https://hawkosm.github.io/NASA-Earth-System-Trend-Detective/deck/Trend-Detective-deck.pdf
- Text to paste into the form: [SUBMISSION_FORM.md](SUBMISSION_FORM.md)
- Challenge: https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/

`[x]` is done and checked. `[ ]` needs a person.

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
| Link to Final Project (public link) | The site is public. The repository is private |
| Detailed Project Description | Ready |
| Use of Super Intelligence (the guide's name for AI tools) | Drafted; read it once |
| NASA Data (at least one NASA data set is needed for a Global Award) | Ready: NASA POWER, MERRA-2, GISTEMP |
| Space Agency Partner Data and Other References | Ready |

Rules from the guide that affect us:

- The deck must state the **team name, the names of the team members and the challenge**.
- More than 7 slides, or a video over 30 seconds, makes the project ineligible for Global Judging. The deck has 7.
- All content, including linked material, must be in English.
- All team members must be confirmed participants at the same Local Event.
- AI-generated images or video need a visible watermark; code and data made with AI must say so in descriptive
  text. The project has no AI-generated images, and the README and the form text state the use of AI.
- No NASA logos or branding in AI-generated content. The project uses none anywhere.
- No image, video or audio of anyone under 18. There are none.
- Judging criteria: Impact, Creativity, Validity, Relevance, Presentation.
- Optional: a web-filter classification request for the site (the FortiGuard form linked in the guide), so that
  judges behind a filter can open it.

## Needs a person

- [ ] **Make the repository public** (planned for Sunday 15 November, before submitting). The site is public
      either way; judges cannot see the code while the repository is private. Note that the old pull request #2
      becomes publicly visible with it.
- [ ] Read the "Use of Super Intelligence" answer in `SUBMISSION_FORM.md` once. The part about your own role was
      drafted from the working record; change anything that does not match.
- [ ] Open the site and the deck link in a private browser window. (Both were fetched without signing in on
      14 November and loaded; this is a last human check.)
- [ ] Try the site on a real phone and on a computer with an ordinary graphics card. All testing so far used
      software rendering in an automated browser, at desktop and phone-sized windows.
- [ ] Fill in the form, tick "Terms and Conditions" and "Confirm All Work is Original", click
      "Submit for Judging", and look for the confirmation banner.
- [ ] Optional: the web-filter classification request.

## Done

- [x] Official guide read; fields and rules listed above.
- [x] Form text written (`SUBMISSION_FORM.md`).
- [x] Deck built from `docs/deck/deck.html` (7 slides) and hosted on the site as a PDF. Slide 1 states the team
      (HawkTeam), the member (Osman Sahin Guler) and the challenge, as the guide requires.
- [x] Start strip on the site with three findings that open with one click (`web/src/StartCard.tsx`,
      `web/src/startFindings.ts`). Each is significant (p < 0.001), graded Robust, and confirmed by an independent
      record: Istanbul air temperature +0.54 °C per decade (NASA GISTEMP +0.55); Shanghai rainfall +0.36 mm/day
      per decade (GPCP +0.26); the Amazon at Porto Velho rainfall −0.67 mm/day per decade (GPCP −0.36).
      Rainfall at Cebu was considered too: three of four rainfall records confirm it (GPCP does not), at about
      half the size MERRA-2 shows. Shanghai, confirmed by all four, was preferred.
- [x] Evaluation layer live: a grade on every trend, and an independent check for temperature and rainfall.
      Guide: [EVALUATION.md](EVALUATION.md).
- [x] README describes the site as it is now.
- [x] No two source files differ only in letter case, so the project builds on Windows and macOS as well as Linux.
- [x] A trend of exactly zero is never reported as significant (`web/src/verdicts.ts`).
- [x] Credits: NASA POWER, MERRA-2, GISTEMP, GPCP, Natural Earth, cambecc/earth, libraries and methods.

## Known gaps

- Phone and real-GPU behaviour have not been checked by a person.
- The independent check covers air temperature and rainfall only, single places only, and 1981–2025 only.
