"""Write tests/fixtures/quality_cases.json: inputs and the full expected quality_1d result for about 40 series
(synthetic ones for every flag, edge cases, and real grid cells of all ten variables), plus Holm cases.
The browser test (web/src/evaluation/quality.test.ts) must reproduce flags and grade exactly and the numbers to 1e-9.
Deterministic (fixed seeds). Run from pipeline/:  .venv/bin/python -m evaluation.make_quality_fixtures"""
import json
import os

import numpy as np

from core import config
from core import products
from evaluation.quality import holm_adjust, quality_1d, quality_grid

FIXTURE = os.path.join(config.PIPELINE_DIR, "tests", "fixtures", "quality_cases.json")
T45 = np.array(config.YEARS, dtype=np.float64)


def ar1(rng, n, phi=0.0, sd=1.0):
    e = rng.normal(0, sd, n)
    x = np.zeros(n)
    for i in range(n):
        x[i] = e[i] + (phi * x[i - 1] if i else 0.0)
    return x


def hash_name(name):
    """Stable (not Python's salted hash) integer from a name."""
    h = 0
    for ch in name:
        h = (h * 131 + ord(ch)) % 1000003
    return h


def synthetic():
    rng = np.random.default_rng(2026)
    n = 45
    k = np.arange(n, dtype=np.float64)
    out = []

    def add(name, y, t=T45):
        out.append((name, np.round(np.asarray(y, dtype=np.float64), 4), np.asarray(t, dtype=np.float64)))

    add("clean trend", 0.05 * k + 0.3 * rng.normal(size=n))
    add("clean trend, strong", 0.12 * k + 0.5 * rng.normal(size=n))
    add("clean falling trend", 10 - 0.08 * k + 0.4 * rng.normal(size=n))
    add("pure step at 1999", np.where(k >= 18, 1.5, 0.0) + 0.3 * rng.normal(size=n))
    add("pure step at 2010 (falling)", np.where(k >= 29, -2.0, 0.0) + 0.4 * rng.normal(size=n))
    add("pure step at 1990 (late edge case, part of 9)", np.where(k >= 9, 1.0, 0.0) + 0.2 * rng.normal(size=n))
    add("step too near the start (part of 3)", np.where(k >= 3, 1.5, 0.0) + 0.2 * rng.normal(size=n))
    add("step too near the end (part of 4)", np.where(k >= 41, 1.5, 0.0) + 0.2 * rng.normal(size=n))
    add("ramp plus step", 0.03 * k + np.where(k >= 25, 1.2, 0.0) + 0.3 * rng.normal(size=n))
    def find(name, gen, pred, tries=20000):
        """First series (fixed seed) of a random family that satisfies the predicate on its quality_1d result."""
        r = np.random.default_rng(abs(hash_name(name)))
        for _ in range(tries):
            y = np.round(gen(r), 4)
            d = quality_1d(y, T45)
            if pred(d):
                add(name, y)
                return
        raise SystemExit(f"no series found for {name}")

    def only(d, *names):
        f = d["flags"]
        return all(f[x] == (x in names) for x in f) and d["kind"] != "none"

    def with_outlier(base, amp):
        def gen(r):
            y = base(r)
            y[r.integers(0, n)] += r.choice([-1, 1]) * amp * r.uniform(0.8, 1.3)
            return y
        return gen

    def lin(slope, sd, phi=0.0):
        return lambda r: slope * k + ar1(r, n, phi, sd)

    find("one unusual year destroys a significant trend", with_outlier(lin(0.025, 0.5), 3.5),
         lambda d: d["flags"]["oneYear"] and d["kind"] == "significant" and d["kindWithout"] == "none")
    find("one unusual year hides a trend", with_outlier(lin(0.02, 0.5), 3.5),
         lambda d: d["flags"]["oneYear"] and d["kind"] == "none" and d["kindWithout"] != "none")
    find("one unusual year hides a trend (possible without)", with_outlier(lin(0.03, 0.6), 4.5),
         lambda d: d["flags"]["oneYear"] and d["kind"] == "none" and d["kindWithout"] == "possible")
    find("one unusual year flips the sign (same verdict kind)", with_outlier(lin(0.0, 0.5), 3.5),
         lambda d: d["flags"]["oneYear"] and d["kindWithout"] == d["kind"] and d["slope"] * d["slopeWithout"] < 0)
    find("one unusual year flips the sign (no trend)", with_outlier(lin(0.0, 0.5), 3.0),
         lambda d: d["flags"]["oneYear"] and d["kind"] == "none" and d["kindWithout"] == "none")
    find("one unusual year makes a trend weaker (significant to possible)", with_outlier(lin(0.025, 0.5), 3.5),
         lambda d: d["flags"]["oneYear"] and d["kind"] == "significant" and d["kindWithout"] == "possible")
    find("outlier that changes nothing", with_outlier(lin(0.06, 0.4), 3.0),
         lambda d: d["outlierYear"] is not None and not d["flags"]["oneYear"] and d["kind"] == "significant")
    find("reversal only: rise then a smaller fall",
         lambda r: np.where(k < 22, 0.2 * k, 4.4 - 0.08 * (k - 22)) + 0.5 * r.normal(size=n),
         lambda d: only(d, "reversal"))
    find("reversal only: fall then a smaller rise",
         lambda r: np.where(k < 22, -0.2 * k, -4.4 + 0.08 * (k - 22)) + 0.5 * r.normal(size=n),
         lambda d: only(d, "reversal"))
    find("end-sensitive only: the first years drive it",
         lambda r: np.where(k < 6, 1.2, 0.0) - 0.01 * k + 0.35 * r.normal(size=n),
         lambda d: only(d, "endSensitive") and d["endSide"] == "first")
    find("end-sensitive only: the last years drive it",
         lambda r: np.where(k > 38, 1.2, 0.0) + 0.01 * k + 0.35 * r.normal(size=n),
         lambda d: only(d, "endSensitive") and d["endSide"] == "last")
    find("step and reversal: doubtful",
         lambda r: np.where(k < 20, 0.0, np.where(k < 30, 3.0, 2.0)) + 0.3 * r.normal(size=n),
         lambda d: d["grade"] == "doubtful" and d["flags"]["step"] and not d["flags"]["oneYear"])
    find("step and end-sensitive: doubtful",
         lambda r: np.where(k < 8, 0.0, 0.8) + 0.0 * k + np.where(k >= 8, 0.01 * (k - 8), 0.0) + 0.4 * r.normal(size=n),
         lambda d: d["grade"] == "doubtful" and d["flags"]["step"] and d["flags"]["endSensitive"])
    add("white noise, no trend", rng.normal(size=n))
    add("white noise, no trend (2)", rng.normal(size=n))
    add("AR(1) noise 0.4, weak trend", 0.025 * k + ar1(rng, n, 0.4))
    add("constant series", np.full(n, 3.25))
    add("ties: values rounded to 0.5", np.round((0.06 * k + 0.4 * rng.normal(size=n)) * 2) / 2)
    add("ties: mostly zeros then values", np.where(k > 25, np.round(rng.uniform(0, 3, n)), 0.0))
    add("exactly linear", 0.2 * k + 1.0)
    add("step: constant halves", np.where(k >= 20, 1.0, 0.0))
    add("n = 19", 0.1 * k[:19] + 0.2 * rng.normal(size=19), T45[:19])
    add("n = 20 (trend)", 0.15 * k[:20] + 0.3 * rng.normal(size=20), T45[:20])
    add("n = 20 (step)", np.where(k[:20] >= 10, 1.5, 0.0) + 0.2 * rng.normal(size=20), T45[:20])
    add("n = 25, period 2001-2025", 0.1 * k[:25] + 0.3 * rng.normal(size=25), T45[20:])
    keep = np.array([i for i in range(n) if i not in (3, 4, 11, 17, 18, 30, 38)])
    add("missing years (38 valid, gaps)", 0.07 * k[keep] + 0.3 * rng.normal(size=len(keep)), T45[keep])
    keep = np.array([i for i in range(n) if i % 3 != 1])
    add("missing years (every third), step", np.where(k[keep] >= 20, 1.4, 0.0) + 0.25 * rng.normal(size=len(keep)), T45[keep])
    return out


def real_cells():
    """Real full-resolution cells: for each variable the first significant cell of a few categories, from a fixed scan."""
    out = []
    for var in config.VARIABLES:
        g = products.load_grid(var)
        q = quality_grid(g, T45)
        ok = q["grade"] != 255
        want = [("any", ok & (q["kind"] == 2)), ("step", q["step"]), ("oneYear", q["oneYear"]), ("none", ok & (q["kind"] == 0))]
        rng = np.random.default_rng(len(var))
        for label, mask in want:
            if label in ("oneYear", "step") and var not in ("PRECTOTCORR", "TO3", "WS2M", "T2M_MAX"):
                continue
            idx = np.argwhere(mask)
            if not len(idx):
                continue
            i, j = idx[rng.integers(0, len(idx))]
            out.append((f"real {var} {label} cell lat {-90 + 0.5 * i:.1f} lng {-180 + 0.625 * j:.3f}", g[:, i, j], T45))
    return out


def main():
    cases = []
    for name, y, t in synthetic() + real_cells():
        cases.append({"name": name, "t": t.tolist(), "y": y.tolist(), "expected": quality_1d(y, t)})
    holm = []
    for ps in ([0.001, 0.02, 0.04, 0.3], [0.04], [0.01, 0.011, 0.012, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.0001],
               [0.012, 0.012, 0.3], [0.2, 0.01, 0.03, 0.001, 0.8]):
        holm.append({"p": ps, "expected": holm_adjust(ps)})
    with open(FIXTURE, "w") as f:
        json.dump({"cases": cases, "holm": holm}, f, indent=1)
    print(f"wrote {FIXTURE}: {len(cases)} cases, {len(holm)} Holm cases")
    print(f"{'case':70} {'n':>3} {'grade':>9}  step one rev end  stepYear outlierYear")
    for c in cases:
        e = c["expected"]
        f = e["flags"]
        print(f"{c['name'][:70]:70} {e['n']:3} {e['grade']:>9}  {int(f['step'])}    {int(f['oneYear'])}   {int(f['reversal'])}   {int(f['endSensitive'])}    "
              f"{e['stepYear']}  {e['outlierYear']}")


if __name__ == "__main__":
    main()
