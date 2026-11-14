# Evaluation layer: can a trend be trusted?

Branch: `evaluation-layer`. Owner: HawkOsm.

## Why

The site reports whatever MERRA-2 says and calls a trend "significant" on statistics alone. Statistics cannot
tell a real change from a flaw in the dataset: a jump when a satellite instrument changed, one bad year, or a
variable that is computed by a model rather than measured. This branch adds checks that grade each trend.

## What gets built

1. **Quality checks on every trend** (same code in Python and TypeScript, tied by shared fixtures, like the
   statistics):
   - **Jump**: most of the change happened in one step, with little trend before or after it.
   - **One unusual year**: the verdict changes if a single outlier year is left out.
   - **Reversal**: the first and second halves of the record point in opposite directions.
   - **End sensitivity**: the direction flips if the first or last five years are dropped.
   - **Many tests** (Detective only): a line that is significant on its own but not after correcting for
     testing ten variables at one place.
2. **A grade per trend**: Robust / Use with caution / Doubtful, with the reason in plain words, in the click
   panel, the country / sea overlay and the Detective.
3. **A written caveat per variable**: what is measured and what is modelled.
4. **Calibration**: the thresholds are checked on synthetic series (clean trends must mostly grade Robust,
   pure jumps and outlier-driven trends must mostly be flagged) and the measured rates go in the README.
5. **Stretch**: an independent comparison for air temperature against NASA GISTEMP.

## What it does not do

It cannot prove the data is right. It only catches patterns that are known signs of trouble.

## Done means

- Python and TypeScript give the same flags on the shared fixtures.
- The calibration table is reproduced from a script in the repo.
- Per variable: the share of significant area that grades Robust / Use with caution / Doubtful.
- `pytest`, `npm test` and `npm run build` pass.
