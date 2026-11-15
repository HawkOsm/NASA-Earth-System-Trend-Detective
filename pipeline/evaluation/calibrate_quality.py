"""Calibration of the quality checks on synthetic series (deterministic, a minute or so).

n = 45 years (1981-2025); noise AR(1) with phi in {0, 0.4}, unit innovation sd, started in its stationary state; the
signal is a total change of 2, 3 or 5 (in units of the innovation sd). Scenarios:
  clean linear      a straight line rising by `signal` over the record
  pure step         a step of size `signal` at a random index 10..34 (the first value of the second part)
  outlier +8, last5 NO trend, one +8 outlier at a random one of the last 5 years (signal does not apply)
  line 5 + outlier  a straight line rising by 5, one -8 outlier at the middle year
2000 series per row. For the series whose verdict kind is significant (p < 0.05) the table gives the share with each
flag and with each grade (flags are defined in quality.py; nothing is tuned here). `signif` is the share of ALL series
that are significant.
Run from pipeline/:  .venv/bin/python -m evaluation.calibrate_quality
"""
import time

import numpy as np

from core import config
from evaluation.quality import quality_cols

N = 45
REPS = 2000
SEED = 20260101
T = np.array(config.YEARS, dtype=np.float64)
K = np.arange(N, dtype=np.float64)


def noise(rng, phi, reps):
    e = rng.normal(size=(N, reps))
    x = np.zeros((N, reps))
    x[0] = e[0] / np.sqrt(1.0 - phi * phi)
    for i in range(1, N):
        x[i] = phi * x[i - 1] + e[i]
    return x


def scenario(name, rng, phi, signal):
    x = noise(rng, phi, REPS)
    if name == "clean linear":
        return x + signal * K[:, None] / (N - 1)
    if name == "pure step":
        s = rng.integers(10, 35, REPS)
        return x + signal * (K[:, None] >= s[None, :])
    if name == "outlier +8, last5":
        j = rng.integers(N - 5, N, REPS)
        x[j, np.arange(REPS)] += 8.0
        return x
    if name == "line 5 + outlier":
        x = x + 5.0 * K[:, None] / (N - 1)
        x[N // 2] -= 8.0
        return x
    raise ValueError(name)


def main():
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    rows = []
    for name, signals in (("clean linear", (2, 3, 5)), ("pure step", (2, 3, 5)), ("outlier +8, last5", (0,)), ("line 5 + outlier", (5,))):
        for phi in (0.0, 0.4):
            for sig in signals:
                Y = scenario(name, rng, phi, sig)
                q = quality_cols(Y, T)
                from core.trendstats import trend_grid
                p = trend_grid(Y.reshape(N, 1, REPS), T)["p"].ravel()
                s = p < 0.05
                m = int(s.sum())
                g = q["grade"][s]
                f = lambda a: 100.0 * float(a[s].mean()) if m else float("nan")
                rows.append((name, phi, sig, 100.0 * m / REPS, m, f(q["step"]), f(q["oneYear"]), f(q["reversal"]), f(q["endSensitive"]),
                             *(100.0 * float((g == c).mean()) if m else float("nan") for c in (1, 2, 3))))
    print(f"n = {N}, {REPS} series per row, seed {SEED}. Shares are percent of the SIGNIFICANT series (p < 0.05) of the row.")
    print(f"{'scenario':18}{'phi':>5}{'signal':>7}{'signif%':>9}{'n_sig':>6} |{'STEP':>7}{'ONE_YR':>8}{'REVERS':>8}{'END':>7} |"
          f"{'robust':>8}{'caution':>8}{'doubtful':>9}")
    for r in rows:
        print(f"{r[0]:18}{r[1]:5.1f}{(str(r[2]) if r[2] else '-'):>7}{r[3]:9.1f}{r[4]:6d} |{r[5]:7.1f}{r[6]:8.1f}{r[7]:8.1f}{r[8]:7.1f} |"
              f"{r[9]:8.1f}{r[10]:8.1f}{r[11]:9.1f}")
    print(f"({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()
