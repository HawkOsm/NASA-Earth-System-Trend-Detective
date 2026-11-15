# Documents

The main description of the project is the [README](../README.md) at the top of the repository. This folder
holds the rest.

## To understand the project

- [EVALUATION.md](EVALUATION.md): a plain-language guide to the evaluation layer: the grades, the independent
  check against other records, the satellite check, and how to rerun them.
- [deck/deck.html](deck/deck.html): the source of the seven-slide demo deck, with its pictures in `deck/img/`.
  The PDF that the site serves is built from it (`web/public/deck/Trend-Detective-deck.pdf`).

## What was submitted (`submission/`)

The entry was submitted to the NASA Space Apps Challenge on 15 November 2026.

- [submission/SUBMISSION_FORM.md](submission/SUBMISSION_FORM.md): the text of every field of the project form.
- [submission/SUBMISSION_FORM.txt](submission/SUBMISSION_FORM.txt): the same text without formatting marks, one
  line per paragraph, with the data sources and tools as "Link Text" and URL pairs, as the form wanted them.
- [submission/SUBMISSION.md](submission/SUBMISSION.md): the checklist: the rules of the form, and what was done.

## Working reports (`history/`)

Written while the project was being built, and kept as a record. They describe the project as it was on the day
they were written, so file names, numbers and paths in them can be out of date.

| File | Written | What it is |
|---|---|---|
| [history/PHASE1_REPORT.md](history/PHASE1_REPORT.md) | 14 November | The first pipeline, for air temperature: the raw output of its tests and runs |
| [history/PHASE2_REPORT.md](history/PHASE2_REPORT.md) | 14 November | The first site: the globe coloured by the trend, with the raw build output |
| [history/PHASE3_REPORT.md](history/PHASE3_REPORT.md) | 14 November | The statistics written a second time for the browser and matched to Python; the panel of one place with live data |
| [history/PHASE4_REPORT.md](history/PHASE4_REPORT.md) | 14 November | The variable picker, the legend, the help text, coastlines and the flat-map fallback |
| [history/NIGHT_REPORT.md](history/NIGHT_REPORT.md) | Night of 14 to 15 November | Research on the challenge, more data sources, and experiments with the method |
| [history/REVIEW.md](history/REVIEW.md) | 15 November | A review of where the code and the interface are hard to follow: what was fixed, removed and left |
