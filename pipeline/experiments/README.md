# experiments/ (R2: significance tests)

`significance.py` compares nine significance tests for a 45-year annual trend (A MK, B current trendstats,
C Hamed-Rao all lags, D Yue-Wang lag-1, D2 Yue-Wang all lags, E TFPW, F iterative pre-whitening, G3/G5 block
bootstrap). Formulas and papers are in its docstring. It changes no existing file and writes only to stdout.

Run from `pipeline/` (about 6.5 minutes on one core):

    .venv/bin/python experiments/significance.py > experiments/significance_output.txt

Optional argument: `check` (self-check against trendstats and pymannkendall), `part1` (synthetic truth),
`part2` (MERRA-2 boxes against GISTEMP/GPCP, uses cache/reference_*.npz), `maps` (the ten full-resolution maps).
`significance_output.txt` is the output of the last full run.

`trend_experiments.py` (run the same way, about one minute) measures whether any technique makes MERRA-2 trends agree
better with the independent records: grades against confirmation, jump removal, later start years, other slope
estimators, coarser scales, and a pattern-only rule. Its output is in `trend_experiments_output.txt`.
Results of both scripts are summarised in `docs/NIGHT_REPORT.md`.
